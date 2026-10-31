import { readFile, stat, access, mkdir, writeFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GateReportSchema, type GateReport } from '../../engine/gate-report';
import { rejectedReport, runGate } from './runner';
import { buildScriptRuntime } from '../scripts/bundle';
import { readBossFile } from '../scripts/load';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };

/** Plain IDs are confined to forge/<id>/boss.json or bosses/house/<id>.json.
 * Explicit .json paths are a local CLI feature, never a server route parameter.
 */
export async function resolveBossFile(target: string, root = PROJECT_ROOT): Promise<string> {
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(target)) {
    const forge = join(root, 'forge', target, 'boss.json');
    if (await exists(forge)) return forge;
    const house = join(root, 'bosses', 'house', `${target}.json`);
    if (await exists(house)) return house;
    throw new Error(`Boss ID '${target}' not found in forge/ or bosses/house/.`);
  }
  if (target.endsWith('.json') && !target.startsWith('--')) return resolve(target);
  throw new Error('Use a simple boss ID, an explicit .json path, or --all.');
}

export async function gateFile(path: string): Promise<GateReport> {
  const scripted = await exists(path.replace(/\.json$/, '.ts'));
  try {
    if ((await stat(path)).size > 128 * 1024) return rejectedReport('Boss JSON exceeds the 128 KiB input limit.');
    const input: unknown = scripted ? await readBossFile(path, await buildScriptRuntime()) : JSON.parse(await readFile(path, 'utf8'));
    if (!scripted && input && typeof input === 'object' && 'choreography' in input) return rejectedReport('Inline choreography is not accepted; supply the actual source.', 'scriptSupport');
    // Never load a neighboring report or trust an agent's prior pass claim.
    return runGate(input);
  } catch (error) { return rejectedReport(error instanceof Error ? error.message : String(error), scripted ? 'scriptSupport' : 'schema'); }
}

export async function writeGateReport(path: string, report: GateReport, root = PROJECT_ROOT) {
  const name = basename(path, '.json') === 'boss' ? basename(dirname(path)) : basename(path, '.json');
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const directory = join(root, '.artifacts', 'gates');
  await mkdir(directory, { recursive: true });
  const output = join(directory, `${safeName}.json`);
  const body = `${JSON.stringify(GateReportSchema.parse(report), null, 2)}\n`;
  await writeFile(output, body);
  if (dirname(dirname(path)) === join(root, 'forge')) await writeFile(join(dirname(path), 'gate-report.json'), body);
  return output;
}

export async function houseBossFiles(root = PROJECT_ROOT) {
  const directory = join(root, 'bosses', 'house');
  return (await readdir(directory)).filter((name) => name.endsWith('.json')).sort().map((name) => join(directory, name));
}
