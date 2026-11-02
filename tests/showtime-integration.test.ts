import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BossSchema } from '../engine/boss-api';
import type { ForgeJob } from '../engine/forge-protocol';
import { buildRuntime, prepareWorkspace, readBoss } from '../server/forge/artifacts';
import { runtimeCodexOptions } from '../server/forge/codex-agent';
import { ReplayAgent } from '../server/demo/replay-agent';
import { DemoCrowd } from '../server/demo/crowd';
import { createForgeHttp } from '../server/http';
import { FightHistory } from '../server/showtime/history';
import { Showtime } from '../server/showtime/showtime';
import { ChatCommands } from '../server/twitch/chat';
import { harness, replay } from './forge-helpers';
import scripted from '../bosses/examples/scripted/boss.json';

const chat = (text: string, id: string, login = 'viewer_test', badges: { set_id: string }[] = [], userId = '3') => ({ broadcaster_user_id: '1', chatter_user_id: userId, chatter_user_login: login, message_id: id, message: { text }, badges });
const stats = { seconds: 70, heartsLeft: 2, bossHpLeft: 0, hitsTaken: 1, phaseReached: 2 };

describe('Twitch chat routes show commands', () => {
  it('passes votes and rematch calls silently, rate-limits leaderboards, and gates !startvote', async () => {
    const { coordinator } = harness(); const say = vi.fn(async () => {}); let now = 100;
    const handler = vi.fn(async (command: { command: string }) => (command.command === 'top' ? 'Hall of Fame: …' : null));
    const commands = new ChatCommands(coordinator, '1', '2', say, () => now, handler);
    await commands.accept(chat('!boss a polite toaster boss', 'm1'));
    await commands.accept(chat('!vote 2', 'm2')); // right after !boss: votes bypass the per-user reply limiter
    await commands.accept(chat('!rematch', 'm3'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ command: 'vote', argument: '2', login: 'viewer_test', privileged: false, source: 'twitch' }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ command: 'rematch' }));
    await commands.accept(chat('!top', 'm4')); await commands.accept(chat('!top', 'm5', 'someone_else', [], '4'));
    expect(say.mock.calls.filter((call) => (call as unknown[])[0] === 'Hall of Fame: …')).toHaveLength(1);
    now += 10001; await commands.accept(chat('!top', 'm6', 'someone_else', [], '4'));
    expect(say.mock.calls.filter((call) => (call as unknown[])[0] === 'Hall of Fame: …')).toHaveLength(2);
    await commands.accept(chat('!startvote', 'm7'));
    expect(handler).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'startvote' }));
    await commands.accept(chat('!startvote', 'm8', 'a_mod', [{ set_id: 'moderator' }], '5'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ command: 'startvote', privileged: true }));
    await coordinator.close();
  });

  it('ignores show commands when no show is attached', async () => {
    const { coordinator } = harness(); const say = vi.fn(async () => {});
    const commands = new ChatCommands(coordinator, '1', '2', say);
    await commands.accept(chat('!top', 'x1')); await commands.accept(chat('!vote 1', 'x2'));
    expect(say).not.toHaveBeenCalled();
    await coordinator.close();
  });
});

