import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BossSchema, type BossSpec } from '../../engine/boss-api';
import { TICK_RATE } from '../../engine/constants';
import { createDodger, dodge } from '../../engine/dodger';
import { GATE_POLICY as POLICY } from '../../engine/fairness-policy';
import { GateReportSchema, type FightReport, type GateCheck, type GateReport } from '../../engine/gate-report';
import { createGame, stateHash, stepGame, type GameState } from '../../engine/simulation';
import { hazardMask, SafeSpaceTracker } from './safe-space';

export function specHash(spec: BossSpec): string {
  return createHash('sha256').update(JSON.stringify(BossSchema.parse(spec))).digest('hex');
}
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;

function emptyReport(): GateReport {
  const { version: policyVersion, botVersion, ...policy } = POLICY;
  return {
    version: 1, policyVersion, botVersion, bossName: 'Invalid boss', specHash: null, passed: false, summary: 'Rejected: invalid boss.',
    scope: 'declarative specs at difficulty 1; generated scripts are not certified', checks: [], policy: { ...policy, seeds: [...policy.seeds] },
    metrics: { wins: 0, losses: 0, timeouts: 0, minSafeFraction: null, estimatedTtkSeconds: null,
      maxLiveBullets: 0, droppedBullets: 0, maxTargetedBulletSpeed: 0, exceptions: 0, coveredPhases: [], worstWindow: null },
    timing: { sampleCount: 0, maxTickMs: 0, p99TickMs: 0, overBudgetTicks: 0, budgetMs: POLICY.tickBudgetMs, scope: 'stepGame only; wall-clock measurements vary by host' },
    runs: [], damageProbes: [],
  };
}

function check(report: GateReport, id: GateCheck['id'], passed: boolean, requirement: string, observed: number | null, details: string[] = []) {
  report.checks.push({ id, passed, requirement, observed, details });
}

export function rejectedReport(reason: string, id: 'schema' | 'scriptSupport' = 'schema'): GateReport {
  const report = emptyReport();
  check(report, id, false, id === 'schema' ? 'Valid BossSpec v1' : 'Only declarative specs in M2', null, [reason]);
  report.summary = `Rejected: ${reason}`;
  return GateReportSchema.parse(report);
}

function staticChecks(spec: BossSpec, report: GateReport) {
  const warnings: string[] = [], speeds: string[] = [];
  let maxTargeted = spec.phases.some((phase) => phase.minions && phase.minions.kind !== 'kamikaze') ? 135 : 0;
  spec.phases.forEach((phase, index) => {
    if (phase.movement.kind === 'charge' && phase.movement.telegraphMs < POLICY.minTelegraphMs) warnings.push(`phases[${index}].movement: charge warning ${phase.movement.telegraphMs}ms < ${POLICY.minTelegraphMs}ms.`);
    const speedScale = Math.max(1, ...(phase.modifiers ?? []).map((modifier) => modifier.kind === 'speedUp' ? modifier.strength : 1));
    phase.attacks.forEach((attack, attackIndex) => {
      const path = `phases[${index}].attacks[${attackIndex}]`;
      if (attack.emitter === 'laser' && attack.params.telegraphMs < POLICY.minTelegraphMs) warnings.push(`${path}: laser warning ${attack.params.telegraphMs}ms < ${POLICY.minTelegraphMs}ms.`);
      if (attack.emitter === 'aimed' || attack.emitter === 'fan' || attack.emitter === 'homing') {
        const maximum = Math.min(1200, Math.max(attack.params.speed * speedScale, attack.params.speed * speedScale + attack.params.accel * 10));
        maxTargeted = Math.max(maxTargeted, maximum);
        if (maximum > POLICY.maxTargetedSpeed) speeds.push(`${path}: targeted speed can reach ${maximum}px/s > ${POLICY.maxTargetedSpeed}px/s (includes acceleration and speedUp).`);
      }
    });
  });
  check(report, 'telegraphs', warnings.length === 0, `All laser/charge warnings >= ${POLICY.minTelegraphMs}ms, including unreached phases`, null, warnings);
  check(report, 'aimedSpeed', speeds.length === 0, `Targeted bullets <= ${POLICY.maxTargetedSpeed}px/s at difficulty 1`, maxTargeted, speeds);
  report.metrics.maxTargetedBulletSpeed = maxTargeted;
}

