import { z } from 'zod';

const nonnegative = z.number().min(0);
const worstWindow = z.strictObject({ seed: z.number().int(), probe: z.boolean(), endingTick: z.number().int(), safeCells: z.number().int().min(0) });
const run = z.strictObject({
  seed: z.number().int(), outcome: z.enum(['won', 'lost', 'timeout', 'exception']),
  combatSeconds: nonnegative, inputSteps: z.number().int().min(0), hearts: z.number().int().min(0).max(3), bossHpRemaining: nonnegative,
  minSafeFraction: z.number().min(0).max(1), maxLiveBullets: z.number().int().min(0), droppedBullets: z.number().int().min(0),
  maxTargetedBulletSpeed: nonnegative, phasesSeen: z.array(z.number().int().min(0)), finalStateHash: z.string(), error: z.string().nullable(),
});

export const GateReportSchema = z.strictObject({
  version: z.literal(1), policyVersion: z.string(), botVersion: z.string(),
  bossName: z.string(), specHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), passed: z.boolean(), summary: z.string(),
  scope: z.literal('specs and server-compiled script commands at difficulty 1; source code never executes in the sim'),
  checks: z.array(z.strictObject({
    id: z.enum(['schema', 'telegraphs', 'aimedSpeed', 'bulletCap', 'safeSpace', 'ttk', 'beatable', 'interesting', 'exceptions', 'tickBudget', 'scriptSupport']),
    passed: z.boolean(), requirement: z.string(), observed: z.number().nullable(), details: z.array(z.string()),
  })),
  policy: z.strictObject({
    seeds: z.array(z.number().int()).length(5), difficulty: z.literal(1), minWins: z.number(), maxWins: z.number(),
    minSafeFraction: z.number(), windowTicks: z.number(), gridColumns: z.number(), gridRows: z.number(),
    minTelegraphMs: z.number(), maxTargetedSpeed: z.number(), maxBullets: z.number(),
    minTtkSeconds: z.number(), maxTtkSeconds: z.number(), tickBudgetMs: z.number(), tickBudgetPercentile: z.number().min(0.5).max(1),
  }),
  metrics: z.strictObject({
    wins: z.number().int().min(0).max(5), losses: z.number().int().min(0).max(5), timeouts: z.number().int().min(0).max(5),
    minSafeFraction: z.number().min(0).max(1).nullable(), estimatedTtkSeconds: nonnegative.nullable(),
    maxLiveBullets: z.number().int().min(0), droppedBullets: z.number().int().min(0), maxTargetedBulletSpeed: nonnegative,
    exceptions: z.number().int().min(0), coveredPhases: z.array(z.number().int().min(0)), worstWindow: worstWindow.nullable(),
  }),
  timing: z.strictObject({
    sampleCount: z.number().int().min(0), maxTickMs: nonnegative, p99TickMs: nonnegative,
    overBudgetTicks: z.number().int().min(0), budgetMs: z.number().positive(),
    scope: z.literal('stepGame only; wall-clock measurements vary by host'),
  }),
  runs: z.array(run).max(5), damageProbes: z.array(run).max(5),
});

export type GateReport = z.infer<typeof GateReportSchema>;
export type FightReport = z.infer<typeof run>;
export type GateCheck = GateReport['checks'][number];
export function gateReportJsonSchema() {
  return { ...z.toJSONSchema(GateReportSchema, { target: 'draft-2020-12' }), title: 'Boss Forge GateReport v1' };
}
