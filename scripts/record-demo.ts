import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { BossSchema } from '../engine/boss-api';
import { PROJECT_ROOT, houseBossFiles } from '../server/gate/files';
import { runGate } from '../server/gate/runner';
import { ReplaySchema, type Replay } from '../server/demo/replay-agent';

const directory = join(PROJECT_ROOT, 'bosses', 'replays'); await mkdir(directory, { recursive: true });
async function cleanup(temp: string) {
  if (!basename(temp).startsWith('boss-forge-record-') || !temp.startsWith(tmpdir())) throw new Error('Unsafe recording cleanup path.');
  await rm(temp, { recursive: true, force: true });
}
for (const path of await houseBossFiles()) {
  let hasScript = false;
  try { await lstat(path.replace(/\.json$/, '.ts')); hasScript = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (hasScript) throw new Error('Scripted house templates need explicit source replay support; do not record a JSON-only replay.');
  const temp = await mkdtemp(join(tmpdir(), 'boss-forge-record-'));
  try {
    const start = performance.now(), events: Replay['events'] = [];
    const record = (phase: Replay['events'][number]['phase'], message: string) => events.push({ offsetMs: Math.round(performance.now() - start), phase, message });
    record('reading', 'Read the recorded house-template brief.');
    const spec = BossSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    await writeFile(join(temp, 'boss.json'), JSON.stringify(spec));
    record('writing', `Wrote ${spec.meta.name} from the house template.`);
    record('testing', 'Started the recorded offline fairness run.');
    const report = runGate(spec);
    if (!report.passed) throw new Error(`${spec.meta.name}: ${report.summary}; do not record a failing fixture.`);
    record('testing', report.summary);
    const template = basename(path, '.json');
    const replay = ReplaySchema.parse({ version: 1, origin: 'offline house-template recording; not a Codex SDK run', template, spec, report, events });
    await writeFile(join(directory, `${template}.json`), `${JSON.stringify(replay, null, 2)}\n`);
    console.log(`Recorded offline fixture: ${spec.meta.name}`);
  } finally {
    await cleanup(temp);
  }
}
