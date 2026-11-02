import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BossSchema } from '../engine/boss-api';
import type { FightRecord, FightStats, ForgeFight } from '../engine/forge-protocol';
import { ForgeSnapshotSchema } from '../engine/forge-protocol';
import { FightHistory, summarize } from '../server/showtime/history';
import { rematchBrief, rematchGoals, rematchName } from '../server/showtime/rematch';
import { tuneForRematch } from '../server/showtime/tuner';
import { Showtime } from '../server/showtime/showtime';
import { diagnostics } from '../server/showtime/diagnostics';
import { loadConfig } from '../server/config';
import { harness, replay } from './forge-helpers';
import ember from '../bosses/house/ember-anvil.json';
import neon from '../bosses/house/neon-brood.json';
import prism from '../bosses/house/prism-warden.json';
import serpent from '../bosses/house/brass-serpent.json';

const stats: FightStats = { seconds: 48, heartsLeft: 3, bossHpLeft: 0, hitsTaken: 0, phaseReached: 2 };
const record = (overrides: Partial<FightRecord>): FightRecord => ({ id: 'f', at: 1, boss: 'Boss', creator: 'viewer_a', mode: 'codex', outcome: 'won', specHash: 'x', generation: 1, stats: null, ...overrides });

/** Coordinator + Showtime with manual timers so windows and polls can be stepped deterministically. */
async function setup(options: { rematchVotes?: number; autoVote?: boolean } = {}) {
  let now = 1_000_000;
  const timers: Array<{ fn: () => void; at: number; done: boolean }> = [];
  const { coordinator } = harness({}, { cooldownMs: 0, autoApprove: true, now: () => now });
  const history = new FightHistory(null);
  const showtime = new Showtime(coordinator, history, {
    rematchVotes: options.rematchVotes ?? 3, autoVote: options.autoVote ?? false, rematchWindowMs: 60000, voteMs: 45000, now: () => now,
    setTimer: (fn, ms) => { timers.push({ fn, at: now + ms, done: false }); return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => {},
  });
  await showtime.start();
  const advance = (ms: number) => { now += ms; for (const timer of timers) if (!timer.done && timer.at <= now) { timer.done = true; timer.fn(); } };
  const announced: string[] = []; showtime.onAnnounce((text) => announced.push(text));
  /** Claim a fight and finish it the way the arena would. */
  const fight = async (outcome: 'won' | 'lost', fightStats: FightStats | null = stats): Promise<ForgeFight> => {
    const claimed = coordinator.claimNext();
    await coordinator.finishFight(claimed.id, outcome, fightStats);
    await vi.waitFor(() => expect(coordinator.snapshot().showtime.recap?.id).toBe(claimed.id));
    return claimed;
  };
  return { coordinator, showtime, history, advance, announced, fight };
}

describe('Hall of Fame history', () => {
  it('summarizes record, streaks, creator scores, and most feared bosses', () => {
    const hall = summarize([
      record({ id: '1', outcome: 'lost', creator: 'viewer_a', boss: 'Toaster' }),
      record({ id: '2', outcome: 'lost', creator: 'viewer_a', boss: 'Toaster' }),
      record({ id: '3', outcome: 'won', creator: 'viewer_b', boss: 'Disco', generation: 2 }),
      record({ id: '4', outcome: 'won', creator: 'house_forge', boss: 'Ember Anvil', mode: 'house' }),
      record({ id: '5', outcome: 'won', creator: 'viewer_b', boss: 'Disco' }),
    ]);
    expect(hall).toMatchObject({ wins: 3, losses: 2, streak: 3 });
    expect(hall.creators.map((entry) => [entry.creator, entry.score])).toEqual([['viewer_a', 8], ['viewer_b', 4]]);
    expect(hall.creators.some((entry) => entry.creator === 'house_forge')).toBe(false);
    expect(hall.feared[0]).toMatchObject({ boss: 'Toaster', creator: 'viewer_a', defeats: 2 });
    expect(hall.recent[0]!.id).toBe('5');
    expect(summarize([record({ outcome: 'lost' }), record({ outcome: 'lost' })]).streak).toBe(-2);
  });

  it('persists atomically and ignores corrupt files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bf-history-')), file = join(dir, 'history.json');
    const history = new FightHistory(file);
    await history.add(record({ id: 'a', outcome: 'lost' }));
    await history.add(record({ id: 'b', creator: 'viewer_c' }));
    const reloaded = new FightHistory(file); await reloaded.load();
    expect(reloaded.all().map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(reloaded.creator('viewer_a')).toEqual({ fights: 1, defeats: 1, best: 1 });
    await writeFile(file, '{ not json');
    const corrupt = new FightHistory(file); await corrupt.load();
    expect(corrupt.all()).toHaveLength(0);
    expect(await readFile(file, 'utf8')).toBe('{ not json');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('Rematch Patch naming, brief and offline tuner', () => {
  it('names generations within the 24-character limit', () => {
    expect(rematchName('Ember Anvil', 2)).toBe('Ember Anvil MK II');
    expect(rematchName('Ember Anvil MK II', 3)).toBe('Ember Anvil MK III');
    const long = rematchName('The Extremely Long Bossname', 4);
    expect(long.length).toBeLessThanOrEqual(24); expect(long.endsWith(' MK IV')).toBe(true);
  });

  it('turns fight stats into coaching goals and keeps identity in the brief', () => {
    expect(rematchGoals(stats).join(' ')).toMatch(/comfortably.*48s.*No hits/s);
    expect(rematchGoals({ ...stats, heartsLeft: 1, seconds: 100, hitsTaken: 2 })[0]).toMatch(/barely won/);
    const brief = rematchBrief({ previous: BossSchema.parse(ember), generation: 2, stats });
    expect(brief).toMatchObject({ generation: 2, name: 'Ember Anvil MK II', mustKeep: { creator: ember.meta.creator, sourceQuote: ember.meta.sourceQuote } });
  });

  it('produces valid, harder upgrades of every house boss and drops compiled choreography', () => {
    for (const source of [ember, neon, prism, serpent]) {
      const previous = BossSchema.parse(source);
      const tuned = tuneForRematch(previous, 2, stats, 4);
      expect(BossSchema.safeParse(tuned).success).toBe(true);
      expect(tuned.meta.name.endsWith('MK II')).toBe(true);
      expect(tuned.meta).toMatchObject({ creator: previous.meta.creator, sourceQuote: previous.meta.sourceQuote });
      expect(tuned.choreography).toBeUndefined();
      expect(tuned.hp).toBeGreaterThan(previous.hp);
      const interval = (spec: typeof previous) => spec.phases.flatMap((phase) => phase.attacks.map((attack) => attack.params.interval));
      interval(tuned).forEach((value, index) => expect(value).toBeLessThanOrEqual(interval(previous)[index]!));
      tuned.phases.forEach((phase, index) => phase.attacks.forEach((attack, attackIndex) => {
        const before = previous.phases[index]!.attacks[attackIndex]!;
        if ((attack.emitter === 'aimed' || attack.emitter === 'homing') && before.emitter !== 'laser') expect(attack.params.speed).toBe(before.params.speed);
      }));
    }
    // Less gate slack means a milder change.
    const tight = tuneForRematch(BossSchema.parse(neon), 2, stats, 2), loose = tuneForRematch(BossSchema.parse(neon), 2, stats, 4);
    expect(tight.phases[0]!.attacks[0]!.params.interval).toBeGreaterThan(loose.phases[0]!.attacks[0]!.params.interval);
  });
});

describe('Showtime: recaps, rematch window, and chat polls', () => {
  it('records a win, opens a rematch window, and forges the upgrade to the front of the queue after enough votes', async () => {
    const { coordinator, showtime, announced, fight } = await setup();
    const won = await fight('won');
    let show = coordinator.snapshot().showtime;
    expect(show.recap).toMatchObject({ id: won.id, outcome: 'won', boss: replay.spec.meta.name, stats });
    expect(show.hall).toMatchObject({ wins: 1, losses: 0 });
    expect(show.rematch).toMatchObject({ status: 'open', needed: 3, votes: 0, generation: 1 });
    expect(announced.some((text) => text.startsWith('🏆'))).toBe(true);

    await showtime.rematchVote('fan_one', false); await showtime.rematchVote('fan_one', false); await showtime.rematchVote('fan_two', false);
    expect(coordinator.snapshot().showtime.rematch).toMatchObject({ status: 'open', votes: 2 });
    await showtime.rematchVote('fan_three', false);
    expect(coordinator.snapshot().showtime.rematch?.status).toBe('forging');
    await coordinator.idle();
    show = coordinator.snapshot().showtime;
    const job = coordinator.snapshot().jobs.find((entry) => entry.source === 'rematch')!;
    expect(job).toMatchObject({ moderation: 'rematch', status: 'queued', rematch: { of: won.id, generation: 2, previousName: replay.spec.meta.name } });
    expect(coordinator.snapshot().queue[0]!.jobId).toBe(job.id);
    expect(show.rematch?.status).toBe('queued');
    expect(announced.some((text) => text.startsWith('✅'))).toBe(true);
    expect(ForgeSnapshotSchema.safeParse(coordinator.snapshot()).success).toBe(true);
    await showtime.close(); await coordinator.close();
  });

  it('lets the creator or a moderator call the rematch alone, and refuses duplicates', async () => {
    const { coordinator, showtime, fight } = await setup();
    await fight('won');
    await showtime.rematchVote(replay.spec.meta.creator, false);
    expect(coordinator.snapshot().showtime.rematch?.status).toBe('forging');
    expect(await showtime.rematchVote('late_fan', false)).toMatch(/already in the forge/);
    await coordinator.idle();
    await expect(coordinator.submitRematch({ fightId: coordinator.snapshot().showtime.rematch!.fightId, previous: replay.spec, generation: 2, stats: null })).rejects.toThrow(/already/);
    await showtime.close(); await coordinator.close();
  });

  it('reports a rejected upgrade honestly and never queues it', async () => {
    const { verification } = await import('./forge-helpers');
    const { coordinator } = harness({ verify: async (_, job) => verification(job, job.source !== 'rematch') }, { cooldownMs: 0 });
    const showtime = new Showtime(coordinator, new FightHistory(null), { rematchVotes: 1, autoVote: false, setTimer: () => 0 as unknown as ReturnType<typeof setTimeout> });
    await showtime.start();
    const claimed = coordinator.claimNext(); await coordinator.finishFight(claimed.id, 'won', stats);
    await vi.waitFor(() => expect(coordinator.snapshot().showtime.rematch?.status).toBe('open'));
    await showtime.rematchVote('fan', true); await coordinator.idle();
    expect(coordinator.snapshot().showtime.rematch).toMatchObject({ status: 'failed', message: expect.stringMatching(/too unfair/) });
    expect(coordinator.snapshot().queue).toHaveLength(0);
    await showtime.close(); await coordinator.close();
  });

  it('closes an unanswered rematch window and opens none after a loss', async () => {
    const { coordinator, showtime, advance, fight } = await setup();
    await fight('lost');
    expect(coordinator.snapshot().showtime.rematch).toBeNull();
    expect(coordinator.snapshot().showtime.hall.losses).toBe(1);
    await fight('won');
    advance(60001);
    expect(coordinator.snapshot().showtime.rematch?.status).toBe('expired');
    advance(5001);
    expect(coordinator.snapshot().showtime.rematch).toBeNull();
    expect(await showtime.rematchVote('fan', true)).toBeNull();
    await showtime.close(); await coordinator.close();
  });

  it('runs a chat poll between fights and promotes the winner when the next fight is claimed', async () => {
    const { coordinator, showtime, announced } = await setup({ autoVote: true });
    for (const [creator, text] of [['first_viewer', 'a slow fire furnace boss'], ['second_viewer', 'a neon swarm of orbiters'], ['third_viewer', 'a crystal laser sniper']] as const) {
      await coordinator.submit({ creator, text }, 'demo');
    }
    await coordinator.idle();
    // The poll opens as soon as two bosses are verified, even while a third is still forging.
    const vote = coordinator.snapshot().showtime.vote!;
    expect(vote.options.map((option) => option.creator)).toEqual(['first_viewer', 'second_viewer']);
    expect(coordinator.snapshot().queue).toHaveLength(3);
    expect(announced.some((text) => text.includes('!vote 1') && text.includes('!vote 2'))).toBe(true);
    expect(showtime.castVote('a', 2)).toBe(true); showtime.castVote('b', 2); showtime.castVote('c', 1);
    showtime.castVote('c', 2); // changing a vote moves it
    expect(showtime.castVote('d', 3)).toBe(false);
    expect(coordinator.snapshot().showtime.vote!.options.map((option) => option.votes)).toEqual([0, 3]);
    const claimed = coordinator.claimNext();
    expect(claimed.boss.spec.meta.creator).toBe('second_viewer');
    expect(announced.some((text) => text.includes('Chat picked'))).toBe(true);
    expect(coordinator.snapshot().showtime.vote).toBeNull();
    expect(() => showtime.startVote()).toThrow(/current fight/);
    await showtime.close(); await coordinator.close();
  });

  it('does not start a poll right after chat forged a rematch: the upgrade is their pick', async () => {
    const { coordinator, showtime } = await setup({ autoVote: true, rematchVotes: 1 });
    await coordinator.submit({ creator: 'other_viewer', text: 'a neon orbiter swarm boss' }, 'demo');
    await coordinator.idle();
    expect(coordinator.snapshot().queue).toHaveLength(1);
    const claimed = coordinator.claimNext(); await coordinator.finishFight(claimed.id, 'won', stats);
    await vi.waitFor(() => expect(coordinator.snapshot().showtime.rematch?.status).toBe('open'));
    expect(coordinator.snapshot().showtime.rematch?.nextName).toMatch(/MK II$/);
    await coordinator.submit({ creator: 'third_viewer', text: 'a crystal laser sniper boss' }, 'demo');
    await showtime.rematchVote('fan', false); await coordinator.idle();
    expect(coordinator.snapshot().queue.length).toBeGreaterThanOrEqual(2);
    const rematchJob = coordinator.snapshot().jobs.find((job) => job.source === 'rematch')!;
    expect(coordinator.snapshot().queue[0]!.jobId).toBe(rematchJob.id);
    expect(coordinator.snapshot().showtime.vote).toBeNull();
    // The next break (after the rematch fight) can poll again.
    const rematchFight = coordinator.claimNext(); await coordinator.finishFight(rematchFight.id, 'lost', stats);
    expect(coordinator.snapshot().showtime.vote).toBeNull(); // only one boss left: nothing to vote on
    await coordinator.submit({ creator: 'fourth_viewer', text: 'a brass clockwork serpent boss' }, 'demo'); await coordinator.idle();
    await vi.waitFor(() => expect(coordinator.snapshot().showtime.vote).not.toBeNull());
    await showtime.close(); await coordinator.close();
  });

  it('answers chat commands for the leaderboard, record, and personal stats', async () => {
    const { coordinator, showtime, fight } = await setup();
    await fight('lost');
    const creator = replay.spec.meta.creator;
    const chat = (command: string, login = 'viewer', privileged = false) => showtime.handleChat({ login, privileged, command, argument: '', source: 'twitch' });
    expect(await chat('record')).toMatch(/0–1/);
    expect(await chat('mybosses', creator)).toMatch(/1 fight, 1 win vs the streamer/);
    expect(await chat('mybosses', 'nobody')).toMatch(/none of your bosses/);
    expect(await chat('top')).toMatch(creator === 'house_forge' ? /empty/ : /Hall of Fame/);
    expect(await chat('startvote')).toBeNull(); // not privileged: ignored
    await expect(chat('startvote', 'mod', true)).rejects.toThrow(/at least two/);
    await showtime.close(); await coordinator.close();
  });
});

describe('setup diagnostics', () => {
  it('reports readiness without leaking secrets', () => {
    const { coordinator } = harness();
    const env = { CODEX_API_KEY: 'sk-secret-codex', OPENAI_API_KEY: 'sk-secret-openai' } as NodeJS.ProcessEnv;
    const config = loadConfig([], env);
    const result = diagnostics(config, coordinator.snapshot(), 7, 'win32', 'v22.13.0');
    expect(JSON.stringify(result)).not.toMatch(/sk-secret/);
    expect(result.ready).toBe(true);
    expect(result.checks.find((check) => check.id === 'forge')).toMatchObject({ status: 'warn', fix: expect.stringMatching(/MXC/) });
    expect(result.checks.find((check) => check.id === 'moderation')?.status).toBe('ok');
    expect(result.checks.find((check) => check.id === 'show')?.detail).toMatch(/7 fights/);
    const old = diagnostics(loadConfig(['--demo'], {}), coordinator.snapshot(), 0, 'linux', 'v18.0.0');
    expect(old.ready).toBe(false);
    expect(old.checks.find((check) => check.id === 'twitch')?.status).toBe('off');
    expect(old.checks.find((check) => check.id === 'forge')?.detail).toMatch(/Cached replay/);
  });

  it('validates show settings from the environment', () => {
    expect(loadConfig(['--demo'], { REMATCH_VOTES: '5', VOTE_SECONDS: '30', AUTO_VOTE: 'false' }).showtime).toMatchObject({ rematchVotes: 5, voteMs: 30000, autoVote: false });
    expect(() => loadConfig(['--demo'], { REMATCH_VOTES: '0' })).toThrow(/REMATCH_VOTES/);
    expect(() => loadConfig(['--demo'], { VOTE_SECONDS: '5' })).toThrow(/VOTE_SECONDS/);
  });
});
