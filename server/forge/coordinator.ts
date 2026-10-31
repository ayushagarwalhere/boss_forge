import { randomUUID } from 'node:crypto';
import { ViewerRequestSchema, TwitchStateSchema, ToastSchema, type ForgeToast, type TwitchState, type ForgeFight, type ForgeEvent, type ForgeJob, type ForgeMode, type ForgeSnapshot, type QueuedBoss, type GateSummary } from '../../engine/forge-protocol';
import { GATE_POLICY } from '../../engine/fairness-policy';
import type { GateReport } from '../../engine/gate-report';
import type { ForgeServices } from './types';

export class UserError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export function gateSummary(report: GateReport): GateSummary {
  if (!report.specHash) throw new Error('Missing gate spec hash.');
  return { passed: report.passed, summary: report.summary, specHash: report.specHash, policyVersion: report.policyVersion,
    wins: report.metrics.wins, safeFraction: report.metrics.minSafeFraction, ttkSeconds: report.metrics.estimatedTtkSeconds, errors: report.metrics.exceptions };
}
type Options = { mode: ForgeMode; demo: boolean; autoApprove: boolean; moderationMode?: 'api' | 'manual'; attemptTimeoutMs?: number; cooldownMs?: number; now?: () => number; id?: () => string };

export class ForgeCoordinator {
  private readonly state: ForgeSnapshot;
  private readonly listeners = new Set<(state: ForgeSnapshot) => void>();
  private readonly fightListeners = new Set<(fight: ForgeFight, outcome: 'won' | 'lost' | 'skipped') => void>();
  private readonly cooldown = new Map<string, number>();
  private readonly completedFights: string[] = [];
  private task: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private saves = Promise.resolve();
  private persistenceFailed = new Set<string>();
  private closing = false;
  private sequence = 0;
  private round = 0;
  private intakeCount = 0;
  private readonly intakeAbort = new AbortController();
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(private readonly services: ForgeServices, private readonly house: QueuedBoss[], private readonly options: Options) {
    if (!house.length || house.some((boss) => !boss.gate.passed)) throw new Error('Verified house fallbacks are required.');
    this.now = options.now ?? Date.now; this.id = options.id ?? randomUUID;
    this.state = { version: 1, mode: options.mode, demo: options.demo, autoApprove: options.autoApprove && options.moderationMode !== 'manual', moderationMode: options.moderationMode ?? 'manual', jobs: [], queue: [], activeFight: null, events: [], chat: [], toasts: [],
      twitch: { status: options.demo ? 'demo' : 'off', channel: null, reward: 'off', message: options.demo ? 'Simulated viewers. Twitch is disconnected.' : 'Twitch is disabled. Local requests are available.' } };
  }

