import type { z } from 'zod';
import type { AgentResultSchema, ForgeEvent, ForgeJob } from '../../engine/forge-protocol';
import type { BossSpec } from '../../engine/boss-api';
import type { GateReport } from '../../engine/gate-report';

export interface Workspace { id: string; directory: string }
export interface AgentContext {
  job: ForgeJob; workspace: Workspace; feedback: string | null; signal: AbortSignal;
  emit: (phase: ForgeEvent['phase'], message: string) => void;
  onThread: (id: string) => void;
}
export interface ForgeSession { run(context: AgentContext): Promise<z.infer<typeof AgentResultSchema>> }
export interface ForgeAgent { createSession(): ForgeSession }
export interface VerifiedBoss { spec: BossSpec | null; report: GateReport }
export interface ForgeServices {
  prepare(job: ForgeJob): Promise<Workspace>;
  verify(workspace: Workspace, job: ForgeJob): Promise<VerifiedBoss>;
  save(job: ForgeJob): Promise<void>;
  agent: ForgeAgent;
  /** Optional viewer-text moderation; demo requests are trusted fixtures and skip it. */
  moderate?: (text: string) => Promise<{ allowed: boolean; reason: string | null }>;
}