function assertFiniteState(game: GameState) {
  const numbers = [game.player.x, game.player.y, game.boss.x, game.boss.y, game.boss.hp, game.tick];
  for (const bullet of game.bullets) numbers.push(bullet.x, bullet.y, bullet.speed, bullet.angle);
  for (const shot of game.shots) numbers.push(shot.x, shot.y, shot.vx, shot.vy);
  for (const minion of game.minions) numbers.push(minion.x, minion.y, minion.hp);
  for (const laser of game.lasers) numbers.push(laser.x, laser.y, laser.angle);
  if (!numbers.every(Number.isFinite)) throw new Error('Simulation produced non-finite state.');
}

function runFight(spec: BossSpec, seed: number, probe: boolean, report: GateReport, samples: number[]): FightReport {
  const game = createGame(spec, seed, POLICY.difficulty), bot = createDodger(seed), tracker = new SafeSpaceTracker();
  if (probe) game.player.invulnerableUntil = Number.MAX_SAFE_INTEGER;
  let steps = 0, maxLiveBullets = 0, maxTargeted = 0, error: string | null = null;
  const phases = new Set<number>();
  try {
    // Bounded input steps include the intro and at most two hit-stop pauses.
    while (game.status !== 'won' && game.status !== 'lost' && game.tick < POLICY.maxTtkSeconds * TICK_RATE && steps < (POLICY.maxTtkSeconds + 3) * TICK_RATE) {
      const beforeTick = game.tick, bullets = game.bullets, lasers = game.lasers, previousBoss = { x: game.boss.x, y: game.boss.y };
      const input = dodge(game, bot);
      const start = performance.now(); stepGame(game, input); const elapsed = performance.now() - start;
      if (beforeTick !== game.tick) samples.push(elapsed);
      steps++;
      assertFiniteState(game);
      if (game.tick === beforeTick) continue;
      phases.add(game.boss.phase);
      // Pre-step arrays retain swept traces even for bullets removed after collision/exit.
      tracker.add(hazardMask(game, bullets, lasers, previousBoss), game.tick);
      maxLiveBullets = Math.max(maxLiveBullets, game.bullets.length, bullets.length);
      for (const bullet of bullets) if (bullet.targeted) maxTargeted = Math.max(maxTargeted, bullet.speed);
    }
  } catch (exception) { error = exception instanceof Error ? exception.message : String(exception); }
  if (tracker.worstEndingTick && (report.metrics.minSafeFraction === null || tracker.minFraction < report.metrics.minSafeFraction)) {
    report.metrics.minSafeFraction = tracker.minFraction;
    report.metrics.worstWindow = { seed, probe, endingTick: tracker.worstEndingTick, safeCells: tracker.minSafeCells };
  }
  return {
    seed, outcome: error ? 'exception' : game.status === 'won' ? 'won' : game.status === 'lost' ? 'lost' : 'timeout',
    combatSeconds: rounded(game.tick / TICK_RATE), inputSteps: steps, hearts: game.player.hearts, bossHpRemaining: game.boss.hp,
    minSafeFraction: tracker.minFraction, maxLiveBullets, droppedBullets: game.droppedBullets, maxTargetedBulletSpeed: maxTargeted,
    phasesSeen: [...phases].sort(), finalStateHash: stateHash(game), error,
  };
}

