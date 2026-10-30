import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BossSchema } from '../engine/boss-api';

const requested = process.argv.slice(2);
const paths = requested.length ? requested : (await readdir('bosses/house'))
  .filter((file) => file.endsWith('.json')).sort().map((file) => `bosses/house/${file}`);

if (!paths.length) throw new Error('No boss files found.');
for (const path of paths) {
  try {
    const boss = BossSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
    console.log(`VALID ${path}: ${boss.meta.name} (${boss.phases.length} phases; schema check only)`);
  } catch (error) {
    console.error(`INVALID ${path}:`, error);
    process.exitCode = 1;
  }
}
