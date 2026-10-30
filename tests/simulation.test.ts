import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BossSchema, type Attack, type BossSpec } from '../engine/boss-api';
import { ARENA, MAX_LIVE_BULLETS, PLAYER } from '../engine/constants';
import { random } from '../engine/random';
import { createGame, laserEnd, segmentDistanceSquared, stateHash, stepGame, type Bullet, type GameState } from '../engine/simulation';

const bosses: BossSpec[] = await Promise.all(['ember-anvil', 'neon-brood', 'prism-warden'].map(async (id) => BossSchema.parse(JSON.parse(await readFile(new URL(`../bosses/house/${id}.json`, import.meta.url), 'utf8')))));
const idle = { x: 0, y: 0, fire: false };
function ready(index = 0, seed = 123) {
  const game = createGame(bosses[index], seed); game.status = 'playing'; return game;
}
function bullet(game: GameState, values: Partial<Bullet> = {}): Bullet {
  return { id: game.id++, x: game.player.x, y: game.player.y, previousX: game.player.x, previousY: game.player.y,
    angle: 0, speed: 0, accel: 0, radius: 5, color: '#FF0000', shape: 'circle', bounce: 0, expires: 10000, homing: false, armedAt: 0, ...values };
}
function quiet(game: GameState) { game.nextAttacks = game.nextAttacks.map(() => 100000); game.nextMinions = 100000; }

