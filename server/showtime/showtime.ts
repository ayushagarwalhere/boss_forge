import { randomUUID } from 'node:crypto';
import type { FightRecord, FightStats, ForgeFight, ForgeSnapshot, QueuedBoss, ShowtimeState } from '../../engine/forge-protocol';
import { EMPTY_SHOWTIME } from '../../engine/forge-protocol';
import { UserError, type ForgeCoordinator } from '../forge/coordinator';
import type { FightHistory } from './history';
import { MAX_GENERATION, rematchName } from './rematch';

export interface ShowtimeOptions {
  /** Distinct viewers needed to force a rematch (creator, broadcaster and moderators count as enough). */
  rematchVotes?: number;
  rematchWindowMs?: number;
  voteMs?: number;
  /** Open a "pick the next boss" poll automatically between fights when 2+ bosses are queued. */
  autoVote?: boolean;
  now?: () => number;
  id?: () => string;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}
export interface ChatCommand { login: string; privileged: boolean; command: string; argument: string; source: 'twitch' | 'demo' | 'local' }
export const SHOWTIME_COMMANDS = ['vote', 'rematch', 'top', 'record', 'mybosses', 'startvote'] as const;

type Pending = { fight: ForgeFight; generation: number; stats: FightStats | null; voters: Set<string> };

/**
 * Stream-show layer on top of the forge: post-fight recaps, the Rematch Patch window,
 * chat polls for the next boss, and a persistent Hall of Fame. Pure display/flow logic:
 * it never bypasses moderation or the fairness gate; rematches go through the same forge.
 */
export class Showtime {
  private state: ShowtimeState = structuredClone(EMPTY_SHOWTIME);
  private readonly listeners = new Set<(text: string) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly voters = new Map<string, number>();
  private pending: Pending | null = null;
  private rematchJobId: string | null = null;
  private intermission = 0;
  private votedIntermission = -1;
  private lastSnapshot: ForgeSnapshot | null = null;
  private unsubscribe: Array<() => void> = [];
  private closed = false;
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly needed: number;

  constructor(private readonly coordinator: ForgeCoordinator, private readonly history: FightHistory, private readonly options: ShowtimeOptions = {}) {
    this.now = options.now ?? Date.now; this.id = options.id ?? randomUUID;
    this.needed = Math.max(1, Math.min(50, options.rematchVotes ?? 3));
  }

  async start() {
    await this.history.load();
    this.state.hall = this.history.hall();
    this.unsubscribe.push(this.coordinator.onFightFinished((fight, outcome, stats) => { void this.fightFinished(fight, outcome, stats); }));
    this.unsubscribe.push(this.coordinator.subscribe((snapshot) => this.observe(snapshot)));
    this.coordinator.setClaimHook(() => this.beforeClaim());
    this.publish();
  }

