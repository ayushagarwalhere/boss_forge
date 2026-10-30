import { ARENA, PLAYER } from '../../engine/constants';
import { GATE_POLICY as POLICY } from '../../engine/fairness-policy';
import { arenaMargin, clamp, laserAngle, type Bullet, type GameState, type Laser, type Point } from '../../engine/simulation';

const COLUMNS = POLICY.gridColumns, ROWS = POLICY.gridRows;
const CELL_WIDTH = ARENA.width / COLUMNS, CELL_HEIGHT = ARENA.height / ROWS;
export const GRID_CELLS = COLUMNS * ROWS;

function intersectsBox(from: Point, to: Point, left: number, top: number, right: number, bottom: number) {
  let enter = 0, exit = 1;
  for (const [origin, delta, low, high] of [[from.x, to.x - from.x, left, right], [from.y, to.y - from.y, top, bottom]]) {
    if (delta === 0) { if (origin! < low! || origin! > high!) return false; continue; }
    const a = (low! - origin!) / delta!, b = (high! - origin!) / delta!;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}

/** Conservative swept capsule versus whole grid cells, including the player's radius. */
export function markSegment(mask: Uint8Array, from: Point, to: Point, radius: number) {
  const left = Math.min(from.x, to.x) - radius, right = Math.max(from.x, to.x) + radius;
  const top = Math.min(from.y, to.y) - radius, bottom = Math.max(from.y, to.y) + radius;
  if (right < 0 || left > ARENA.width || bottom < 0 || top > ARENA.height) return;
  const x0 = clamp(Math.floor(left / CELL_WIDTH), 0, COLUMNS - 1), x1 = clamp(Math.floor(right / CELL_WIDTH), 0, COLUMNS - 1);
  const y0 = clamp(Math.floor(top / CELL_HEIGHT), 0, ROWS - 1), y1 = clamp(Math.floor(bottom / CELL_HEIGHT), 0, ROWS - 1);
  for (let row = y0; row <= y1; row++) for (let column = x0; column <= x1; column++) {
    if (intersectsBox(from, to, column * CELL_WIDTH - radius, row * CELL_HEIGHT - radius,
      (column + 1) * CELL_WIDTH + radius, (row + 1) * CELL_HEIGHT + radius)) mask[row * COLUMNS + column] = 1;
  }
}

function markLaser(mask: Uint8Array, laser: Laser, tick: number) {
  if (tick < laser.fireTick || tick >= laser.endTick) return;
  const a = laserAngle(laser, Math.max(laser.fireTick, tick - 1)), b = laserAngle(laser, tick);
  const divisions = Math.max(1, Math.ceil(Math.abs(b - a) * laser.length / 20));
  const padding = Math.abs(b - a) * laser.length / divisions / 2;
  for (let index = 0; index <= divisions; index++) {
    const angle = a + (b - a) * index / divisions;
    markSegment(mask, laser, { x: laser.x + Math.cos(angle) * laser.length, y: laser.y + Math.sin(angle) * laser.length }, laser.width / 2 + PLAYER.radius + padding);
  }
}

export function hazardMask(game: GameState, bullets: readonly Bullet[] = game.bullets, lasers: readonly Laser[] = game.lasers, previousBoss: Point = game.boss): Uint8Array {
  const mask = new Uint8Array(GRID_CELLS);
  const margin = arenaMargin(game) + 12;
  for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
    if (column * CELL_WIDTH < margin || (column + 1) * CELL_WIDTH > ARENA.width - margin || row * CELL_HEIGHT < margin || (row + 1) * CELL_HEIGHT > ARENA.height - margin) mask[row * COLUMNS + column] = 1;
  }
  for (const bullet of bullets) if (game.tick >= bullet.armedAt) {
    markSegment(mask, { x: bullet.previousX, y: bullet.previousY }, bullet, bullet.radius + PLAYER.radius);
  }
  for (const laser of lasers) markLaser(mask, laser, game.tick);
  const from = game.events.some((event) => event.kind === 'teleport') ? game.boss : previousBoss;
  markSegment(mask, from, game.boss, game.spec.look.size * 0.75 + PLAYER.radius);
  for (const minion of game.minions) markSegment(mask, minion, minion, 14 + PLAYER.radius);
  return mask;
}

/** A cell is safe only if untouched for the ENTIRE rolling 30-tick window. */
export class SafeSpaceTracker {
  private readonly history: Uint8Array[] = Array.from({ length: POLICY.windowTicks }, () => new Uint8Array(GRID_CELLS));
  private readonly counts = new Uint16Array(GRID_CELLS);
  private unsafe = 0;
  private samples = 0;
  minFraction = 1;
  worstEndingTick = 0;
  minSafeCells = GRID_CELLS;

  add(mask: Uint8Array, tick: number) {
    if (mask.length !== GRID_CELLS) throw new Error('Wrong safe-space grid size.');
    const slot = this.samples % POLICY.windowTicks, old = this.history[slot]!;
    for (let index = 0; index < GRID_CELLS; index++) {
      const before = this.counts[index]!;
      const after = before - old[index]! + mask[index]!;
      this.counts[index] = after;
      if (before === 0 && after > 0) this.unsafe++;
      if (before > 0 && after === 0) this.unsafe--;
    }
    this.history[slot] = mask; this.samples++;
    if (this.samples >= POLICY.windowTicks) {
      const safe = GRID_CELLS - this.unsafe;
      if (this.worstEndingTick === 0 || safe < this.minSafeCells) {
        this.minSafeCells = safe; this.minFraction = safe / GRID_CELLS; this.worstEndingTick = tick;
      }
    }
  }
}
