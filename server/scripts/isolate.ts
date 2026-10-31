import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { ScriptTapeSchema, type ScriptTape } from '../../engine/boss-api';

export function compileIsolated(source: string, runtimeDirectory: string): Promise<ScriptTape> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(runtimeDirectory, 'script-worker.mjs'), { workerData: source,
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }, env: {}, execArgv: [] });
    let settled = false;
    const fail = () => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); reject(new Error('Script failed validation, isolation, or execution limits.')); };
    const timer = setTimeout(fail, 10000);
    worker.once('error', fail); worker.once('exit', () => { if (!settled) fail(); });
    worker.once('message', (message: unknown) => {
      if (settled) return;
      const parsed = message && typeof message === 'object' && 'tape' in message ? ScriptTapeSchema.safeParse(message.tape) : null;
      if (!parsed?.success) { fail(); return; }
      settled = true; clearTimeout(timer); void worker.terminate(); resolve(parsed.data);
    });
  });
}
