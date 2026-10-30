import { ARENA } from './constants';
import { random } from './random';
import { arenaMargin, clamp, laserEnd, type GameState, type Input, type Point } from './simulation';

export interface DodgerState {
  rng: number; anchorX: number; anchorY: number; sway: number; side: number;
  nextDecision: number; x: number; y: number;
}

export function createDodger(seed: number): DodgerState {
  const state = { rng: (seed ^ 0xa511e9b3) >>> 0 };
  return { ...state, anchorX: 180 + random(state) * 600, anchorY: 510 + random(state) * 110,
    sway: random(state) * Math.PI * 2, side: random(state) < 0.5 ? -1 : 1,
    nextDecision: 0, x: 0, y: 0, rng: state.rng };
}

function closest(point: Point, from: Point, to: Point): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/** A bounded, imperfect reference player: 100 ms reactions and potential fields.
 * It sees only current bullets and visible warnings, never future RNG or HP cheats.
 * Aim/autofire uses exactly the same input path as the streamer.
 */
export function dodge(game: GameState, bot: DodgerState): Input {
  if (game.tick < bot.nextDecision) return { x: bot.x, y: bot.y, fire: true };
  bot.nextDecision = game.tick + 6;
  const player = game.player;
  let fx = (bot.anchorX + Math.sin(game.tick / 120 + bot.sway) * 95 - player.x) / 550;
  let fy = (bot.anchorY - player.y) / 450;
  function repel(point: Point, influence: number, weight: number) {
    let dx = player.x - point.x, dy = player.y - point.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= influence) return;
    if (distance < 0.01) { dx = bot.side; dy = 0.3; }
    const force = weight * (1 - distance / influence) ** 2;
    fx += dx / (distance || 1) * force; fy += dy / (distance || 1) * force;
  }
  for (const bullet of game.bullets) {
    if (bullet.armedAt > game.tick + 30) continue;
    const vx = Math.cos(bullet.angle) * bullet.speed, vy = Math.sin(bullet.angle) * bullet.speed;
    const rx = bullet.x - player.x, ry = bullet.y - player.y;
    const time = clamp(-(rx * vx + ry * vy) / (vx * vx + vy * vy || 1), 0, 0.5);
    repel({ x: bullet.x + vx * time, y: bullet.y + vy * time }, 65 + bullet.radius, 2.8 * (1 - time * 0.5));
  }
  for (const laser of game.lasers) {
    if (laser.fireTick - game.tick > 36) continue;
    const end = laserEnd(laser, Math.max(game.tick, laser.fireTick));
    const near = closest(player, laser, end);
    // An exact on-beam start needs a stable perpendicular tie-break, not a NaN.
    if (Math.hypot(player.x - near.x, player.y - near.y) < 1) {
      near.x -= Math.sin(laser.angle) * bot.side; near.y += Math.cos(laser.angle) * bot.side;
    }
    repel(near, laser.width / 2 + 80, 3.2);
  }
  const motion = game.boss.motion;
  if (motion && motion.fireTick - game.tick < 36) {
    repel(motion.kind === 'charge' ? closest(player, motion.from, motion.to) : motion.to, game.spec.look.size + 75, 3);
  }
  repel(game.boss, game.spec.look.size + 95, 2.5);
  for (const minion of game.minions) repel(minion, 65, 2);
  const margin = arenaMargin(game) + 28;
  if (player.x < margin + 60) fx += (margin + 60 - player.x) / 50;
  if (player.x > ARENA.width - margin - 60) fx -= (player.x - ARENA.width + margin + 60) / 50;
  if (player.y < margin + 60) fy += (margin + 60 - player.y) / 50;
  if (player.y > ARENA.height - margin - 60) fy -= (player.y - ARENA.height + margin + 60) / 50;
  const length = Math.hypot(fx, fy);
  const scale = Math.max(1, length);
  bot.x = clamp(fx / scale, -1, 1); bot.y = clamp(fy / scale, -1, 1);
  return { x: bot.x, y: bot.y, fire: true };
}
