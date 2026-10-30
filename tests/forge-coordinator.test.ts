import { describe, expect, it, vi } from 'vitest';
import { ForgeSnapshotSchema } from '../engine/forge-protocol';
import { harness, verification } from './forge-helpers';
import type { ForgeJob } from '../engine/forge-protocol';
import type { Workspace } from '../server/forge/types';

const request = { creator: 'viewer_one', text: 'A slow fire boss with increasingly fast spirals.' };
describe('forge state machine', () => {
  it('holds local requests for approval and queues only a server-verified boss', async () => {
    const { coordinator, saved } = harness();
    const job = await coordinator.submit(request); await coordinator.idle();
    expect(coordinator.snapshot().jobs[0]?.status).toBe('pending');
    expect(coordinator.snapshot().queue).toHaveLength(0);
    await coordinator.review(job.id, true); await coordinator.idle();
    const state = coordinator.snapshot();
    expect(ForgeSnapshotSchema.safeParse(state).success).toBe(true);
    expect(state.jobs[0]?.status).toBe('queued'); expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.spec.meta.creator).toBe(request.creator);
    expect(saved.some((entry) => entry.status === 'queued')).toBe(true);
    await coordinator.close();
  });

  it('never trusts a ready claim and stops after three rejected gate attempts', async () => {
    const run = vi.fn(async () => ({ status: 'ready' as const, summary: 'I passed!', files: ['boss.json'] }));
    const createSession = vi.fn(() => ({ run }));
    const verify = vi.fn(async (_: Workspace, job: ForgeJob) => verification(job, false));
    const { coordinator } = harness({ agent: { createSession }, verify }, { autoApprove: true });
    await coordinator.submit(request); await coordinator.idle();
    expect(run).toHaveBeenCalledTimes(3); expect(verify).toHaveBeenCalledTimes(3); expect(createSession).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().queue).toHaveLength(0); expect(coordinator.snapshot().jobs[0]?.attempt).toBe(3);
    expect(coordinator.snapshot().jobs[0]?.status).toBe('failed');
    await coordinator.close();
  });

  it('reuses the session, forwards failure feedback, and persists the thread ID across revisions', async () => {
    const feedback: (string | null)[] = []; let revision = 0;
    const { coordinator, saved } = harness({
      agent: { createSession: () => ({ run: async (context) => { feedback.push(context.feedback); context.onThread('sdk-thread-1'); return { status: 'ready', summary: 'Ready', files: ['boss.json'] }; } }) },
      verify: async (_, job) => verification(job, ++revision > 1, revision),
    }, { autoApprove: true });
    await coordinator.submit(request); await coordinator.idle();
    expect(feedback[0]).toBeNull(); expect(feedback[1]).toContain('safeSpace');
    expect(coordinator.snapshot().queue[0]?.threadId).toBe('sdk-thread-1');
    expect(saved.some((job) => job.threadId === 'sdk-thread-1' && job.status === 'queued')).toBe(true);
    await coordinator.close();
  });

  it('does not accept an unchanged failed boss just because a later timing check passes', async () => {
    let attempt = 0;
    const { coordinator } = harness({ verify: async (_, job) => verification(job, ++attempt > 1, 1) }, { autoApprove: true });
    await coordinator.submit(request); await coordinator.idle();
    expect(coordinator.snapshot().queue).toHaveLength(0); expect(coordinator.snapshot().jobs[0]?.status).toBe('failed');
    await coordinator.close();
  });

  it('labels replay mode and does not fake a cached revision after a current gate failure', async () => {
    const verify = vi.fn(async (_: Workspace, job: ForgeJob) => verification(job, false));
    const { coordinator } = harness({ verify }, { mode: 'replay', demo: true, autoApprove: true });
    await coordinator.submit(request); await coordinator.idle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().jobs[0]?.message).toContain('Cached fixture failed');
    expect(coordinator.snapshot().events.some((event) => event.message.includes('no live Codex'))).toBe(true);
    await coordinator.close();
  });

  it('enforces cooldowns, rejects source spoofing, and allows later requests', async () => {
    let now = 100;
    const { coordinator } = harness({}, { now: () => now });
    await coordinator.submit(request);
    await expect(coordinator.submit(request)).rejects.toMatchObject({ status: 429 });
    await expect(coordinator.submit({ ...request, creator: 'other_viewer', source: 'demo' })).rejects.toThrow();
    now += 60000; await coordinator.submit(request);
    expect(coordinator.snapshot().jobs).toHaveLength(2);
    await coordinator.close();
  });

  it('bounds the queue and refills while the current fight is in progress', async () => {
    const { coordinator } = harness({}, { autoApprove: true });
    for (let index = 0; index < 7; index++) await coordinator.submit({ ...request, creator: `viewer_${index}` });
    await coordinator.idle(); expect(coordinator.snapshot().queue).toHaveLength(5);
    expect(coordinator.snapshot().jobs.filter((job) => job.status === 'waiting')).toHaveLength(2);
    const fight = coordinator.claimNext(); await coordinator.idle();
    expect(coordinator.snapshot().queue).toHaveLength(5); expect(coordinator.snapshot().activeFight?.id).toBe(fight.id);
    expect(() => coordinator.claimNext()).toThrow('already active');
    await coordinator.finishFight(fight.id, 'won'); await coordinator.finishFight(fight.id, 'won');
    expect(coordinator.snapshot().activeFight).toBeNull();
    await coordinator.close();
  });

  it('falls back to a verified house boss and lets an operator skip a stale fight', async () => {
    const { coordinator } = harness(); const fight = coordinator.claimNext();
    expect(fight.boss.mode).toBe('house'); expect(fight.boss.gate.passed).toBe(true);
    await coordinator.finishFight(fight.id, 'skipped'); expect(coordinator.snapshot().activeFight).toBeNull();
    await coordinator.close();
  });

  it('times out a nonresponsive agent without queueing or leaking its errors', async () => {
    const { coordinator } = harness({ agent: { createSession: () => ({ run: async () => new Promise(() => {}) }) } }, { autoApprove: true, attemptTimeoutMs: 10 });
    await coordinator.submit(request); await coordinator.idle();
    expect(coordinator.snapshot().jobs[0]?.status).toBe('failed'); expect(coordinator.snapshot().queue).toHaveLength(0);
    await coordinator.close();
  });

  it('aborts a running forge during shutdown', async () => {
    let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
    const { coordinator } = harness({ agent: { createSession: () => ({ run: async () => { started(); return new Promise(() => {}); } }) } }, { autoApprove: true });
    await coordinator.submit(request); await ready; await coordinator.close();
    expect(coordinator.snapshot().jobs[0]?.status).toBe('failed'); expect(coordinator.snapshot().queue).toHaveLength(0);
  });

  it('rejects review changes after a decision and never forges rejected requests', async () => {
    const prepare = vi.fn(async (job: ForgeJob) => ({ id: job.id, directory: '/virtual' }));
    const { coordinator } = harness({ prepare }); const job = await coordinator.submit(request);
    await coordinator.review(job.id, false); await coordinator.idle(); expect(prepare).not.toHaveBeenCalled();
    await expect(coordinator.review(job.id, true)).rejects.toMatchObject({ status: 409 }); await coordinator.close();
  });
});
