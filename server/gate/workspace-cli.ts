import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate, rejectedReport } from './runner';
import { readBossFile } from '../scripts/load';

const directory = dirname(fileURLToPath(import.meta.url));
let report;
try {
  report = runGate(await readBossFile(join(directory, 'boss.json'), directory));
} catch (error) { report = rejectedReport(error instanceof Error ? error.message : 'Cannot read boss.json.'); }
await writeFile(join(directory, 'gate-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(report.summary);
process.exitCode = report.passed ? 0 : 1;