/** Authoritative local gate; callers cannot override seeds, limits, bot skill or clock. */
export function runGate(input: unknown): GateReport {
  const parsed = BossSchema.safeParse(input);
  if (!parsed.success) return rejectedReport(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const spec = parsed.data, report = emptyReport(), samples: number[] = [];
  report.bossName = spec.meta.name; report.specHash = specHash(spec);
  check(report, 'schema', true, 'Valid BossSpec v1', null);
  staticChecks(spec, report);
  // Complete the same seeded suite even if static checks fail, so reports aid repair.
  report.runs = POLICY.seeds.map((seed) => runFight(spec, seed, false, report, samples));
  report.damageProbes = POLICY.seeds.map((seed) => runFight(spec, seed, true, report, samples));
  const all = [...report.runs, ...report.damageProbes], metrics = report.metrics;
  metrics.wins = report.runs.filter((run) => run.outcome === 'won').length;
  metrics.losses = report.runs.filter((run) => run.outcome === 'lost').length;
  metrics.timeouts = report.runs.filter((run) => run.outcome === 'timeout').length;
  metrics.exceptions = all.filter((run) => run.error !== null).length;
  metrics.maxLiveBullets = Math.max(...all.map((run) => run.maxLiveBullets));
  metrics.droppedBullets = all.reduce((sum, run) => sum + run.droppedBullets, 0);
  metrics.maxTargetedBulletSpeed = Math.max(metrics.maxTargetedBulletSpeed, ...all.map((run) => run.maxTargetedBulletSpeed));
  metrics.coveredPhases = [...new Set(report.damageProbes.flatMap((run) => run.phasesSeen))].sort();
  const probeKills = report.damageProbes.filter((run) => run.outcome === 'won').map((run) => run.combatSeconds).sort((a, b) => a - b);
  metrics.estimatedTtkSeconds = probeKills.length === POLICY.seeds.length ? probeKills[Math.floor(probeKills.length / 2)]! : null;
  check(report, 'bulletCap', metrics.maxLiveBullets <= POLICY.maxBullets && metrics.droppedBullets === 0,
    `<= ${POLICY.maxBullets} live bullets; no attempted overflow hidden by the engine cap`, metrics.maxLiveBullets,
    metrics.droppedBullets ? [`${metrics.droppedBullets} requested bullets were dropped by the cap.`] : []);
  check(report, 'safeSpace', metrics.minSafeFraction !== null && metrics.minSafeFraction >= POLICY.minSafeFraction,
    `>= ${POLICY.minSafeFraction * 100}% wholly safe cells in every rolling ${POLICY.windowTicks}-tick window across all fights/probes`, metrics.minSafeFraction);
  check(report, 'ttk', metrics.estimatedTtkSeconds !== null && metrics.estimatedTtkSeconds >= POLICY.minTtkSeconds && metrics.estimatedTtkSeconds <= POLICY.maxTtkSeconds && metrics.coveredPhases.length === spec.phases.length,
    `Median damage-probe TTK ${POLICY.minTtkSeconds}–${POLICY.maxTtkSeconds}s; all five probes must kill and all phases must be covered`, metrics.estimatedTtkSeconds,
    probeKills.length !== 5 ? [`Only ${probeKills.length}/5 invulnerable damage probes killed within ${POLICY.maxTtkSeconds}s.`] : []);
  check(report, 'beatable', metrics.wins >= POLICY.minWins, `Reference dodger wins >= ${POLICY.minWins}/5 with three hearts`, metrics.wins);
  check(report, 'interesting', metrics.losses >= 1, 'Reference dodger actually loses >= 1/5 (timeouts do not count)', metrics.losses);
  check(report, 'exceptions', metrics.exceptions === 0 && all.length === 10, 'Zero exceptions and ten completed evaluations', metrics.exceptions, all.flatMap((run) => run.error ? [`Seed ${run.seed}: ${run.error}`] : []));
  samples.sort((a, b) => a - b);
  report.timing.sampleCount = samples.length;
  report.timing.maxTickMs = samples.at(-1) ?? 0;
  report.timing.p99TickMs = samples[Math.floor(samples.length * 0.99)] ?? 0;
  report.timing.overBudgetTicks = samples.filter((value) => value > POLICY.tickBudgetMs).length;
  check(report, 'tickBudget', samples.length > 0 && report.timing.overBudgetTicks === 0, `Every measured stepGame tick <= ${rounded(POLICY.tickBudgetMs)}ms`, report.timing.maxTickMs);
  // The static bound includes acceleration and modifiers; runtime measurement is an extra check.
  const speedCheck = report.checks.find((item) => item.id === 'aimedSpeed')!;
  speedCheck.passed &&= metrics.maxTargetedBulletSpeed <= POLICY.maxTargetedSpeed;
  speedCheck.observed = metrics.maxTargetedBulletSpeed;
  report.passed = report.checks.every((item) => item.passed);
  const safe = metrics.minSafeFraction === null ? 'n/a' : `${Math.floor(metrics.minSafeFraction * 100)}%`;
  const ttk = metrics.estimatedTtkSeconds === null ? 'n/a' : `${Math.round(metrics.estimatedTtkSeconds)}s`;
  report.summary = `${report.passed ? 'Verified ✅' : 'Rejected ❌'} beatable ${metrics.wins}/5 · ${safe} safe space · TTK ~${ttk} · ${metrics.exceptions} errors`;
  return GateReportSchema.parse(report);
}
