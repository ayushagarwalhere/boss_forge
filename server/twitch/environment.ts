import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../gate/files';

let writes = Promise.resolve();
/** Serialize token rotation and reward updates without overwriting unrelated settings. */
export function saveEnvironment(values: Record<string, string>, path = join(PROJECT_ROOT, '.env.local')) {
  const task = writes.then(async () => {
    let contents = '';
    try { contents = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (contents.length > 131072) throw new Error('Local environment file is too large.');
    for (const [key, value] of Object.entries(values)) {
      if (!/^TWITCH_[A-Z_]+$/.test(key) || /[\r\n]/.test(value)) throw new Error('Invalid Twitch setting.');
      const quote = ["'", '"', '`'].find((candidate) => !value.includes(candidate));
      if (!quote) throw new Error('Unsupported characters in Twitch setting.');
      const line = `${key}=${quote}${value}${quote}`, pattern = new RegExp(`^${key}=.*$`, 'gm');
      contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
    }
    await writeFile(`${path}.tmp`, contents, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  });
  writes = task.catch(() => {}); return task;
}
