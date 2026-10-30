/** Versioned policy: changing bot behavior, seeds or limits invalidates old reports. */
export const GATE_POLICY = Object.freeze({
  version: 'm2-v1',
  botVersion: 'potential-field-v1',
  seeds: Object.freeze([17, 101, 509, 1337, 9001]),
  difficulty: 1,
  minWins: 2,
  maxWins: 4,
  minSafeFraction: 0.25,
  windowTicks: 30,
  gridColumns: 24,
  gridRows: 18,
  minTelegraphMs: 350,
  maxTargetedSpeed: 300,
  maxBullets: 400,
  minTtkSeconds: 45,
  maxTtkSeconds: 120,
  tickBudgetMs: 1000 / 60,
});
