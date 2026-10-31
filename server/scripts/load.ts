import { lstat, realpath, open } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, basename } from 'node:path';
import { BossSchema } from '../../engine/boss-api';
import { compileIsolated } from './isolate';

export async function readLocalFile(directory: string, name: string, limit: number) {
  const root = await realpath(directory), path = join(root, name), stat = await lstat(path), actual = await realpath(path), subpath = relative(root, actual);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit || subpath.startsWith('..') || isAbsolute(subpath)) throw new Error(`Expected regular workspace-local ${name} under ${limit} bytes.`);
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink !== 1 || opened.size > limit) throw new Error('Boss file changed during validation.');
    const bytes = await handle.readFile(); if (bytes.length > limit) throw new Error('Boss file exceeds its size limit.');
    return bytes.toString('utf8');
  } finally { await handle.close(); }
}
export async function readBossFile(path: string, runtimeDirectory: string) {
  const directory = dirname(path), spec = BossSchema.parse(JSON.parse(await readLocalFile(directory, basename(path), 128 * 1024)));
  if (spec.choreography) throw new Error('Inline choreography is not accepted. Supply boss.ts; only the server compiles commands.');
  const name = `${basename(path, '.json')}.ts`;
  let source: string;
  try { source = await readLocalFile(directory, name, 16384); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return spec; throw error; }
  spec.choreography = await compileIsolated(source, runtimeDirectory);
  return spec;
}