describe('show HTTP routes', () => {
  it('accepts bounded fight stats, controls polls and rematches with the local token, and keeps diagnostics read-only', async () => {
    const { coordinator } = harness({}, { cooldownMs: 0 });
    const showtime = new Showtime(coordinator, new FightHistory(null), { rematchVotes: 2, autoVote: false });
    await showtime.start();
    const twitchTest = vi.fn(async () => {});
    const app = createForgeHttp(coordinator, 0, false, { showtime, twitchTest, diagnostics: () => ({ ready: true }) });
    await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const { token } = await (await fetch(`${url}/api/session`)).json() as { token: string };
    const post = (path: string, body: unknown, withToken = true) => fetch(`${url}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(withToken ? { 'x-forge-token': token } : {}) }, body: JSON.stringify(body) });

    expect(await (await fetch(`${url}/api/diagnostics`)).json()).toEqual({ ready: true });
    expect((await post('showtime/vote', { action: 'start' }, false)).status).toBe(403);
    expect((await post('showtime/vote', { action: 'start' })).status).toBe(409); // fewer than two queued
    expect((await post('showtime/rematch', {})).status).toBe(409); // no window yet

    const fight = coordinator.claimNext();
    expect((await post('finish', { id: fight.id, outcome: 'won', stats: { ...stats, hitsTaken: 500 } })).status).toBe(400);
    expect((await post('finish', { id: fight.id, outcome: 'won', stats })).status).toBe(200);
    await vi.waitFor(() => expect(coordinator.snapshot().showtime.recap?.stats).toEqual(stats));
    expect(coordinator.snapshot().showtime.rematch?.status).toBe('open');
    expect((await post('showtime/rematch', {})).status).toBe(200);
    expect(['forging', 'queued']).toContain(coordinator.snapshot().showtime.rematch?.status); // the test forge is instant
    expect((await post('showtime/preview', {})).status).toBe(200);
    expect(coordinator.snapshot().showtime.announcements.at(-1)?.text).toMatch(/overlay test/i);
    expect((await post('twitch/test', {})).status).toBe(200);
    expect(twitchTest).toHaveBeenCalledOnce();

    await coordinator.idle(); await showtime.close(); await coordinator.close(); await app.close();
    const bare = harness(), bareApp = createForgeHttp(bare.coordinator, 0);
    await new Promise<void>((done) => bareApp.server.listen(0, '127.0.0.1', done));
    const bareUrl = `http://127.0.0.1:${(bareApp.server.address() as { port: number }).port}`;
    const bareToken = (await (await fetch(`${bareUrl}/api/session`)).json() as { token: string }).token;
    const response = await fetch(`${bareUrl}/api/twitch/test`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-token': bareToken }, body: '{}' });
    expect(response.status).toBe(409); expect((await response.json() as { error: string }).error).toMatch(/TWITCH_ENABLED/);
    await bare.coordinator.close(); await bareApp.close();
  });
});

let root: string;
const rematchJob = (id: string): ForgeJob => ({ id, creator: scripted.meta.creator, text: scripted.meta.sourceQuote, source: 'rematch', mode: 'replay', moderation: 'rematch', rematch: { of: 'fight-1', previousName: scripted.meta.name, generation: 2 }, status: 'building', attempt: 1, threadId: null, createdAt: 0, message: '', gate: null });
describe('Rematch Patch workspace', () => {
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'boss-forge-rematch-')); await mkdir(join(root, 'forge')); await buildRuntime(root); }, 60000);
  afterAll(async () => {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('boss-forge-rematch-')) throw new Error('Unsafe cleanup.');
    await rm(root, { recursive: true, force: true });
  });

  it('gives Codex the beaten boss (without compiled choreography) and the fight brief as read-only inputs', async () => {
    const previous = BossSchema.parse({ ...scripted, choreography: { version: 1, seed: 1337, sourceHash: 'a'.repeat(64), frames: [] } });
    const workspace = await prepareWorkspace(rematchJob('forge-rematch-ws'), root, { previous, generation: 2, stats });
    const prior = JSON.parse(await readFile(join(workspace.directory, 'previous-boss.json'), 'utf8'));
    expect(prior.choreography).toBeUndefined(); expect(prior.meta.name).toBe(scripted.meta.name);
    const brief = JSON.parse(await readFile(join(workspace.directory, 'rematch.json'), 'utf8'));
    expect(brief).toMatchObject({ generation: 2, fight: stats, mustKeep: { creator: scripted.meta.creator } });
    expect(brief.name.endsWith('MK II')).toBe(true);
    const options = runtimeCodexOptions(workspace.directory, join(root, 'home'), dirname(process.execPath), 'test-key');
    const filesystem = options.configOverrides?.join(' ') ?? '';
    // Both rematch inputs are pinned read-only in the agent's permission profile.
    expect(filesystem).toMatch(/previous-boss\.json" = "read"/);
    expect(filesystem).toMatch(/rematch\.json" = "read"/);
  });

  it('offline replay mode tunes the beaten boss instead of pretending to run Codex', async () => {
    const previous = BossSchema.parse(scripted), job = rematchJob('forge-rematch-tune');
    const rematch = { previous, generation: 2, stats, gateWins: 3 };
    const workspace = await prepareWorkspace(job, root, rematch), emitted: string[] = [];
    const result = await new ReplayAgent(root, 1000).createSession().run({ job, workspace, feedback: null, signal: new AbortController().signal, rematch,
      emit: (_, message) => emitted.push(message), onThread: () => {} });
    expect(result.summary).toMatch(/Offline rematch tuner \(no live Codex\)/);
    expect(emitted.every((message) => message.startsWith('Cached replay: Offline tuner'))).toBe(true);
    const upgraded = await readBoss(workspace);
    expect(upgraded.meta).toMatchObject({ creator: previous.meta.creator, sourceQuote: previous.meta.sourceQuote });
    expect(upgraded.meta.name).toBe(`${previous.meta.name} MK II`.length <= 24 ? `${previous.meta.name} MK II` : upgraded.meta.name);
    expect(upgraded.hp).toBeGreaterThan(previous.hp);
  });
});

describe('demo crowd', () => {
  it('casts simulated votes and rematch calls, labeled as demo activity', async () => {
    vi.useFakeTimers();
    try {
      const { coordinator } = harness({}, { cooldownMs: 0 });
      const showtime = new Showtime(coordinator, new FightHistory(null), { rematchVotes: 3, autoVote: true });
      await showtime.start();
      let roll = 0; const crowd = new DemoCrowd(coordinator, showtime, () => (roll = (roll + 0.37) % 1), 10);
      crowd.start();
      await coordinator.submit({ creator: 'demo_one', text: 'a heavy fire furnace boss' }, 'demo');
      await coordinator.submit({ creator: 'demo_two', text: 'a neon orbiter swarm boss' }, 'demo');
      await vi.waitFor(async () => { await coordinator.idle(); expect(coordinator.snapshot().showtime.vote).not.toBeNull(); });
      await vi.advanceTimersByTimeAsync(2000);
      const votes = coordinator.snapshot().showtime.vote!.options.reduce((sum, option) => sum + option.votes, 0);
      expect(votes).toBeGreaterThanOrEqual(4);
      expect(coordinator.snapshot().toasts.some((toast) => toast.source === 'demo' && /voting/.test(toast.message))).toBe(true);

      const fight = coordinator.claimNext();
      await coordinator.finishFight(fight.id, 'won', stats);
      await vi.advanceTimersByTimeAsync(0);
      expect(coordinator.snapshot().showtime.rematch?.status).toBe('open');
      await vi.advanceTimersByTimeAsync(2000);
      expect(['forging', 'queued']).toContain(coordinator.snapshot().showtime.rematch?.status);
      crowd.close(); await coordinator.idle(); await showtime.close(); await coordinator.close();
    } finally { vi.useRealTimers(); }
  });
});

void replay;
