import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { AttackSchema, BossSchema, bossJsonSchema, type BossSpec } from '../engine/boss-api';

const directory = new URL('../bosses/house/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
const fixtures: unknown[] = await Promise.all(files.map(async (name) =>
  JSON.parse(await readFile(new URL(name, directory), 'utf8')) as unknown));
const sample = () => BossSchema.parse(structuredClone(fixtures[0]));
function bulletParams(boss: BossSpec) {
  const attack = boss.phases[0]!.attacks[0]!;
  if (attack.emitter === 'laser') throw new Error('Expected a bullet attack fixture.');
  return attack.params;
}

describe('Boss contract v1', () => {
  it('accepts house bosses with distinct silhouettes, movement, and attacks', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    const bosses = fixtures.map((fixture) => BossSchema.parse(fixture));
    expect(new Set(bosses.map((boss) => boss.look.shape)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(bosses.map((boss) => boss.phases[0]?.movement.kind)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(bosses.map((boss) => boss.phases[0]?.attacks[0]?.emitter)).size).toBeGreaterThanOrEqual(3);
  });

  const invalidCases: [string, (boss: BossSpec) => void][] = [
    ['name longer than 24 characters', (boss) => { boss.meta.name = 'x'.repeat(25); }],
    ['missing interpretation bullet', (boss) => { boss.meta.reading.pop(); }],
    ['four interpretation bullets', (boss) => { boss.meta.reading.push('Extra'); }],
    ['taunt longer than 40 characters', (boss) => { boss.taunts.intro = 'x'.repeat(41); }],
    ['invalid creator login', (boss) => { boss.meta.creator = '@Name With Spaces'; }],
    ['unsafe color syntax', (boss) => { boss.look.palette[0] = 'url(https://example.com)'; }],
    ['empty phases', (boss) => { boss.phases = []; }],
    ['zero HP', (boss) => { boss.hp = 0; }],
    ['nonfinite HP', (boss) => { boss.hp = Infinity; }],
    ['missing initial full-HP phase', (boss) => { boss.phases[0]!.hpBelow = 0.9; }],
    ['duplicate phase threshold', (boss) => { boss.phases[1]!.hpBelow = 1; }],
    ['ascending phase thresholds', (boss) => { boss.phases.push({ ...boss.phases[1]!, hpBelow: 0.8 }); }],
    ['zero volley interval', (boss) => { boss.phases[0]!.attacks[0]!.params.interval = 0; }],
    ['more than 400 bullets in a volley', (boss) => { bulletParams(boss).count = 401; }],
    ['fractional bullet count', (boss) => { bulletParams(boss).count = 1.5; }],
    ['reverse controls longer than 3 seconds', (boss) => { boss.phases[0]!.modifiers = [{ kind: 'reverseControls', durationMs: 3001 }]; }],
  ];
  it.each(invalidCases)('rejects %s', (_, mutate) => {
    const boss = sample();
    mutate(boss);
    expect(BossSchema.safeParse(boss).success).toBe(false);
  });

  it('accepts documented length and duration boundaries', () => {
    const boss = sample();
    boss.meta.name = 'x'.repeat(24);
    boss.taunts.intro = 'x'.repeat(40);
    boss.phases[0]!.modifiers = [{ kind: 'reverseControls', durationMs: 3000 }];
    expect(BossSchema.safeParse(boss).success).toBe(true);
  });

  it('requires dedicated laser parameters and rejects bullet fields on lasers', () => {
    const attack = fixtures.map((fixture) => BossSchema.parse(fixture)).flatMap((boss) => boss.phases.flatMap((phase) => phase.attacks)).find((attack) => attack.emitter === 'laser')!;
    expect(AttackSchema.safeParse(attack).success).toBe(true);
    expect(AttackSchema.safeParse({ ...attack, params: { ...attack.params, count: 1, speed: 0 } }).success).toBe(false);
    const { width: _width, ...missingWidth } = attack.params;
    void _width;
    expect(AttackSchema.safeParse({ ...attack, params: missingWidth }).success).toBe(false);
    expect(AttackSchema.safeParse({ ...attack, params: { ...attack.params, durationMs: 0 } }).success).toBe(false);
  });

  it('requires positive minion HP', () => {
    const boss = sample();
    const minions = { kind: 'orbiter', count: 3, every: 10 };
    for (const hp of [undefined, 0, -1, 1.5]) {
      Object.assign(boss.phases[0]!, { minions: { ...minions, hp } });
      expect(BossSchema.safeParse(boss).success).toBe(false);
    }
    Object.assign(boss.phases[0]!, { minions: { ...minions, hp: 18 } });
    expect(BossSchema.safeParse(boss).success).toBe(true);
  });

  it('rejects unknown fields at every untrusted object boundary', () => {
    for (const getObject of [
      (boss: BossSpec) => boss,
      (boss: BossSpec) => boss.meta,
      (boss: BossSpec) => boss.look,
      (boss: BossSpec) => boss.phases[0]!,
      (boss: BossSpec) => boss.phases[0]!.movement,
      (boss: BossSpec) => boss.phases[0]!.attacks[0]!.params,
    ]) {
      const boss = sample();
      Object.assign(getObject(boss), { unexpected: 'not part of the contract' });
      expect(BossSchema.safeParse(boss).success).toBe(false);
    }
  });

  it('rejects unknown primitives without coercing data', () => {
    const boss = sample();
    Object.assign(boss.phases[0]!.movement, { kind: 'executeCode' });
    expect(BossSchema.safeParse(boss).success).toBe(false);
    expect(BossSchema.safeParse({ ...sample(), hp: '3200' }).success).toBe(false);
  });

  it('keeps the generated schema in sync and consumable by a JSON Schema validator', async () => {
    const exported: unknown = JSON.parse(await readFile(new URL('../engine/boss.schema.json', import.meta.url), 'utf8'));
    expect(exported).toEqual(bossJsonSchema());
    const validate = new Ajv2020({ strict: true }).compile(bossJsonSchema());
    for (const fixture of fixtures) expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    const boss = sample();
    boss.phases[0]!.modifiers = [{ kind: 'reverseControls', durationMs: 3001 }];
    expect(validate(boss)).toBe(false);
    expect(validate({ ...sample(), extra: true })).toBe(false);
  });
});
