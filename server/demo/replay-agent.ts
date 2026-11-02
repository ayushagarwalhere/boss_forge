import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { BossSchema } from '../../engine/boss-api';
import { GATE_POLICY } from '../../engine/fairness-policy';
import { GateReportSchema } from '../../engine/gate-report';
import { PROJECT_ROOT } from '../gate/files';
import { specHash } from '../gate/runner';
import type { ForgeAgent, ForgeSession } from '../forge/types';
import { tuneForRematch } from '../showtime/tuner';

export const ReplaySchema = z.strictObject({
  version: z.literal(1), origin: z.literal('offline house-template recording; not a Codex SDK run'),
  template: z.string(), spec: BossSchema, report: GateReportSchema,
  events: z.array(z.strictObject({ offsetMs: z.number().min(0), phase: z.enum(['reading', 'writing', 'testing']), message: z.string().max(250) })).min(1).max(20),
});
export type Replay = z.infer<typeof ReplaySchema>;

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Forge canceled.')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new Error('Forge canceled.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class ReplayAgent implements ForgeAgent {
  constructor(private readonly root = PROJECT_ROOT, private readonly speed = 1) {}
  createSession(): ForgeSession {
    return { run: async (context) => {
      if (context.rematch) {
        // Offline tuner, clearly labeled: deterministic upgrade of the beaten boss, then the server gate decides.
        const steps = ['Offline tuner: reading the beaten boss and the fight stats.', 'Offline tuner: tightening cadence and sharpening the final phase.', 'Offline tuner: wrote the MK upgrade; the server gate decides.'];
        for (const [index, message] of steps.entries()) {
          await delay(700 / this.speed, context.signal);
          context.emit(index === 0 ? 'reading' : 'writing', `Cached replay: ${message}`);
        }
        const tuned = tuneForRematch(context.rematch.previous, context.rematch.generation, context.rematch.stats, context.rematch.gateWins);
        await writeFile(join(context.workspace.directory, 'boss.json'), `${JSON.stringify(tuned, null, 2)}\n`);
        return { status: 'ready', summary: 'Offline rematch tuner (no live Codex). Server must reverify.', files: ['boss.json'] };
      }
      const text = context.job.text.toLowerCase();
      const template = /serpent|clockwork|golden|brass/.test(text) ? 'brass-serpent' : /crystal|laser|sniper|gem|violet|void/.test(text) ? 'prism-warden' : /swarm|blob|minion|orbiter|neon/.test(text) ? 'neon-brood' : 'ember-anvil';
      const replay = ReplaySchema.parse(JSON.parse(await readFile(join(this.root, 'bosses', 'replays', `${template}.json`), 'utf8')));
      if (!replay.report.passed || replay.report.policyVersion !== GATE_POLICY.version || replay.report.specHash !== specHash(replay.spec)) throw new Error('Replay fixture is stale or unverified; run npm run demo:record.');
      let previous = 0;
      for (const event of replay.events) {
        await delay(Math.max(150, Math.min(1500, event.offsetMs - previous)) / this.speed, context.signal);
        previous = event.offsetMs;
        context.emit(event.phase, `Cached replay: ${event.message}`);
        if (event.phase === 'writing') {
          const spec = structuredClone(replay.spec);
          spec.meta.creator = context.job.creator; spec.meta.sourceQuote = context.job.text;
          await writeFile(join(context.workspace.directory, 'boss.json'), `${JSON.stringify(spec, null, 2)}\n`);
        }
      }
      return { status: 'ready', summary: 'Cached house-template replay. No live Codex generation; server must reverify.', files: ['boss.json'] };
    } };
  }
}
