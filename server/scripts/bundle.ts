import { build } from 'esbuild';
import { mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = fileURLToPath(new URL('../../', import.meta.url));
const builds = new Map<string, Promise<string>>();
export const CJS_BANNER = "import { createRequire } from 'node:module'; import { fileURLToPath as modulePath } from 'node:url'; import { dirname as moduleDir } from 'node:path'; const require = createRequire(import.meta.url); const __filename = modulePath(import.meta.url); const __dirname = moduleDir(__filename);";
export function buildScriptRuntime(root = rootDirectory) {
  const previous = builds.get(root); if (previous) return previous;
  const task = (async () => {
    const directory = join(root, '.artifacts', 'runtime'); await mkdir(directory, { recursive: true });
    const temporary = join(directory, `script-worker-${randomUUID()}.mjs`);
    await build({ entryPoints: [join(rootDirectory, 'server/scripts/worker.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20',
      banner: { js: CJS_BANNER },
      outfile: temporary, logLevel: 'silent' });
    await rename(temporary, join(directory, 'script-worker.mjs'));
    return directory;
  })();
  builds.set(root, task); void task.catch(() => builds.delete(root)); return task;
}