  snapshot() { return structuredClone(this.state); }
  subscribe(listener: (state: ForgeSnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onFightFinished(listener: (fight: ForgeFight, outcome: 'won' | 'lost' | 'skipped') => void) { this.fightListeners.add(listener); return () => this.fightListeners.delete(listener); }
  setTwitch(state: TwitchState) { this.state.twitch = TwitchStateSchema.parse(state); this.publish(); }
  notify(message: string, kind: ForgeToast['kind'] = 'info', source: ForgeToast['source'] = 'local') {
    this.state.toasts.push(ToastSchema.parse({ id: this.id(), at: this.now(), message: message.slice(0, 300), kind, source }));
    if (this.state.toasts.length > 20) this.state.toasts.shift(); this.publish();
  }
  private publish() { for (const listener of this.listeners) listener(this.snapshot()); }
  private event(job: ForgeJob | null, phase: ForgeEvent['phase'], message: string, mode: ForgeEvent['mode'] = 'server') {
    this.state.events.push({ seq: ++this.sequence, at: this.now(), jobId: job?.id ?? '', mode, phase, message: message.slice(0, 300) });
    if (this.state.events.length > 200) this.state.events.shift();
    if (job) job.message = message.slice(0, 300);
    this.publish();
  }
  private persist(job: ForgeJob) {
    const copy = structuredClone(job), task = this.saves.then(() => this.services.save(copy));
    this.saves = task.catch(() => { this.persistenceFailed.add(job.id); });
    return task;
  }

  async submit(input: unknown, source: ForgeJob['source'] = 'local'): Promise<ForgeJob> {
    if (this.closing) throw new UserError('The forge is shutting down.', 503);
    const parsed = ViewerRequestSchema.safeParse(input);
    if (!parsed.success) throw new UserError('Use a lowercase Twitch login and a 5–1000 character boss description.');
    const { creator, text } = parsed.data, now = this.now(), cooldown = this.options.cooldownMs ?? 60000;
    for (const [user, at] of this.cooldown) if (now - at >= cooldown) this.cooldown.delete(user);
    if (this.cooldown.has(creator)) throw new UserError('One boss request per viewer per minute.', 429);
    if (this.intakeCount + this.state.jobs.filter((job) => !['failed', 'rejected', 'finished'].includes(job.status)).length >= 10) throw new UserError('The forge is full. Try again after a fight.', 429);
    this.cooldown.set(creator, now); this.intakeCount++;
    let moderation: ForgeJob['moderation'];
    try { moderation = source === 'demo' ? 'demo' : await this.services.moderate(text, this.intakeAbort.signal); }
    finally { this.intakeCount--; }
    if (this.closing) throw new UserError('The forge is shutting down.', 503);
    const job: ForgeJob = { id: `forge-${this.id()}`, creator, text, source, mode: this.options.mode,
      status: (this.options.autoApprove && moderation === 'api') || source === 'demo' ? 'waiting' : 'pending', moderation, attempt: 0, threadId: null, createdAt: now, message: moderation === 'manual' ? 'No API moderation. Manual approval is required.' : 'Awaiting moderator approval.', gate: null };
    this.state.jobs.push(job); this.cooldown.set(creator, now);
    while (this.state.jobs.length > 50) {
      const index = this.state.jobs.findIndex((entry) => ['failed', 'rejected', 'finished'].includes(entry.status));
      if (index < 0) break;
      this.persistenceFailed.delete(this.state.jobs[index]!.id); this.state.jobs.splice(index, 1);
    }
    this.state.chat.push({ creator, text: `!boss ${text}`, at: now }); if (this.state.chat.length > 50) this.state.chat.shift();
    await this.persist(job);
    this.event(job, 'request', source === 'demo' ? 'Simulated viewer submitted a boss request.' : 'Viewer request received.');
    if (job.status === 'waiting') this.event(job, 'review', 'Request approved; waiting for the forge.');
    this.kick(); return structuredClone(job);
  }

  async review(id: string, approve: boolean) {
    const job = this.state.jobs.find((entry) => entry.id === id);
    if (!job || job.status !== 'pending') throw new UserError('This request is not awaiting approval.', 409);
    job.status = approve ? 'waiting' : 'rejected';
    await this.persist(job);
    this.event(job, 'review', approve ? 'Local moderator approved the request.' : 'Local moderator rejected the request.');
    this.kick();
  }

  private kick() {
    if (this.closing || this.task) return;
    this.task = this.drain().finally(() => {
      this.task = null;
      if (!this.closing && this.state.queue.length < 5 && this.state.jobs.some((job) => job.status === 'waiting')) this.kick();
    });
  }
  private async drain() {
    while (!this.closing && this.state.queue.length < 5) {
      const job = this.state.jobs.find((entry) => entry.status === 'waiting'); if (!job) return;
      try { await this.forge(job); }
      catch {
        job.status = 'failed';
        this.event(job, 'failed', this.closing ? 'Forge stopped during shutdown; request was not queued.' : 'Forge failed or timed out. No boss was queued. Check local setup and credentials.');
        await this.persist(job).catch(() => {});
      }
    }
  }
  private async forge(job: ForgeJob) {
    job.status = 'building';
    const workspace = await this.services.prepare(job), session = this.services.agent.createSession();
    let feedback: string | null = null;
    let lastRejectedHash: string | null = null;
    for (let attempt = 1; attempt <= 3 && !this.closing; attempt++) {
      job.attempt = attempt; job.status = 'building';
      this.event(job, attempt === 1 ? 'reading' : 'revising', attempt === 1 ? `Starting ${job.mode === 'replay' ? 'cached replay; no live Codex generation' : 'live Codex forge'}.` : `Revision ${attempt}/3: repair the failed gate checks.`, job.mode);
      await this.persist(job);
      this.controller = new AbortController();
      const controller = this.controller;
      const timer = setTimeout(() => controller.abort(), this.options.attemptTimeoutMs ?? 180000);
      let rejectAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error('Forge generation canceled or timed out.')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
      try {
        await Promise.race([session.run({ job: structuredClone(job), workspace, feedback, signal: controller.signal,
          emit: (phase, message) => { if (!controller.signal.aborted) this.event(job, phase, message, job.mode); },
          onThread: (id) => { if (!controller.signal.aborted) { job.threadId = id; void this.persist(job).catch(() => {}); } },
        }), aborted]);
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAbort); this.controller = null; }
      if (this.closing) throw new Error('Forge closed.');
      job.status = 'verifying'; this.event(job, 'verifying', 'Server is validating the actual boss and rerunning its independent gate.');
      const verified = await this.services.verify(workspace, structuredClone(job));
      if (this.closing) throw new Error('Forge closed during verification.');
      const report = verified.report;
      job.gate = report.specHash ? gateSummary(report) : null;
      if (report.passed && verified.spec) {
        if (lastRejectedHash === report.specHash) throw new Error('An unchanged rejected boss needs a real revision.');
        await this.saves;
        if (this.persistenceFailed.has(job.id)) throw new Error('Request metadata could not be saved.');
        job.status = 'queued'; job.message = report.summary; await this.persist(job);
        this.state.queue.push({ id: job.id, jobId: job.id, mode: job.mode, threadId: job.threadId, spec: structuredClone(verified.spec), gate: gateSummary(report) });
        this.event(job, 'queued', report.summary); return;
      }
      feedback = JSON.stringify(report.checks.filter((check) => !check.passed));
      lastRejectedHash = report.specHash;
      this.event(job, 'testing', `Server gate rejected attempt ${attempt}/3: ${report.checks.filter((check) => !check.passed).map((check) => check.id).join(', ')}.`);
      await this.persist(job);
      if (job.mode === 'replay') break; // Cached fixtures cannot perform a genuine model revision.
    }
    job.status = 'failed'; job.message = job.mode === 'replay' ? 'Cached fixture failed the current server gate. No boss was queued.' : 'Rejected after three gate attempts. No boss was queued.';
    await this.persist(job); this.event(job, 'failed', job.message);
  }

  claimNext() {
    if (this.state.activeFight) throw new UserError('A fight is already active. Finish or skip it first.', 409);
    const boss = this.state.queue.shift() ?? structuredClone(this.house[this.round % this.house.length]!);
    this.state.activeFight = { id: this.id(), boss, seed: GATE_POLICY.seeds[this.round++ % GATE_POLICY.seeds.length]!, startedAt: this.now() };
    this.event(null, 'fight', `Fight started: ${boss.spec.meta.name} by @${boss.spec.meta.creator}.`);
    this.kick(); return structuredClone(this.state.activeFight);
  }
  async finishFight(id: string, outcome: 'won' | 'lost' | 'skipped') {
    if (this.completedFights.includes(id)) return;
    const fight = this.state.activeFight;
    if (!fight || fight.id !== id) throw new UserError('This fight is no longer active.', 409);
    this.state.activeFight = null; this.completedFights.push(id); if (this.completedFights.length > 50) this.completedFights.shift();
    const job = this.state.jobs.find((entry) => entry.id === fight.boss.jobId);
    if (job) { job.status = 'finished'; await this.persist(job); }
    this.event(job ?? null, 'fight', `${fight.boss.spec.meta.name}: ${outcome === 'won' ? 'boss defeated' : outcome === 'lost' ? 'streamer defeated' : 'fight skipped'}.`);
    this.notify(`${outcome === 'won' ? 'Boss defeated' : outcome === 'lost' ? 'Defeated by' : 'Fight skipped'}: ${fight.boss.spec.meta.name} by @${fight.boss.spec.meta.creator}.`, outcome === 'won' ? 'success' : 'info', this.options.demo ? 'demo' : 'local');
    for (const listener of this.fightListeners) listener(structuredClone(fight), outcome);
    this.kick();
  }
  async idle() { while (this.task) await this.task; await this.saves; }
  async close() { this.closing = true; this.intakeAbort.abort(); this.controller?.abort(); await this.idle(); }
}
