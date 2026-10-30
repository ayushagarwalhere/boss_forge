import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GATE_POLICY as POLICY } from '../engine/fairness-policy';
import { createGame, type Bullet } from '../engine/simulation';
import { GRID_CELLS, hazardMask, markSegment, SafeSpaceTracker } from '../server/gate/safe-space';

const fixture: unknown = JSON.parse(await readFile(new URL('../bosses/house/ember-anvil.json', import.meta.url), 'utf8'));

describe('conservative safe-space windows', () => {
  it('unions all hazards across every rolling half-second, rather than averaging empty snapshots', () => {
    const tracker = new SafeSpaceTracker();
    for (let tick = 1; tick <= 30; tick++) {
      const mask = new Uint8Array(GRID_CELLS);
      if (tick === 1) mask.fill(1, 0, GRID_CELLS / 2);
      if (tick === 30) mask.fill(1, GRID_CELLS / 2);
      tracker.add(mask, tick);
    }
    expect(tracker.minFraction).toBe(0);
    expect(tracker.worstEndingTick).toBe(30);
    for (let tick = 31; tick <= 60; tick++) tracker.add(new Uint8Array(GRID_CELLS), tick);
    expect(tracker.minFraction).toBe(0); // Never forget an earlier unsafe window.
  });

  it('removes old masks when a fresh safe rolling window begins', () => {
    const tracker = new SafeSpaceTracker();
    tracker.add(new Uint8Array(GRID_CELLS).fill(1), 1);
    for (let tick = 2; tick <= 29; tick++) tracker.add(new Uint8Array(GRID_CELLS), tick);
    expect(tracker.worstEndingTick).toBe(0);
    tracker.add(new Uint8Array(GRID_CELLS), 30);
    expect(tracker.minFraction).toBe(0);
    expect(() => tracker.add(new Uint8Array(1), 31)).toThrow();
  });

  it('marks every cell crossed by a fast bullet, including its hitbox clearance', () => {
    const mask = new Uint8Array(GRID_CELLS);
    markSegment(mask, { x: 20, y: 100 }, { x: 940, y: 100 }, 9);
    for (let column = 0; column < POLICY.gridColumns; column++) expect(mask[2 * POLICY.gridColumns + column]).toBe(1);
    expect(mask[10 * POLICY.gridColumns + 12]).toBe(0);
    const outside = new Uint8Array(GRID_CELLS);
    markSegment(outside, { x: -100, y: 0 }, { x: -80, y: 0 }, 5);
    expect(outside.some(Boolean)).toBe(false);
  });

  it('counts a whole cell unsafe when a circle touches its corner', () => {
    const mask = new Uint8Array(GRID_CELLS);
    markSegment(mask, { x: 80, y: 80 }, { x: 80, y: 80 }, 5);
    expect(mask[1 * POLICY.gridColumns + 1]).toBe(1);
    expect(mask[2 * POLICY.gridColumns + 2]).toBe(1);
  });

  it('includes active lasers, minion/boss contact, and illegal arena cells', () => {
    const game = createGame(fixture); game.status = 'playing'; game.tick = 50;
    const base = hazardMask(game);
    expect(base[0]).toBe(1);
    game.lasers.push({ id: 1, x: 0, y: 400, angle: 0, sweep: 0, width: 30, length: 960, color: '#FFFFFF', born: 0, fireTick: 40, endTick: 60 });
    const laser = hazardMask(game);
    expect(laser[10 * POLICY.gridColumns + 12]).toBe(1);
    expect(base[10 * POLICY.gridColumns + 12]).toBe(0);
    game.tick = 39; expect(hazardMask(game)[10 * POLICY.gridColumns + 12]).toBe(0);
    game.spec.phases[0]!.modifiers = [{ kind: 'shrinkArena', strength: 0.3, durationMs: 3000 }];
    expect(hazardMask(game).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(base.reduce((sum, value) => sum + value, 0));
  });

  it('does not sweep a teleported boss across the arena', () => {
    const game = createGame(fixture); game.tick = 200; game.boss.x = 820; game.boss.y = 300;
    game.events = [{ kind: 'teleport', x: 820, y: 300, text: '' }];
    const mask = hazardMask(game, [], [], { x: 100, y: 300 });
    expect(mask[7 * POLICY.gridColumns + 12]).toBe(0);
    game.events = [];
    expect(hazardMask(game, [], [], { x: 100, y: 300 })[7 * POLICY.gridColumns + 12]).toBe(1);
  });

  it('treats an unarmed mine as a warning until it arms', () => {
    const game = createGame(fixture); game.tick = 100;
    const mine: Bullet = { id: 1, x: 500, y: 500, previousX: 500, previousY: 500, angle: 0, speed: 0, accel: 0, radius: 5, color: '#FFFFFF', shape: 'circle', bounce: 0, expires: 600, homing: false, armedAt: 101, targeted: false };
    game.bullets = [mine]; expect(hazardMask(game)[12 * POLICY.gridColumns + 12]).toBe(0);
    game.tick = 101; expect(hazardMask(game)[12 * POLICY.gridColumns + 12]).toBe(1);
  });
});
