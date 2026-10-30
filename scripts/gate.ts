import { gateFile, houseBossFiles, resolveBossFile, writeGateReport } from '../server/gate/files';
import { rejectedReport } from '../server/gate/runner';
import type { GateReport } from '../engine/gate-report';

const args = process.argv.slice(2);
const all = args.length === 1 && args[0] === '--all';
const reports: GateReport[] = [];
try {
  if (!all && args.length !== 1) throw new Error('Usage: npm run gate -- <id|path.json|--all>');
  const paths = all ? await houseBossFiles() : [await resolveBossFile(args[0]!)];
  if (!paths.length) throw new Error('No house bosses found.');
  for (const path of paths) {
    const report = await gateFile(path);
    const output = await writeGateReport(path, report);
    reports.push(report);
    console.error(`${report.summary}\nReport: ${output}`);
  }
} catch (error) {
  const report = rejectedReport(error instanceof Error ? error.message : String(error));
  reports.push(report); console.error(report.summary);
}
console.log(JSON.stringify(all ? reports : reports[0], null, 2));
process.exitCode = reports.length > 0 && reports.every((report) => report.passed) ? 0 : 1;
