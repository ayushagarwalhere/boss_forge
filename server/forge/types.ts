import type { z } from 'zod';
import type { AgentResultSchema, ForgeEvent, ForgeJob } from '../../engine/forge-protocol';
import type { BossSpec } from '../../engine/boss-api';
import type { FightStats } from '../../engine/forge-protocol';
import type { GateReport } from '../../engine/gate-report';

export interface Workspace { id: string; directory: string }
/** What the streamer just beat, handed to the forge for a harder "MK" upgrade. */
export interface RematchInput { previous: BossSpec; generation: number; stats: FightStats | null; gateWins?: number }
export interface AgentContext {
  job: ForgeJob; workspace: Workspace; feedback: string | null; signal: AbortSignal; rematch?: RematchInput | null;
  emit: (phase: ForgeEvent['phase'], message: string) => void;
  onThread: (id: string) => void;
}
export interface ForgeSession { run(context: AgentContext): Promise<z.infer<typeof AgentResultSchema>> }
export interface ForgeAgent { createSession(): ForgeSession }
export interface VerifiedBoss { spec: BossSpec | null; report: GateReport }
export interface ForgeServices {
  moderate(text: string, signal: AbortSignal): Promise<'api' | 'manual'>;
  prepare(job: ForgeJob, rematch?: RematchInput | null): Promise<Workspace>;
  verify(workspace: Workspace, job: ForgeJob): Promise<VerifiedBoss>;
  save(job: ForgeJob): Promise<void>;
  agent: ForgeAgent;
}
