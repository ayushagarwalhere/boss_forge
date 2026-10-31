import { z } from 'zod';
import { BossSchema } from './boss-api';

export const ViewerRequestSchema = z.strictObject({
  creator: z.string().regex(/^[a-z0-9_]{1,25}$/),
  text: z.string().trim().min(5).max(1000),
});
export const AgentResultSchema = z.strictObject({
  status: z.enum(['ready', 'failed']),
  summary: z.string().min(1).max(300),
  files: z.array(z.string().max(80)).max(5),
});
export const agentOutputSchema = () => z.toJSONSchema(AgentResultSchema, { target: 'draft-07' });
export const ForgeModeSchema = z.enum(['codex', 'replay']);
export type ForgeMode = z.infer<typeof ForgeModeSchema>;
export const JobStatusSchema = z.enum(['pending', 'waiting', 'building', 'verifying', 'queued', 'rejected', 'failed', 'finished']);
export const GateSummarySchema = z.strictObject({
  passed: z.boolean(), summary: z.string(), specHash: z.string(), policyVersion: z.string(),
  wins: z.number().int(), safeFraction: z.number().nullable(), ttkSeconds: z.number().nullable(), errors: z.number().int(),
});
export type GateSummary = z.infer<typeof GateSummarySchema>;
export const ForgeJobSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/), creator: z.string(), text: z.string(), source: z.enum(['local', 'demo', 'twitch']),
  mode: ForgeModeSchema, status: JobStatusSchema, attempt: z.number().int().min(0).max(3),
  threadId: z.string().nullable(), createdAt: z.number(), message: z.string(), gate: GateSummarySchema.nullable(),
});
export type ForgeJob = z.infer<typeof ForgeJobSchema>;
export const ForgeEventSchema = z.strictObject({
  seq: z.number().int(), at: z.number(), jobId: z.string(), mode: z.enum(['codex', 'replay', 'server']),
  phase: z.enum(['request', 'review', 'reading', 'writing', 'testing', 'revising', 'verifying', 'queued', 'failed', 'fight']),
  message: z.string().max(300),
});
export type ForgeEvent = z.infer<typeof ForgeEventSchema>;
export const QueuedBossSchema = z.strictObject({
  id: z.string(), jobId: z.string().nullable(), mode: z.enum(['codex', 'replay', 'house']),
  threadId: z.string().nullable(), spec: BossSchema, gate: GateSummarySchema,
});
export type QueuedBoss = z.infer<typeof QueuedBossSchema>;
export const FightSchema = z.strictObject({ id: z.string(), boss: QueuedBossSchema, seed: z.number().int(), startedAt: z.number() });
export type ForgeFight = z.infer<typeof FightSchema>;
export const TwitchStateSchema = z.strictObject({
  status: z.enum(['off', 'demo', 'connecting', 'connected', 'error']), channel: z.string().nullable(),
  reward: z.enum(['off', 'active', 'unavailable']), message: z.string().max(300),
});
export type TwitchState = z.infer<typeof TwitchStateSchema>;
export const ToastSchema = z.strictObject({
  id: z.string(), at: z.number(), kind: z.enum(['info', 'success', 'warning']),
  source: z.enum(['twitch', 'demo', 'local']), message: z.string().max(300),
});
export type ForgeToast = z.infer<typeof ToastSchema>;
export const ForgeSnapshotSchema = z.strictObject({
  version: z.literal(1), mode: ForgeModeSchema, demo: z.boolean(), autoApprove: z.boolean(),
  jobs: z.array(ForgeJobSchema).max(50), queue: z.array(QueuedBossSchema).max(5),
  activeFight: FightSchema.nullable(), events: z.array(ForgeEventSchema).max(200),
  chat: z.array(z.strictObject({ creator: z.string(), text: z.string(), at: z.number() })).max(50),
  twitch: TwitchStateSchema, toasts: z.array(ToastSchema).max(20),
});
export type ForgeSnapshot = z.infer<typeof ForgeSnapshotSchema>;