describe('deterministic 60 Hz simulation', () => {
  it.each([0, 1, 2])('replays house boss %s with equal checkpoint hashes', (index) => {
    const a = ready(index), b = ready(index);
    a.player.invulnerableUntil = b.player.invulnerableUntil = 100000;
    for (let tick = 0; tick < 5400; tick++) {
      const input = { x: Math.sin(tick / 90), y: Math.cos(tick / 130), focus: tick % 180 < 30, fire: tick % 400 > 30 };
      stepGame(a, input); stepGame(b, input);
      if (tick % 600 === 0) expect(stateHash(a)).toBe(stateHash(b));
      expect(a.bullets.length).toBeLessThanOrEqual(MAX_LIVE_BULLETS);
    }
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('restores the complete future of a fight from JSON', () => {
    const a = ready(2); a.player.invulnerableUntil = 100000;
    for (let tick = 0; tick < 450; tick++) stepGame(a, idle);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    for (let tick = 0; tick < 700; tick++) { stepGame(a, { x: 0.3, y: 0, fire: true }); stepGame(b, { x: 0.3, y: 0, fire: true }); }
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('changes actual teleport destinations with the seed', () => {
    const a = ready(2, 1), b = ready(2, 2);
    for (let tick = 0; tick < 200; tick++) { stepGame(a, idle); stepGame(b, idle); }
    expect(a.boss.x).not.toBe(b.boss.x);
  });

  it('emits one teleport event per maneuver after the warning', () => {
    const game = ready(2); let teleports = 0;
    for (let tick = 0; tick < 200; tick++) {
      stepGame(game, idle);
      teleports += game.events.filter((event) => event.kind === 'teleport').length;
      if (game.tick < 150) expect(teleports).toBe(0);
    }
    expect(teleports).toBe(1);
  });

  it('supports zero seeds and explicit repeatable RNG state', () => {
    const a = { rng: 0 }, b = { rng: 0 };
    const values = Array.from({ length: 100 }, () => random(a));
    expect(values).toEqual(Array.from({ length: 100 }, () => random(b)));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBe(100);
  });

  it('holds the world during the intro and hit-stop', () => {
    const game = createGame(bosses[0]);
    for (let i = 0; i < 120; i++) stepGame(game, { x: 1, y: 1 });
    expect(game.tick).toBe(0); expect(game.status).toBe('playing'); expect(game.bullets).toHaveLength(0);
    game.hitStop = 5; const position = game.player.x;
    for (let i = 0; i < 5; i++) stepGame(game, { x: 1, y: 0 });
    expect(game.tick).toBe(0); expect(game.player.x).toBe(position);
    stepGame(game, idle); expect(game.tick).toBe(1);
  });

  it('normalizes diagonals and slows focus movement', () => {
    const straight = ready(), diagonal = ready(), focus = ready();
    stepGame(straight, { x: 1, y: 0, fire: false });
    stepGame(diagonal, { x: 1, y: 1, fire: false });
    stepGame(focus, { x: 1, y: 0, focus: true, fire: false });
    expect(straight.player.x - ARENA.width / 2).toBeCloseTo(PLAYER.speed / 60);
    expect(Math.hypot(diagonal.player.x - ARENA.width / 2, diagonal.player.y - (ARENA.height - 90))).toBeCloseTo(PLAYER.speed / 60);
    expect(focus.player.x - ARENA.width / 2).toBeCloseTo(PLAYER.focusSpeed / 60);
  });

  it('clamps input and arena bounds without accepting NaN', () => {
    const game = ready(); quiet(game); game.player.invulnerableUntil = 100000;
    for (let i = 0; i < 300; i++) stepGame(game, { x: 100, y: -100, fire: false });
    expect(game.player.x).toBe(ARENA.width - 12); expect(game.player.y).toBe(12);
    stepGame(game, { x: NaN, y: Infinity });
    expect(Number.isFinite(game.player.x) && Number.isFinite(game.player.y)).toBe(true);
    expect(() => createGame(bosses[0], 1, 0)).toThrow();
    expect(() => createGame(bosses[0], NaN)).toThrow();
  });

  it('transitions exactly at HP thresholds and cancels old warnings', () => {
    const game = ready(); game.boss.hp = game.spec.hp * 0.5;
    game.pending.push({ id: 100, x: 100, y: 100, attack: game.spec.phases[0]!.attacks[0]!, angle: 0, fireTick: 999, born: 0 });
    stepGame(game, idle);
    expect(game.boss.phase).toBe(1); expect(game.pending).toHaveLength(0); expect(game.events.some((event) => event.kind === 'phase')).toBe(true);
  });

  it('sweeps fast bullets and grants i-frames after one hit', () => {
    const game = ready(); quiet(game);
    game.bullets.push(bullet(game, { x: game.player.x - 10, speed: 1200 }));
    stepGame(game, idle); expect(game.player.hearts).toBe(2);
    game.bullets.push(bullet(game));
    for (let i = 0; i < 30; i++) stepGame(game, idle);
    expect(game.player.hearts).toBe(2);
    expect(game.player.invulnerableUntil).toBeGreaterThan(game.tick);
  });

  it('starts a laser only after the locked warning, for its finite width and length', () => {
    const game = ready(); quiet(game);
    game.lasers.push({ id: 1, x: game.player.x, y: game.player.y - 100, angle: Math.PI / 2, sweep: 0, width: 16, length: 150, color: '#FFFFFF', born: 0, fireTick: 3, endTick: 8 });
    stepGame(game, idle); stepGame(game, idle); expect(game.player.hearts).toBe(3);
    stepGame(game, idle); expect(game.player.hearts).toBe(2);
    game.hitStop = 0; game.player.invulnerableUntil = 0; game.player.x += 30;
    stepGame(game, idle); expect(game.player.hearts).toBe(2);
    const end = laserEnd(game.lasers[0]!, 4); expect(end.y).toBeCloseTo(game.player.y + 50);
  });

  it('locks laser aim at warning time while the player moves', () => {
    const game = ready(2); game.nextAttacks = [100000, 1];
    stepGame(game, idle); const angle = game.lasers[0]!.angle;
    for (let i = 0; i < 20; i++) stepGame(game, { x: 1, y: 0, fire: false });
    expect(game.lasers[0]!.angle).toBe(angle);
  });

  it('caps even overlapping high-count attacks at 400 bullets', () => {
    const game = ready(); game.player.invulnerableUntil = 100000;
    const attack = structuredClone(game.spec.phases[0]!.attacks[0]!);
    if (attack.emitter === 'laser') throw new Error('Expected bullets');
    attack.params.count = 400; attack.params.telegraphMs = 0; attack.params.interval = 0.05; attack.params.speed = 0;
    game.spec.phases[0]!.attacks = [attack, attack]; game.nextAttacks = [0, 0];
    for (let i = 0; i < 100; i++) { stepGame(game, idle); expect(game.bullets.length).toBeLessThanOrEqual(400); }
    expect(game.bullets).toHaveLength(400);
  });

  it('uses minion HP, auto-targets minions, and bounds repeated summons', () => {
    const game = ready(1); game.player.invulnerableUntil = 100000; game.nextMinions = 1;
    stepGame(game, idle); expect(game.minions).toHaveLength(3);
    expect(game.minions.every((minion) => minion.hp === 18)).toBe(true);
    const originalIds = game.minions.map((minion) => minion.id);
    for (let i = 0; i < 500; i++) stepGame(game, { x: 0, y: 0 });
    expect(game.minions.filter((minion) => originalIds.includes(minion.id)).length).toBeLessThan(3);
    for (let i = 0; i < 1000; i++) stepGame(game, idle);
    expect(game.minions.length).toBeLessThanOrEqual(12);
  });

  it.each(['spiral', 'ring', 'aimed', 'fan', 'wave', 'rain', 'homing', 'mine', 'wallWithGap'] as const)('implements %s without nonfinite state', (emitter) => {
    const game = ready(); game.player.invulnerableUntil = 100000;
    const attack = game.spec.phases[0]!.attacks[0]!;
    if (attack.emitter === 'laser') throw new Error('Expected bullets');
    const custom: Attack = { ...attack, emitter, params: { ...attack.params, telegraphMs: 0, bounce: 2, accel: 20 } };
    game.spec.phases[0]!.attacks = [custom]; game.nextAttacks = [1];
    for (let i = 0; i < 300; i++) stepGame(game, idle);
    expect(game.bullets.length).toBeGreaterThan(0);
    expect(game.bullets.every((bullet) => Number.isFinite(bullet.x + bullet.y + bullet.speed))).toBe(true);
  });

  it.each(['hover', 'figure8', 'orbitCenter', 'teleport', 'charge', 'followPlayer', 'mirrorPlayer'] as const)('implements %s movement in bounds', (kind) => {
    const game = ready(); quiet(game); game.player.invulnerableUntil = 100000;
    game.spec.phases[0]!.movement = { kind, speed: 500, telegraphMs: 400 };
    for (let i = 0; i < 500; i++) stepGame(game, idle);
    expect(game.boss.x).toBeGreaterThanOrEqual(game.spec.look.size);
    expect(game.boss.x).toBeLessThanOrEqual(ARENA.width - game.spec.look.size);
    expect(game.boss.y).toBeGreaterThanOrEqual(game.spec.look.size);
    expect(game.boss.y).toBeLessThanOrEqual(ARENA.height - game.spec.look.size);
  });

  it('ends a fight on death or victory and stops advancing', () => {
    const lost = ready(); quiet(lost); lost.player.hearts = 1; lost.bullets.push(bullet(lost));
    stepGame(lost, idle); expect(lost.status).toBe('lost'); const hash = stateHash(lost);
    stepGame(lost, idle); const after = stateHash(lost); stepGame(lost, idle); expect(stateHash(lost)).toBe(after);
    expect(hash).not.toBe(after); // Transient events are consumed on the next step.
    const won = ready(); won.boss.hp = 0; stepGame(won, idle); expect(won.status).toBe('won');
  });

  it('applies temporary reverse controls, arena shrinking, and a shield', () => {
    const game = ready(); quiet(game);
    game.spec.phases[0]!.modifiers = [{ kind: 'reverseControls', durationMs: 50 }, { kind: 'shrinkArena', durationMs: 1000, strength: 0.2 }];
    const x = game.player.x; stepGame(game, { x: 1, y: 0, fire: false }); expect(game.player.x).toBeLessThan(x);
    expect(game.player.y).toBeLessThanOrEqual(ARENA.height - ARENA.height * 0.2 - 12);
    stepGame(game, idle); const after = game.player.x;
    stepGame(game, { x: 1, y: 0, fire: false }); expect(game.player.x).toBeGreaterThan(after);
    game.spec.phases[0]!.modifiers = [{ kind: 'shield', durationMs: 1000, strength: 1 }];
    game.shots.push({ x: game.boss.x, y: game.boss.y, previousX: game.boss.x, previousY: game.boss.y, vx: 0, vy: 0 });
    stepGame(game, idle); expect(game.boss.hp).toBe(game.spec.hp);
  });

  it('handles degenerate and finite collision segments', () => {
    expect(segmentDistanceSquared({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(25);
    expect(segmentDistanceSquared({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(100);
  });
});
