import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GateReportSchema } from '../engine/gate-report';
import { gateFile, PROJECT_ROOT, resolveBossFile, writeGateReport } from '../server/gate/files';

const fixture = JSON.parse(await readFile(new URL('../bosses/house/ember-anvil.json', import.meta.url), 'utf8'));
fixture.hp = 1; fixture.phases = [fixture.phases[0]];
let root: string;
let cliOutput: string | null;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'boss-forge-gate-')); cliOutput = null; });
afterEach(async () => {
  // Verify the complete computed cleanup target stays in our named temp fixture area.
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('boss-forge-gate-')) throw new Error('Unsafe test cleanup target.');
  await rm(root, { recursive: true, force: true });
  if (cliOutput) await rm(cliOutput, { force: true });
});

describe('gate files and CLI', () => {
  it('resolves safe IDs and prefers runtime workspaces over house names', async () => {
    const houseDirectory = join(root, 'bosses', 'house'), forgeDirectory = join(root, 'forge', 'example');
    await mkdir(houseDirectory, { recursive: true }); await mkdir(forgeDirectory, { recursive: true });
    await writeFile(join(houseDirectory, 'example.json'), JSON.stringify(fixture));
    expect(await resolveBossFile('example', root)).toBe(join(houseDirectory, 'example.json'));
    await writeFile(join(forgeDirectory, 'boss.json'), JSON.stringify(fixture));
    expect(await resolveBossFile('example', root)).toBe(join(forgeDirectory, 'boss.json'));
    await expect(resolveBossFile('../escape', root)).rejects.toThrow();
    await expect(resolveBossFile('missing', root)).rejects.toThrow();
    expect(await resolveBossFile(join(forgeDirectory, 'boss.json'), root)).toBe(join(forgeDirectory, 'boss.json'));
  });

  it('reruns the actual boss despite a forged neighboring pass and persists the new report', async () => {
    const directory = join(root, 'forge', 'viewer_boss'); await mkdir(directory, { recursive: true });
    const path = join(directory, 'boss.json');
    await writeFile(path, JSON.stringify(fixture));
    await writeFile(join(directory, 'gate-report.json'), '{"passed":true}');
    const report = await gateFile(path);
    expect(report.passed).toBe(false); expect(report.runs).toHaveLength(5);
    const output = await writeGateReport(path, report, root);
    expect(GateReportSchema.parse(JSON.parse(await readFile(output, 'utf8')))).toEqual(report);
    expect(JSON.parse(await readFile(join(directory, 'gate-report.json'), 'utf8'))).toEqual(report);
  });

  it('refuses to certify or execute a neighboring boss.ts', async () => {
    const path = join(root, 'boss.json');
    await writeFile(path, JSON.stringify(fixture));
    await writeFile(join(root, 'boss.ts'), 'throw new Error("This must never execute");');
    const report = await gateFile(path);
    expect(report.passed).toBe(false); expect(report.runs).toHaveLength(0);
    expect(report.checks[0]?.id).toBe('scriptSupport');
  });

  it('rejects malformed, missing, and oversized JSON with structured reports', async () => {
    const path = join(root, 'broken.json'); await writeFile(path, '{ broken');
    expect((await gateFile(path)).passed).toBe(false);
    expect((await gateFile(join(root, 'missing.json'))).passed).toBe(false);
    await writeFile(path, ' '.repeat(128 * 1024 + 1));
    expect((await gateFile(path)).summary).toContain('128 KiB');
  });

  it('prints JSON and returns failure status for a trivial fight and invalid CLI usage', async () => {
    const name = basename(root);
    const path = join(root, `${name}.json`); await writeFile(path, JSON.stringify(fixture));
    cliOutput = join(PROJECT_ROOT, '.artifacts', 'gates', `${name}.json`);
    const script = fileURLToPath(new URL('../scripts/gate.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, path], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 30000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
    const report = GateReportSchema.parse(JSON.parse(result.stdout));
    expect(report.passed).toBe(false); expect(report.metrics.wins).toBe(5);
    expect(result.stderr).toContain('Rejected');
    const invalid = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 30000 });
    expect(invalid.status).toBe(1); expect(JSON.parse(invalid.stdout).summary).toContain('Usage:');
  }, 30000);
});
