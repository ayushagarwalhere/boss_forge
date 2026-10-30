import { readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate, rejectedReport } from './runner';

const directory = dirname(fileURLToPath(import.meta.url));
let report;
try {
  try { await lstat(join(directory, 'boss.ts')); throw new Error('boss.ts is disabled.'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const path = join(directory, 'boss.json'), stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 128 * 1024) throw new Error('Expected a regular boss.json under 128 KiB.');
  const data = await readFile(path, 'utf8');
  if (Buffer.byteLength(data) > 128 * 1024) throw new Error('boss.json exceeds 128 KiB.');
  report = runGate(JSON.parse(data));
} catch (error) { report = rejectedReport(error instanceof Error ? error.message : 'Cannot read boss.json.'); }
await writeFile(join(directory, 'gate-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(report.summary);
process.exitCode = report.passed ? 0 : 1;
