import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { BossSchema, type BossSpec } from '../engine/boss-api';
import { GATE_POLICY } from '../engine/fairness-policy';
import { GateReportSchema, gateReportJsonSchema } from '../engine/gate-report';
import * as simulation from '../engine/simulation';
import { runGate, specHash } from '../server/gate/runner';

const load = async (relative: string) => BossSchema.parse(JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8')));
const house = await Promise.all(['ember-anvil', 'neon-brood', 'prism-warden', 'brass-serpent'].map((id) => load(`../bosses/house/${id}.json`)));
const unfair = await load('./fixtures/unfair-boss.json');
const fast = (): BossSpec => {
  const spec = structuredClone(house[0]!); spec.hp = 1; spec.phases = [spec.phases[0]!];
  return spec;
};
afterEach(() => vi.restoreAllMocks());

describe('authoritative fairness gate', () => {
  it.each(house.map((boss) => [boss.meta.name, boss] as const))('checks the complete five-seed suite for %s', (_, boss) => {
    const report = runGate(boss);
    expect(GateReportSchema.safeParse(report).success).toBe(true);
    expect(report.checks.filter((check) => check.id !== 'tickBudget').every((check) => check.passed)).toBe(true);
    // Timing is host-dependent; every violation must still fail the report.
    expect(report.passed).toBe(report.timing.p99TickMs <= GATE_POLICY.tickBudgetMs);
    expect(report.metrics.wins).toBeGreaterThanOrEqual(2);
    expect(report.metrics.wins).toBeLessThanOrEqual(4);
    expect(report.metrics.losses).toBeGreaterThanOrEqual(1);
    expect(report.metrics.minSafeFraction).toBeGreaterThanOrEqual(0.25);
    expect(report.metrics.estimatedTtkSeconds).toBeGreaterThanOrEqual(45);
    expect(report.metrics.estimatedTtkSeconds).toBeLessThanOrEqual(120);
    expect(report.metrics.coveredPhases).toEqual(boss.phases.map((_, index) => index));
    expect(report.damageProbes.every((probe) => probe.outcome === 'won' && probe.hearts === 3)).toBe(true);
    expect(report.runs).toHaveLength(5);
  }, 180000);

  it('repeats gameplay metrics and final replay hashes exactly', () => {
    const a = runGate(house[0]), b = runGate(house[0]);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.runs).toEqual(b.runs);
    expect(a.damageProbes).toEqual(b.damageProbes);
    expect(a.specHash).toBe(b.specHash);
    expect(a.checks.filter((check) => check.id !== 'tickBudget')).toEqual(b.checks.filter((check) => check.id !== 'tickBudget'));
  }, 180000);

  it('rejects a schema-valid deliberately unfair boss with actionable reasons', () => {
    const report = runGate(unfair);
    expect(report.passed).toBe(false);
    for (const id of ['telegraphs', 'aimedSpeed', 'bulletCap', 'beatable']) expect(report.checks.find((check) => check.id === id)?.passed, id).toBe(false);
    expect(report.metrics.maxLiveBullets).toBeLessThanOrEqual(400);
    expect(report.metrics.droppedBullets).toBeGreaterThan(0); // The hard cap cannot conceal attempted overflow.
    expect(report.checks.find((check) => check.id === 'telegraphs')?.details.join(' ')).toContain('phases[0]');
  }, 180000);

  it('rejects invalid specs and forged pass claims before simulation', () => {
    const report = runGate({ ...fast(), gateReport: { passed: true } });
    expect(report.passed).toBe(false); expect(report.runs).toHaveLength(0);
    expect(report.checks[0]?.id).toBe('schema');
    expect(runGate({ hp: NaN }).passed).toBe(false);
  });

  it('checks unsafe later phases even when the boss is killed before reaching them', () => {
    const spec = fast();
    const phase = structuredClone(house[2]!.phases[1]!);
    phase.hpBelow = 0.01;
    const laser = phase.attacks.find((attack) => attack.emitter === 'laser')!;
    laser.params.telegraphMs = 349;
    spec.phases.push(phase);
    const report = runGate(spec);
    expect(report.checks.find((check) => check.id === 'telegraphs')?.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('includes acceleration and phase speed boosts in the targeted speed cap', () => {
    const spec = fast();
    const attack = structuredClone(house[2]!.phases[0]!.attacks[0]!);
    if (attack.emitter === 'laser') throw new Error('Expected targeted bullets.');
    attack.params.speed = 150; attack.params.accel = 10;
    spec.phases[0]!.attacks = [attack];
    spec.phases[0]!.modifiers = [{ kind: 'speedUp', strength: 2, durationMs: 1000 }];
    const report = runGate(spec);
    expect(report.checks.find((check) => check.id === 'aimedSpeed')?.passed).toBe(false);
    expect(report.metrics.maxTargetedBulletSpeed).toBe(400);
  });

  it('rejects trivial fights for both TTK and lack of a real loss', () => {
    const report = runGate(fast());
    expect(report.metrics.wins).toBe(5);
    expect(report.checks.find((check) => check.id === 'ttk')?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'interesting')?.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('rejects density even when the bot can dodge it', () => {
    const spec = structuredClone(house[0]!);
    const attack = spec.phases[1]!.attacks[0]!;
    if (attack.emitter === 'laser') throw new Error('Expected spiral.');
    attack.params.count = 12;
    const report = runGate(spec);
    expect(report.metrics.minSafeFraction).toBeLessThan(0.25);
    expect(report.checks.find((check) => check.id === 'safeSpace')?.passed).toBe(false);
    expect(report.passed).toBe(false);
  }, 180000);

  it('does not count survival timeouts as interesting losses or estimate unobserved kills', () => {
    const spec = fast(); spec.hp = 100000;
    const attack = spec.phases[0]!.attacks[0]!;
    if (attack.emitter === 'laser') throw new Error('Expected bullets.');
    Object.assign(attack.params, { count: 1, speed: 0, accel: 0, interval: 30 });
    const report = runGate(spec);
    expect(report.metrics.timeouts).toBe(5); expect(report.metrics.losses).toBe(0);
    expect(report.metrics.estimatedTtkSeconds).toBeNull();
    expect(report.checks.find((check) => check.id === 'interesting')?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === 'ttk')?.passed).toBe(false);
  }, 180000);

  it('accepts the exact 350ms telegraph boundary in all phases', () => {
    const spec = fast();
    const phase = structuredClone(house[2]!.phases[0]!);
    phase.movement = { kind: 'charge', speed: 100, telegraphMs: 350 };
    for (const attack of phase.attacks) if (attack.emitter === 'laser') attack.params.telegraphMs = 350;
    spec.phases = [phase];
    expect(runGate(spec).checks.find((check) => check.id === 'telegraphs')?.passed).toBe(true);
  });

  it('reports actual simulation exceptions instead of issuing a verification', () => {
    vi.spyOn(simulation, 'stepGame').mockImplementationOnce(() => { throw new Error('Injected simulation failure'); });
    const report = runGate(fast());
    expect(report.metrics.exceptions).toBe(1);
    expect(report.runs[0]?.outcome).toBe('exception');
    expect(report.checks.find((check) => check.id === 'exceptions')?.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('fails the measured tick budget without changing gameplay decisions', () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time += 20);
    const report = runGate(fast());
    expect(report.metrics.wins).toBe(5);
    expect(report.timing.maxTickMs).toBe(20);
    expect(report.timing.overBudgetTicks).toBeGreaterThan(0);
    expect(report.checks.find((check) => check.id === 'tickBudget')?.passed).toBe(false);
  });

  it('tolerates a rare host stall while the p99 tick fits the budget', () => {
    // Fake clock advances inside stepGame; exactly one combat tick stalls for 60 ms.
    let time = 0, combatTicks = 0;
    const realStep = simulation.stepGame;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    vi.spyOn(simulation, 'stepGame').mockImplementation((game, input) => {
      const before = game.tick; realStep(game, input);
      time += game.tick !== before && ++combatTicks === 100 ? 60 : 0.01;
    });
    const report = runGate(fast());
    expect(report.timing.maxTickMs).toBeGreaterThan(GATE_POLICY.tickBudgetMs);
    expect(report.timing.overBudgetTicks).toBe(1);
    expect(report.checks.find((check) => check.id === 'tickBudget')?.passed).toBe(true);
  });

  it('hashes the normalized spec and invalidates old reports when content changes', () => {
    const spec = fast(), hash = specHash(spec);
    expect(hash).toHaveLength(64); expect(specHash(structuredClone(spec))).toBe(hash);
    spec.hp++;
    expect(specHash(spec)).not.toBe(hash);
  });

  it('exports a strict, current GateReport JSON Schema', async () => {
    const schema: unknown = JSON.parse(await readFile(new URL('../engine/gate-report.schema.json', import.meta.url), 'utf8'));
    expect(schema).toEqual(gateReportJsonSchema());
    const validate = new Ajv2020({ strict: true }).compile(gateReportJsonSchema());
    const report = runGate(fast());
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...report, extra: true })).toBe(false);
  });
});
