import { readFile } from 'node:fs/promises';
import { ReplaySchema } from '../server/demo/replay-agent';
import { gateSummary, ForgeCoordinator } from '../server/forge/coordinator';
import { specHash } from '../server/gate/runner';
import type { ForgeJob } from '../engine/forge-protocol';
import type { ForgeServices } from '../server/forge/types';

export const replay = ReplaySchema.parse(JSON.parse(await readFile(new URL('../bosses/replays/ember-anvil.json', import.meta.url), 'utf8')));
export function verification(job: ForgeJob, passed = true, revision = 1) {
  const spec = structuredClone(replay.spec); spec.meta.creator = job.creator; spec.meta.sourceQuote = job.text;
  spec.meta.name = `Test boss ${revision}`;
  const report = structuredClone(replay.report); report.specHash = specHash(spec); report.passed = passed;
  if (!passed) { report.checks.find((check) => check.id === 'safeSpace')!.passed = false; report.summary = 'Rejected: safeSpace'; }
  return { spec, report };
}
export function harness(overrides: Partial<ForgeServices> = {}, options: Partial<ConstructorParameters<typeof ForgeCoordinator>[2]> = {}) {
  let count = 0;
  const saved: ForgeJob[] = [];
  const services: ForgeServices = {
    moderate: async () => 'api',
    agent: { createSession: () => ({ run: async () => ({ status: 'ready', summary: 'Agent claims ready.', files: ['boss.json'] }) }) },
    prepare: async (job) => ({ id: job.id, directory: `/virtual/${job.id}` }),
    verify: async (_, job) => verification(job), save: async (job) => { saved.push(structuredClone(job)); }, ...overrides,
  };
  const house = [{ id: 'house-test', jobId: null, mode: 'house' as const, threadId: null, spec: replay.spec, gate: gateSummary(replay.report) }];
  return { coordinator: new ForgeCoordinator(services, house, { mode: 'codex', demo: false, autoApprove: false, id: () => `test-${++count}`, ...options }), services, saved };
}
