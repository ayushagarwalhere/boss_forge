import { z } from 'zod';
import type { ForgeJob } from '../../engine/forge-protocol';
import type { ForgeCoordinator } from '../forge/coordinator';
import type { RewardsApi } from './rewards';

export const RedemptionEvent = z.object({ id: z.string().min(1).max(128), broadcaster_user_id: z.string(), user_login: z.string().regex(/^[a-z0-9_]{1,25}$/),
  user_input: z.string().max(10000), status: z.string(), reward: z.object({ id: z.string() }) });
type RecordEntry = { id: string; jobId: string | null; creator: string; target: 'CANCELED' | 'FULFILLED' | null; done: boolean };
export class Redemptions {
  private readonly records = new Map<string, RecordEntry>();
  private flushing: Promise<void> | null = null;
  constructor(private readonly coordinator: ForgeCoordinator, private readonly rewards: RewardsApi,
    private readonly broadcasterId: string, private readonly say: (message: string) => Promise<void>) {}
  async accept(input: unknown) {
    const parsed = RedemptionEvent.safeParse(input);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.broadcaster_user_id !== this.broadcasterId || event.reward.id !== this.rewards.id || event.status !== 'unfulfilled' || this.records.has(event.id)) return;
    const record: RecordEntry = { id: event.id, creator: event.user_login, jobId: null, target: null, done: false };
    this.records.set(event.id, record); this.trim();
    try {
      if (this.records.size > 5000) throw new Error('Too many unresolved redemptions.');
      const job = await this.coordinator.submit({ creator: event.user_login, text: event.user_input }, 'twitch');
      record.jobId = job.id;
    } catch { record.target = 'CANCELED'; }
    if (record.jobId) await this.say(`@${event.user_login} request ${record.jobId} received; waiting for approval or the forge.`).catch(() => {});
    this.observe(this.coordinator.snapshot().jobs);
    await this.flush();
  }
  observe(jobs: ForgeJob[]) {
    let changed = false;
    for (const record of this.records.values()) {
      if (record.done || record.target || !record.jobId) continue;
      const job = jobs.find((entry) => entry.id === record.jobId);
      if (job?.status === 'queued' || job?.status === 'finished') record.target = 'FULFILLED';
      else if (job?.status === 'failed' || job?.status === 'rejected') record.target = 'CANCELED';
      if (record.target) changed = true;
    }
    return changed;
  }
  /** A restart loses the process-local queue. Refund orphaned unfulfilled requests, including gap deliveries. */
  async recover() {
    this.observe(this.coordinator.snapshot().jobs);
    for (const id of await this.rewards.unfulfilled()) {
      if (!this.records.has(id)) this.records.set(id, { id, jobId: null, creator: '', target: 'CANCELED', done: false });
    }
    await this.flush(); this.trim();
    if ([...this.records.values()].some((record) => record.target && !record.done)) throw new Error('Outstanding redemption updates need attention.');
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      for (const record of this.records.values()) {
        if (!record.target || record.done) continue;
        try {
          await this.rewards.settle(record.id, record.target); record.done = true;
          if (record.target === 'CANCELED') {
            this.coordinator.notify(`${record.creator ? `@${record.creator}: ` : ''}Request canceled. Channel Points refunded.`, 'info', 'twitch');
            await this.say(`${record.creator ? `@${record.creator} ` : ''}That boss could not be queued. Your Channel Points were refunded; try a different idea.`);
          }
        } catch {
          this.coordinator.notify('A Channel Points update is pending. Retrying; moderators can inspect the Twitch reward queue.', 'warning', 'twitch');
          break;
        }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private trim() {
    for (const [id, record] of this.records) { if (this.records.size <= 4000) break; if (record.done) this.records.delete(id); }
  }
  async cancelPending() {
    for (const record of this.records.values()) if (!record.done && record.target !== 'FULFILLED') record.target = 'CANCELED';
    await this.flush();
  }
}
