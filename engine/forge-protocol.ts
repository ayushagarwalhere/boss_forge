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
  id: z.string().regex(/^[a-z0-9-]{1,64}$/), creator: z.string(), text: z.string(), source: z.enum(['local', 'demo', 'twitch', 'rematch']),
  mode: ForgeModeSchema, status: JobStatusSchema, attempt: z.number().int().min(0).max(3),
  moderation: z.enum(['api', 'manual', 'demo', 'rematch']),
  threadId: z.string().nullable(), createdAt: z.number(), message: z.string(), gate: GateSummarySchema.nullable(),
  /** Set when this job upgrades a boss the streamer beat ("Rematch Patch"). */
  rematch: z.strictObject({ of: z.string().max(64), previousName: z.string().max(24), generation: z.number().int().min(2).max(9) }).nullable().default(null),
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
/** Display-only fight stats reported by the arena; the outcome itself stays authoritative. */
export const FightStatsSchema = z.strictObject({
  seconds: z.number().int().min(0).max(3600), heartsLeft: z.number().int().min(0).max(9),
  bossHpLeft: z.number().min(0).max(1), hitsTaken: z.number().int().min(0).max(99), phaseReached: z.number().int().min(1).max(5),
});
export type FightStats = z.infer<typeof FightStatsSchema>;
export const FightRecordSchema = z.strictObject({
  id: z.string().max(64), at: z.number(), boss: z.string().max(24), creator: z.string().max(25), mode: z.enum(['codex', 'replay', 'house']),
  outcome: z.enum(['won', 'lost']), specHash: z.string().max(64), generation: z.number().int().min(1).max(9), stats: FightStatsSchema.nullable(),
});
export type FightRecord = z.infer<typeof FightRecordSchema>;
export const HallSchema = z.strictObject({
  wins: z.number().int().min(0), losses: z.number().int().min(0), streak: z.number().int(),
  creators: z.array(z.strictObject({ creator: z.string(), fights: z.number().int(), streamerDefeats: z.number().int(), rematches: z.number().int(), score: z.number().int() })).max(5),
  feared: z.array(z.strictObject({ boss: z.string(), creator: z.string(), defeats: z.number().int(), fights: z.number().int() })).max(3),
  recent: z.array(FightRecordSchema).max(5),
});
export type Hall = z.infer<typeof HallSchema>;
export const VoteSchema = z.strictObject({
  id: z.string(), endsAt: z.number(), closed: z.boolean(), winner: z.number().int().min(0).max(2).nullable(),
  options: z.array(z.strictObject({ queueId: z.string(), name: z.string().max(24), creator: z.string(), votes: z.number().int().min(0) })).min(2).max(3),
});
export type ForgeVote = z.infer<typeof VoteSchema>;
export const RematchWindowSchema = z.strictObject({
  fightId: z.string(), boss: z.string().max(24), nextName: z.string().max(24), creator: z.string(), generation: z.number().int().min(1).max(9),
  endsAt: z.number(), votes: z.number().int().min(0), needed: z.number().int().min(1), status: z.enum(['open', 'forging', 'queued', 'failed', 'expired']), message: z.string().max(200),
});
export type RematchWindow = z.infer<typeof RematchWindowSchema>;
export const ShowtimeSchema = z.strictObject({
  vote: VoteSchema.nullable(), rematch: RematchWindowSchema.nullable(), recap: FightRecordSchema.nullable(), hall: HallSchema,
  announcements: z.array(z.strictObject({ id: z.string(), at: z.number(), text: z.string().max(300) })).max(10),
});
export type ShowtimeState = z.infer<typeof ShowtimeSchema>;
export const EMPTY_SHOWTIME: ShowtimeState = { vote: null, rematch: null, recap: null, hall: { wins: 0, losses: 0, streak: 0, creators: [], feared: [], recent: [] }, announcements: [] };
export const ForgeSnapshotSchema = z.strictObject({
  version: z.literal(1), mode: ForgeModeSchema, demo: z.boolean(), autoApprove: z.boolean(), moderationMode: z.enum(['api', 'manual']),
  jobs: z.array(ForgeJobSchema).max(50), queue: z.array(QueuedBossSchema).max(5),
  activeFight: FightSchema.nullable(), events: z.array(ForgeEventSchema).max(200),
  chat: z.array(z.strictObject({ creator: z.string(), text: z.string(), at: z.number() })).max(50),
  twitch: TwitchStateSchema, toasts: z.array(ToastSchema).max(20),
  showtime: ShowtimeSchema,
});
export type ForgeSnapshot = z.infer<typeof ForgeSnapshotSchema>;