  /** Announcements go to Twitch chat (when connected) and the overlay. */
  onAnnounce(listener: (text: string) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot() { return structuredClone(this.state); }

  private publish() { if (!this.closed) this.coordinator.setShowtime(this.state); }
  private announce(text: string) {
    this.state.announcements.push({ id: this.id(), at: this.now(), text: text.slice(0, 300) });
    if (this.state.announcements.length > 10) this.state.announcements.shift();
    for (const listener of this.listeners) listener(text);
  }
  private later(fn: () => void, ms: number) {
    const set = this.options.setTimer ?? setTimeout;
    const timer = set(() => { this.timers.delete(timer); if (!this.closed) fn(); }, ms);
    this.timers.add(timer);
  }

  // ---- Fights, recaps, Hall of Fame ---------------------------------------
  private generationOf(boss: QueuedBoss) {
    const job = this.lastSnapshot?.jobs.find((entry) => entry.id === boss.jobId);
    return job?.rematch?.generation ?? 1;
  }

  private async fightFinished(fight: ForgeFight, outcome: 'won' | 'lost' | 'skipped', stats: FightStats | null) {
    this.intermission++;
    if (outcome === 'skipped') { this.state.recap = null; this.publish(); return; }
    const generation = this.generationOf(fight.boss);
    const record: FightRecord = {
      id: fight.id, at: this.now(), boss: fight.boss.spec.meta.name, creator: fight.boss.spec.meta.creator, mode: fight.boss.mode,
      outcome, specHash: fight.boss.gate.specHash.slice(0, 64), generation, stats,
    };
    await this.history.add(record);
    this.state.recap = record; this.state.hall = this.history.hall();
    const time = stats ? ` in ${Math.floor(stats.seconds / 60)}:${String(stats.seconds % 60).padStart(2, '0')}` : '';
    const record_ = `Streamer record ${this.state.hall.wins}–${this.state.hall.losses}.`;
    if (outcome === 'lost') {
      this.announce(`💀 ${record.boss} by @${record.creator} defeated the streamer${time}! ${record_} @${record.creator} climbs the Hall of Fame (!top).`);
    } else {
      this.announce(`🏆 The streamer beat ${record.boss} by @${record.creator}${time}${stats ? ` with ${stats.heartsLeft} heart${stats.heartsLeft === 1 ? '' : 's'} left` : ''}. ${record_}`);
      if (generation < MAX_GENERATION) this.openRematch(fight, generation, stats);
    }
    this.publish();
  }

  // ---- Rematch Patch -------------------------------------------------------
  private openRematch(fight: ForgeFight, generation: number, stats: FightStats | null) {
    const windowMs = this.options.rematchWindowMs ?? 60000;
    this.pending = { fight, generation, stats, voters: new Set() };
    this.state.rematch = { fightId: fight.id, boss: fight.boss.spec.meta.name, nextName: rematchName(fight.boss.spec.meta.name, generation + 1), creator: fight.boss.spec.meta.creator, generation,
      endsAt: this.now() + windowMs, votes: 0, needed: this.needed, status: 'open',
      message: `Type !rematch (${this.needed} needed) and Codex upgrades it to ${rematchName(fight.boss.spec.meta.name, generation + 1)}.` };
    this.announce(`🔁 Rematch? ${this.needed} viewers typing !rematch (or @${fight.boss.spec.meta.creator}) sends ${fight.boss.spec.meta.name} back to the forge as ${rematchName(fight.boss.spec.meta.name, generation + 1)}. ${Math.round(windowMs / 1000)}s!`);
    const fightId = fight.id;
    this.later(() => {
      if (this.state.rematch?.fightId === fightId && this.state.rematch.status === 'open') {
        this.state.rematch = { ...this.state.rematch, status: 'expired', message: 'Rematch window closed.' };
        this.pending = null; this.publish();
        this.later(() => { if (this.state.rematch?.fightId === fightId) { this.state.rematch = null; this.publish(); } }, 5000);
      }
    }, windowMs);
  }

  /** A viewer (or the streamer from the console) asks for the rematch. Returns a chat reply or null. */
  async rematchVote(login: string, privileged: boolean): Promise<string | null> {
    const window = this.state.rematch, pending = this.pending;
    if (!window || !pending || window.status !== 'open') return window?.status === 'forging' ? 'The rematch is already in the forge.' : null;
    const decisive = privileged || login === window.creator;
    pending.voters.add(login);
    window.votes = pending.voters.size;
    if (!decisive && pending.voters.size < this.needed) { this.publish(); return null; }
    await this.triggerRematch(decisive && login === window.creator ? `@${login} demanded a rematch!` : 'Chat demanded a rematch!');
    return null;
  }

  private async triggerRematch(reason: string) {
    const window = this.state.rematch, pending = this.pending;
    if (!window || !pending) return;
    this.pending = null;
    const next = pending.generation + 1, name = rematchName(window.boss, next);
    this.state.rematch = { ...window, status: 'forging', message: `${reason} ${this.coordinator.snapshot().mode === 'replay' ? 'Offline tuner (no live Codex)' : 'Codex'} is building ${name}; the gate decides.` };
    this.announce(`⚒️ ${reason} ${window.boss} goes back to the forge as ${name}. It still has to pass the fairness gate.`);
    this.publish();
    try {
      const job = await this.coordinator.submitRematch({ fightId: window.fightId, previous: pending.fight.boss.spec, generation: next, stats: pending.stats, gateWins: pending.fight.boss.gate.wins });
      this.rematchJobId = job.id;
    } catch (error) {
      this.state.rematch = { ...this.state.rematch!, status: 'failed', message: error instanceof UserError ? error.message : 'The rematch could not start.' };
      this.publish();
    }
  }

  private trackRematch(snapshot: ForgeSnapshot) {
    const window = this.state.rematch;
    if (!window || window.status !== 'forging' || !this.rematchJobId) return;
    const job = snapshot.jobs.find((entry) => entry.id === this.rematchJobId);
    if (!job || !['queued', 'failed', 'rejected'].includes(job.status)) return;
    const fightId = window.fightId;
    if (job.status === 'queued') {
      this.votedIntermission = this.intermission; // the rematch is chat's pick for this break
      const boss = snapshot.queue.find((entry) => entry.jobId === job.id);
      this.state.rematch = { ...window, status: 'queued', message: `${boss?.spec.meta.name ?? 'The upgrade'} passed the gate (bot ${job.gate?.wins ?? '?'}/5) and fights next.` };
      this.announce(`✅ ${boss?.spec.meta.name ?? 'The rematch'} passed the fairness gate (bot won ${job.gate?.wins ?? '?'}/5) and is up next. Good luck, streamer.`);
    } else {
      this.state.rematch = { ...window, status: 'failed', message: 'The gate rejected the upgrade: too unfair to ship.' };
      this.announce(`❌ The gate rejected ${rematchName(window.boss, window.generation + 1)}: too unfair to ship. The original stays in the Hall of Fame.`);
    }
    this.rematchJobId = null;
    this.publish();
    this.later(() => { if (this.state.rematch?.fightId === fightId) { this.state.rematch = null; this.publish(); } }, 20000);
  }

  // ---- Chat poll: pick the next boss ---------------------------------------
  startVote(): ShowtimeState['vote'] {
    const snapshot = this.coordinator.snapshot();
    if (snapshot.activeFight) throw new UserError('Finish the current fight before starting a vote.', 409);
    if (this.state.vote && !this.state.vote.closed) throw new UserError('A vote is already running.', 409);
    if (snapshot.queue.length < 2) throw new UserError('A vote needs at least two verified bosses in the queue.', 409);
    const ms = this.options.voteMs ?? 45000, id = this.id();
    this.voters.clear();
    this.state.vote = { id, endsAt: this.now() + ms, closed: false, winner: null,
      options: snapshot.queue.slice(0, 3).map((boss) => ({ queueId: boss.id, name: boss.spec.meta.name, creator: boss.spec.meta.creator, votes: 0 })) };
    this.votedIntermission = this.intermission;
    this.announce(`🗳️ Vote for the next boss! ${this.state.vote.options.map((option, index) => `!vote ${index + 1} ${option.name} (@${option.creator})`).join(' · ')} — ${Math.round(ms / 1000)}s.`);
    this.later(() => { if (this.state.vote?.id === id && !this.state.vote.closed) this.closeVote(); }, ms);
    this.publish();
    return structuredClone(this.state.vote);
  }

  castVote(login: string, choice: number): boolean {
    const vote = this.state.vote;
    if (!vote || vote.closed || !Number.isInteger(choice) || choice < 1 || choice > vote.options.length) return false;
    const previous = this.voters.get(login);
    if (previous === choice - 1) return true;
    if (previous !== undefined) vote.options[previous]!.votes--;
    vote.options[choice - 1]!.votes++; this.voters.set(login, choice - 1);
    this.publish(); return true;
  }

  closeVote() {
    const vote = this.state.vote;
    if (!vote || vote.closed) return;
    let winner = 0;
    vote.options.forEach((option, index) => { if (option.votes > vote.options[winner]!.votes) winner = index; });
    vote.closed = true; vote.winner = winner;
    const chosen = vote.options[winner]!, total = vote.options.reduce((sum, option) => sum + option.votes, 0);
    const promoted = this.coordinator.promote(chosen.queueId);
    this.announce(promoted ? `🗳️ Chat picked ${chosen.name} by @${chosen.creator} (${chosen.votes}/${total} votes). It fights next!` : `🗳️ Vote closed, but ${chosen.name} already left the queue.`);
    const id = vote.id;
    this.later(() => { if (this.state.vote?.id === id) { this.state.vote = null; this.publish(); } }, 15000);
    this.publish();
  }

  private beforeClaim() {
    if (this.state.vote && !this.state.vote.closed) this.closeVote();
    this.state.recap = null;
    if (this.state.rematch && ['expired', 'queued', 'failed'].includes(this.state.rematch.status)) {
      // A queued rematch used up this break: chat already chose the next fight.
      if (this.state.rematch.status === 'queued') this.votedIntermission = this.intermission;
      this.state.rematch = null;
    }
  }

  private observe(snapshot: ForgeSnapshot) {
    this.lastSnapshot = snapshot;
    this.trackRematch(snapshot);
    if (snapshot.activeFight && this.state.vote?.closed) { this.state.vote = null; this.publish(); }
    const autoVote = this.options.autoVote ?? true;
    const rematchBusy = this.state.rematch && ['open', 'forging', 'queued'].includes(this.state.rematch.status);
    if (autoVote && !snapshot.activeFight && !this.state.vote && !rematchBusy && snapshot.queue.length >= 2 && this.votedIntermission !== this.intermission) {
      try { this.startVote(); } catch { /* conditions changed; try again on the next snapshot */ }
    }
  }

  /** Setup page: show a sample announcement on the overlay (and in chat when connected). */
  preview() {
    this.announce('🎬 Boss Forge overlay test: chat designs the boss, Codex builds it, the streamer fights it.');
    this.publish();
  }

  // ---- Chat commands -------------------------------------------------------
  async handleChat(command: ChatCommand): Promise<string | null> {
    switch (command.command) {
      case 'vote': {
        const vote = this.state.vote;
        if (!vote || vote.closed) return null;
        this.castVote(command.login, Number(command.argument.split(/\s+/)[0]));
        return null;
      }
      case 'rematch': return this.rematchVote(command.login, command.privileged);
      case 'startvote':
        if (!command.privileged) return null;
        this.startVote(); return null;
      case 'record': {
        const hall = this.state.hall;
        return `Streamer record: ${hall.wins}–${hall.losses}${hall.streak ? ` (${Math.abs(hall.streak)}-fight ${hall.streak > 0 ? 'win' : 'losing'} streak)` : ''}.${hall.feared[0] ? ` Most feared: ${hall.feared[0].boss} by @${hall.feared[0].creator} (${hall.feared[0].defeats} wins).` : ''}`;
      }
      case 'top': {
        const top = this.state.hall.creators;
        return top.length ? `Hall of Fame: ${top.map((entry, index) => `${index + 1}. @${entry.creator} ${entry.score} pts (${entry.streamerDefeats} wins vs streamer)`).join(' · ')}` : 'The Hall of Fame is empty. Forge a boss that beats the streamer: !boss <idea>';
      }
      case 'mybosses': {
        const mine = this.history.creator(command.login);
        return mine.fights ? `@${command.login}: ${mine.fights} fight${mine.fights === 1 ? '' : 's'}, ${mine.defeats} win${mine.defeats === 1 ? '' : 's'} vs the streamer${mine.best > 1 ? `, best upgrade MK ${mine.best}` : ''}.` : `@${command.login} none of your bosses have fought yet. Try !boss <idea>.`;
      }
      default: return null;
    }
  }

  async close() {
    this.closed = true;
    for (const stop of this.unsubscribe.splice(0)) stop();
    this.coordinator.setClaimHook(null);
    for (const timer of this.timers) (this.options.clearTimer ?? clearTimeout)(timer);
    this.timers.clear();
    await this.history.flush();
  }
}
