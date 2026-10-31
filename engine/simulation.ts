import { BossSchema, type Attack, type BossSpec, type Movement } from './boss-api';
import { ARENA, MAX_LIVE_BULLETS, MAX_LIVE_MINIONS, MIN_TELEGRAPH_MS, PLAYER, STEP_SECONDS as DT, TICK_RATE } from './constants';
import { random } from './random';

export interface Point { x: number; y: number }
export interface Input { x: number; y: number; focus?: boolean; fire?: boolean }
export interface Bullet extends Point {
  id: number; previousX: number; previousY: number; angle: number; speed: number; accel: number;
  radius: number; color: string; shape: string; bounce: number; expires: number; homing: boolean; armedAt: number; targeted: boolean;
}
export interface Shot extends Point { previousX: number; previousY: number; vx: number; vy: number }
export interface Minion extends Point {
  id: number; kind: 'orbiter' | 'kamikaze' | 'turret' | 'splitter'; hp: number; maxHp: number;
  angle: number; nextShot: number; born: number; generation: number; previousX: number; previousY: number;
}
export interface Pending extends Point { id: number; attack: Attack; angle: number; fireTick: number; born: number }
export interface Laser extends Point {
  id: number; angle: number; sweep: number; width: number; length: number; color: string;
  born: number; fireTick: number; endTick: number;
}
export interface Motion {
  kind: 'teleport' | 'charge'; from: Point; to: Point; born: number; fireTick: number; endTick: number;
}
export interface GameEvent extends Point {
  kind: 'hit' | 'bossHit' | 'phase' | 'minionDown' | 'won' | 'lost' | 'teleport' | 'taunt'; text: string;
}
export interface GameState {
  spec: BossSpec; seed: number; rng: number; difficulty: number; tick: number; id: number;
  status: 'intro' | 'playing' | 'won' | 'lost'; introTicks: number; hitStop: number;
  player: Point & { hearts: number; invulnerableUntil: number; nextShot: number; focused: boolean };
  boss: Point & { hp: number; phase: number; phaseStart: number; nextMotion: number; motion: Motion | null; coreOpenUntil: number };
  bullets: Bullet[]; shots: Shot[]; minions: Minion[]; pending: Pending[]; lasers: Laser[];
  nextAttacks: number[]; nextMinions: number; events: GameEvent[]; droppedBullets: number;
  script?: { cursor: number; motion: Motion | null; telegraphs: (Point & { radius: number; endTick: number })[] };
}

const radians = (degrees: number) => degrees * Math.PI / 180;
const ticks = (milliseconds: number) => Math.ceil(milliseconds * TICK_RATE / 1000);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const heading = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);

/** Squared distance to a segment, also used for fast bullets and finite laser beams. */
export function segmentDistanceSquared(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1);
  return (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
}

export function createGame(spec: unknown, seed = 314159, difficulty = 1): GameState {
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) throw new Error('Seed must be an integer.');
  if (!Number.isFinite(difficulty) || difficulty < 0.5 || difficulty > 1.5) throw new Error('Difficulty must be 0.5–1.5.');
  const parsed = BossSchema.parse(spec);
  return {
    spec: parsed, seed: seed >>> 0, rng: seed >>> 0, difficulty, tick: 0, id: 0,
    status: 'intro', introTicks: 120, hitStop: 0,
    player: { x: ARENA.width / 2, y: ARENA.height - 90, hearts: PLAYER.hearts, invulnerableUntil: 0, nextShot: 0, focused: false },
    boss: { x: ARENA.width / 2, y: 160, hp: parsed.hp, phase: 0, phaseStart: 0, nextMotion: 120, motion: null, coreOpenUntil: 0 },
    bullets: [], shots: [], minions: [], pending: [], lasers: [], events: [], droppedBullets: 0,
    nextAttacks: parsed.phases[0]!.attacks.map((_, index) => 45 + index * 60), nextMinions: 90,
    ...(parsed.choreography ? { script: { cursor: 0, motion: null, telegraphs: [] } } : {}),
  };
}

export function currentPhase(game: GameState) { return game.spec.phases[game.boss.phase]!; }
export function activeModifiers(game: GameState) {
  return (currentPhase(game).modifiers ?? []).filter((modifier) => game.tick - game.boss.phaseStart < ticks(modifier.durationMs));
}
export function arenaMargin(game: GameState): number {
  const modifier = activeModifiers(game).find((item) => item.kind === 'shrinkArena');
  return modifier?.kind === 'shrinkArena' ? ARENA.height * modifier.strength : 0;
}
function speedMultiplier(game: GameState) {
  const modifier = activeModifiers(game).find((item) => item.kind === 'speedUp');
  return game.difficulty * (modifier?.kind === 'speedUp' ? modifier.strength : 1);
}
function event(game: GameState, kind: GameEvent['kind'], position: Point, text = '') {
  game.events.push({ kind, x: position.x, y: position.y, text });
}

function approach(position: Point, target: Point, speed: number) {
  const length = distance(position, target);
  if (length > 0) {
    const fraction = Math.min(1, speed * DT / length);
    position.x += (target.x - position.x) * fraction;
    position.y += (target.y - position.y) * fraction;
  }
}

function moveBoss(game: GameState, movement: Movement) {
  const boss = game.boss, radius = game.spec.look.size;
  const scripted = game.script?.motion;
  if (scripted) {
    boss.motion = scripted;
    if (game.tick >= scripted.fireTick) {
      const progress = clamp((game.tick - scripted.fireTick + 1) / (scripted.endTick - scripted.fireTick), 0, 1);
      boss.x = scripted.from.x + (scripted.to.x - scripted.from.x) * progress;
      boss.y = scripted.from.y + (scripted.to.y - scripted.from.y) * progress;
    }
    if (game.tick >= scripted.endTick) { game.script!.motion = null; boss.motion = null; }
    return;
  }
  const speed = movement.speed * speedMultiplier(game);
  const t = game.tick / TICK_RATE;
  if (movement.kind === 'teleport' || movement.kind === 'charge') {
    if (!boss.motion && game.tick >= boss.nextMotion) {
      const target = movement.kind === 'teleport'
        ? { x: radius + 60 + random(game) * (ARENA.width - 2 * radius - 120), y: 90 + random(game) * 220 }
        : { x: clamp(game.player.x, radius, ARENA.width - radius), y: clamp(game.player.y, radius, ARENA.height - radius) };
      const fireTick = game.tick + ticks(movement.telegraphMs);
      boss.motion = { kind: movement.kind, from: { x: boss.x, y: boss.y }, to: target, born: game.tick, fireTick,
        endTick: fireTick + (movement.kind === 'charge' ? Math.max(1, Math.ceil(distance(boss, target) / Math.max(speed, 1) * TICK_RATE)) : 1) };
    }
    const motion = boss.motion;
    if (motion) {
      if (game.tick >= motion.fireTick) {
        if (motion.kind === 'teleport') {
          if (game.tick === motion.fireTick) {
            boss.x = motion.to.x; boss.y = motion.to.y;
            event(game, 'teleport', boss);
          }
        } else {
          const progress = clamp((game.tick - motion.fireTick + 1) / (motion.endTick - motion.fireTick), 0, 1);
          boss.x = motion.from.x + (motion.to.x - motion.from.x) * progress;
          boss.y = motion.from.y + (motion.to.y - motion.from.y) * progress;
        }
      }
      if (game.tick >= motion.endTick) { boss.motion = null; boss.nextMotion = game.tick + 150; }
    } else if (movement.kind === 'charge') approach(boss, { x: ARENA.width / 2, y: 160 }, speed);
    return;
  }
  let target: Point;
  switch (movement.kind) {
    case 'figure8': target = { x: ARENA.width / 2 + Math.sin(t * 1.1) * 280, y: 190 + Math.sin(t * 2.2) * 90 }; break;
    case 'orbitCenter': target = { x: ARENA.width / 2 + Math.cos(t * 0.7) * 260, y: 220 + Math.sin(t * 0.7) * 110 }; break;
    case 'followPlayer': target = { x: game.player.x, y: clamp(game.player.y - 240, 90, 350) }; break;
    case 'mirrorPlayer': target = { x: ARENA.width - game.player.x, y: clamp(ARENA.height - game.player.y, 90, 350) }; break;
    default: target = { x: ARENA.width / 2 + Math.sin(t * 0.65) * 110, y: 160 + Math.sin(t * 0.9) * 35 };
  }
  approach(boss, target, speed);
  boss.x = clamp(boss.x, radius, ARENA.width - radius);
  boss.y = clamp(boss.y, radius, ARENA.height - radius);
}

function spawnBullet(game: GameState, origin: Point, angle: number, attack: Exclude<Attack, { emitter: 'laser' }>) {
  if (game.bullets.length >= MAX_LIVE_BULLETS) { game.droppedBullets++; return; }
  const p = attack.params;
  game.bullets.push({ id: game.id++, x: origin.x, y: origin.y, previousX: origin.x, previousY: origin.y,
    angle, speed: p.speed * speedMultiplier(game), accel: p.accel, radius: p.bulletShape === 'capsule' ? 6 : 5,
    color: p.color, shape: p.bulletShape, bounce: p.bounce, expires: game.tick + 600,
    homing: attack.emitter === 'homing', armedAt: game.tick + (attack.emitter === 'mine' ? 60 : 0),
    targeted: ['aimed', 'fan', 'homing'].includes(attack.emitter) });
}

function emitVolley(game: GameState, pending: Pending) {
  const attack = pending.attack;
  if (attack.emitter === 'laser') return;
  const p = attack.params, spin = radians(p.spin) * game.tick / TICK_RATE;
  for (let index = 0; index < p.count; index++) {
    let angle = pending.angle, origin: Point = pending;
    const fraction = (index + 0.5) / p.count;
    switch (attack.emitter) {
      case 'ring':
      case 'wallWithGap':
        angle = Math.PI / 2 + radians(p.gapAngle) / 2 + fraction * (Math.PI * 2 - radians(p.gapAngle)) + spin;
        // Center the ring's opening downward, toward the initial player position.
        if (attack.emitter === 'wallWithGap') {
          const gapX = clamp(game.player.x, 80, ARENA.width - 80);
          const gap = Math.max(55, p.gapAngle * 2);
          const x = fraction * ARENA.width;
          if (Math.abs(x - gapX) < gap / 2) continue;
          origin = { x, y: 20 }; angle = Math.PI / 2;
        }
        break;
      case 'spiral': angle = spin + index * Math.PI * 2 / p.count; break;
      case 'fan':
      case 'aimed':
      case 'homing': angle += (fraction - 0.5) * radians(p.count === 1 ? 0 : Math.max(15, p.gapAngle)); break;
      case 'wave': angle = Math.PI / 2 + Math.sin(index * 0.7 + game.tick / 30) * 0.45 + spin; break;
      case 'rain': origin = { x: 20 + random(game) * (ARENA.width - 40), y: 15 }; angle = Math.PI / 2; break;
      case 'mine': origin = { x: 50 + random(game) * (ARENA.width - 100), y: 260 + random(game) * (ARENA.height - 340) }; angle = index * Math.PI * 2 / p.count; break;
    }
    spawnBullet(game, origin, angle, attack);
  }
}

function scheduleAttack(game: GameState, attack: Attack) {
  const boss = game.boss, p = attack.params;
  if (attack.emitter === 'laser') {
    if (game.lasers.length >= 16) { game.droppedBullets++; return; }
    const p = attack.params;
    game.lasers.push({ id: game.id++, x: boss.x, y: boss.y,
      angle: p.aim === 'player' ? heading(boss, game.player) : radians(p.angle), sweep: radians(p.sweep), width: p.width, length: p.length,
      color: p.color, born: game.tick, fireTick: game.tick + ticks(p.telegraphMs), endTick: game.tick + ticks(p.telegraphMs) + ticks(p.durationMs) });
  } else if (game.pending.length < 32) {
    game.pending.push({ id: game.id++, x: boss.x, y: boss.y, attack, angle: heading(boss, game.player), born: game.tick, fireTick: game.tick + ticks(p.telegraphMs) });
  } else game.droppedBullets++;
}

function updateScript(game: GameState) {
  const script = game.script, frames = game.spec.choreography?.frames;
  if (!script || !frames) return;
  script.telegraphs = script.telegraphs.filter((warning) => game.tick < warning.endTick);
  for (let budget = 0; budget < 16 && frames[script.cursor]?.tick === game.tick; budget++) {
    const command = frames[script.cursor++]!.command;
    if (command.kind === 'emit') scheduleAttack(game, command.attack);
    else if (command.kind === 'say') event(game, 'taunt', game.boss, command.text);
    else if (command.kind === 'telegraph' && script.telegraphs.length < 32) script.telegraphs.push({ x: command.x, y: command.y, radius: command.radius, endTick: game.tick + ticks(command.durationMs) });
    else if (command.kind === 'moveTo') {
      const radius = game.spec.look.size, fireTick = game.tick + ticks(MIN_TELEGRAPH_MS);
      script.motion = { kind: 'charge', from: { x: game.boss.x, y: game.boss.y }, to: { x: clamp(command.x, radius, ARENA.width - radius), y: clamp(command.y, radius, ARENA.height - radius) },
        born: game.tick, fireTick, endTick: fireTick + Math.max(1, ticks(command.durationMs)) };
    }
  }
}

function updateAttacks(game: GameState) {
  const phase = currentPhase(game);
  phase.attacks.forEach((attack, index) => {
    if (game.tick >= game.nextAttacks[index]!) {
      scheduleAttack(game, attack);
      game.nextAttacks[index] = game.tick + Math.max(1, Math.ceil(attack.params.interval * TICK_RATE / game.difficulty));
    }
  });
  game.pending = game.pending.filter((pending) => {
    if (game.tick < pending.fireTick) return true;
    emitVolley(game, pending); return false;
  });
  for (const laser of game.lasers) {
    if (game.tick === laser.endTick) game.boss.coreOpenUntil = game.tick + 120;
  }
  game.lasers = game.lasers.filter((laser) => game.tick < laser.endTick);
}

function updateMinions(game: GameState) {
  const config = currentPhase(game).minions;
  if (config && game.tick >= game.nextMinions) {
    for (let index = 0; index < config.count && game.minions.length < MAX_LIVE_MINIONS; index++) {
      const angle = index * Math.PI * 2 / config.count + random(game) * 0.3;
      const x = game.boss.x + Math.cos(angle) * 100, y = game.boss.y + Math.sin(angle) * 100;
      game.minions.push({ id: game.id++, x, y, previousX: x, previousY: y,
        kind: config.kind, hp: config.hp, maxHp: config.hp, angle, nextShot: game.tick + 90 + index * 20, born: game.tick, generation: 0 });
    }
    game.nextMinions = game.tick + Math.ceil(config.every * TICK_RATE);
  }
  for (const minion of game.minions) {
    minion.previousX = minion.x; minion.previousY = minion.y;
    if (minion.kind === 'orbiter') {
      const angle = minion.angle + (game.tick - minion.born) / 70;
      minion.x = game.boss.x + Math.cos(angle) * 110; minion.y = game.boss.y + Math.sin(angle) * 85;
    } else if (minion.kind === 'kamikaze' || minion.kind === 'splitter') approach(minion, game.player, minion.kind === 'kamikaze' ? 115 : 60);
    minion.x = clamp(minion.x, 14, ARENA.width - 14); minion.y = clamp(minion.y, 14, ARENA.height - 14);
    if (game.tick >= minion.nextShot && minion.kind !== 'kamikaze') {
      spawnBullet(game, minion, heading(minion, game.player), { emitter: 'aimed', params: {
        count: 1, speed: 135, accel: 0, spin: 0, gapAngle: 0, interval: 2, telegraphMs: 0, bulletShape: 'circle', color: game.spec.look.palette[1]!, bounce: 0,
      } });
      minion.nextShot = game.tick + (minion.kind === 'turret' ? 90 : 150);
    }
  }
}

function updateBullets(game: GameState) {
  game.bullets = game.bullets.filter((bullet) => {
    if (game.tick >= bullet.expires) return false;
    bullet.previousX = bullet.x; bullet.previousY = bullet.y;
    if (game.tick < bullet.armedAt) return true;
    if (bullet.homing && game.tick < bullet.expires - 480) {
      const desired = heading(bullet, game.player);
      const difference = Math.atan2(Math.sin(desired - bullet.angle), Math.cos(desired - bullet.angle));
      bullet.angle += clamp(difference, -0.015, 0.015);
    }
    bullet.speed = clamp(bullet.speed + bullet.accel * DT, 0, 1200);
    bullet.x += Math.cos(bullet.angle) * bullet.speed * DT;
    bullet.y += Math.sin(bullet.angle) * bullet.speed * DT;
    if (bullet.bounce > 0) {
      if (bullet.x < bullet.radius || bullet.x > ARENA.width - bullet.radius) {
        bullet.angle = Math.PI - bullet.angle; bullet.x = clamp(bullet.x, bullet.radius, ARENA.width - bullet.radius); bullet.bounce--;
      } else if (bullet.y < bullet.radius || bullet.y > ARENA.height - bullet.radius) {
        bullet.angle = -bullet.angle; bullet.y = clamp(bullet.y, bullet.radius, ARENA.height - bullet.radius); bullet.bounce--;
      }
    }
    return bullet.x > -40 && bullet.x < ARENA.width + 40 && bullet.y > -40 && bullet.y < ARENA.height + 40;
  });
}

export function laserAngle(laser: Laser, tick: number) {
  return laser.angle + laser.sweep * clamp((tick - laser.fireTick) / (laser.endTick - laser.fireTick), 0, 1);
}
export function laserEnd(laser: Laser, tick: number): Point {
  const angle = laserAngle(laser, tick);
  return { x: laser.x + Math.cos(angle) * laser.length, y: laser.y + Math.sin(angle) * laser.length };
}

/** Include the sector swept since the previous tick, so fast beams cannot tunnel. */
export function laserHitsPoint(laser: Laser, tick: number, point: Point, radius = PLAYER.radius): boolean {
  if (tick < laser.fireTick || tick >= laser.endTick) return false;
  const padding = laser.width / 2 + radius;
  if (segmentDistanceSquared(point, laser, laserEnd(laser, tick)) <= padding ** 2) return true;
  const previousTick = Math.max(laser.fireTick, tick - 1);
  if (segmentDistanceSquared(point, laser, laserEnd(laser, previousTick)) <= padding ** 2) return true;
  const start = laserAngle(laser, previousTick), delta = laserAngle(laser, tick) - start;
  if (delta === 0 || distance(point, laser) > laser.length + padding) return false;
  const offset = (Math.atan2(point.y - laser.y, point.x - laser.x) - start) * Math.sign(delta);
  const angle = (offset % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return angle <= Math.abs(delta);
}

export function aimAhead(origin: Point, target: Point, previous: Point): Point {
  const vx = (target.x - previous.x) * TICK_RATE, vy = (target.y - previous.y) * TICK_RATE;
  const dx = target.x - origin.x, dy = target.y - origin.y;
  const a = vx * vx + vy * vy - 800 ** 2, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
  const discriminant = b * b - 4 * a * c;
  let time = distance(origin, target) / 800;
  if (Math.abs(a) > 0.01 && discriminant >= 0) {
    const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)].filter((value) => value > 0);
    if (roots.length) time = Math.min(...roots);
  }
  // Bound prediction after teleports or abrupt target changes.
  time = clamp(time, 0, 0.85);
  return { x: target.x + vx * time, y: target.y + vy * time };
}

function updateShots(game: GameState, input: Input, previousBoss: Point) {
  if (input.fire !== false && game.tick >= game.player.nextShot) {
    let target: Point = game.boss;
    let previous = game.events.some((event) => event.kind === 'teleport') ? game.boss : previousBoss;
    if (game.minions.length) {
      const minion = [...game.minions].sort((a, b) => distance(a, game.player) - distance(b, game.player) || a.id - b.id)[0]!;
      target = minion; previous = { x: minion.previousX, y: minion.previousY };
    }
    const angle = heading(game.player, aimAhead(game.player, target, previous));
    for (const offset of [-6, 6]) {
      game.shots.push({ x: game.player.x + offset, y: game.player.y - 12, previousX: game.player.x + offset, previousY: game.player.y - 12,
        vx: Math.cos(angle) * 800, vy: Math.sin(angle) * 800 });
    }
    game.player.nextShot = game.tick + 8;
  }
  game.shots = game.shots.filter((shot) => {
    shot.previousX = shot.x; shot.previousY = shot.y;
    shot.x += shot.vx * DT; shot.y += shot.vy * DT;
    const before = { x: shot.previousX, y: shot.previousY };
    for (const minion of game.minions) {
      if (minion.hp > 0 && segmentDistanceSquared(minion, before, shot) <= 16 ** 2) { minion.hp -= 4; return false; }
    }
    if (segmentDistanceSquared(game.boss, before, shot) <= (game.spec.look.size * 0.8 + 3) ** 2) {
      const weakPoint = currentPhase(game).weakPoint;
      let damage = 4;
      if (weakPoint === 'minionsFirst' && game.minions.some((minion) => minion.hp > 0)) damage = 0;
      if (weakPoint === 'coreOpenAfterLaser' && game.tick >= game.boss.coreOpenUntil) damage *= 0.5;
      if (weakPoint === 'back' && shot.y > game.boss.y) damage *= 0.25;
      const shield = activeModifiers(game).find((item) => item.kind === 'shield');
      if (shield?.kind === 'shield') damage *= 1 - shield.strength;
      game.boss.hp = Math.max(0, game.boss.hp - damage);
      if (damage > 0) event(game, 'bossHit', shot);
      return false;
    }
    return shot.x > -20 && shot.x < ARENA.width + 20 && shot.y > -20 && shot.y < ARENA.height + 20;
  });
  const children: Minion[] = [];
  for (const minion of game.minions) {
    if (minion.hp > 0) continue;
    event(game, 'minionDown', minion);
    if (minion.kind === 'splitter' && minion.generation === 0) {
      for (const side of [-1, 1]) children.push({ ...minion, id: game.id++, x: minion.x + side * 18, hp: Math.ceil(minion.maxHp / 2), maxHp: Math.ceil(minion.maxHp / 2), generation: 1 });
    }
  }
  game.minions = [...game.minions.filter((minion) => minion.hp > 0), ...children].slice(0, MAX_LIVE_MINIONS);
}

function playerCollisions(game: GameState, previous: Point, previousBoss: Point) {
  if (game.tick < game.player.invulnerableUntil) return;
  const bullet = game.bullets.find((bullet) => game.tick >= bullet.armedAt && segmentDistanceSquared({ x: 0, y: 0 },
    { x: bullet.previousX - previous.x, y: bullet.previousY - previous.y },
    { x: bullet.x - game.player.x, y: bullet.y - game.player.y }) <= (bullet.radius + PLAYER.radius) ** 2);
  const laser = game.lasers.some((laser) => laserHitsPoint(laser, game.tick, game.player));
  const contact = segmentDistanceSquared({ x: 0, y: 0 },
    { x: previousBoss.x - previous.x, y: previousBoss.y - previous.y },
    { x: game.boss.x - game.player.x, y: game.boss.y - game.player.y }) <= (game.spec.look.size * 0.75 + PLAYER.radius) ** 2;
  const minion = game.minions.find((minion) => distance(minion, game.player) <= 14 + PLAYER.radius);
  // Teleports do not sweep damage across the arena; landing contact still counts.
  const bossContact = game.events.some((item) => item.kind === 'teleport')
    ? distance(game.boss, game.player) <= game.spec.look.size * 0.75 + PLAYER.radius : contact;
  if (!bullet && !laser && !bossContact && !minion) return;
  if (bullet) game.bullets = game.bullets.filter((item) => item.id !== bullet.id);
  if (minion?.kind === 'kamikaze') game.minions = game.minions.filter((item) => item.id !== minion.id);
  game.player.hearts--;
  game.player.invulnerableUntil = game.tick + PLAYER.invulnerabilityTicks;
  game.hitStop = 5;
  event(game, 'hit', game.player, game.spec.taunts.onPlayerHit);
}

/** One call is one fixed 1/60 second input step. No DOM, clock, IO or hidden RNG. */
export function stepGame(game: GameState, input: Input): void {
  game.events = [];
  if (game.status === 'won' || game.status === 'lost') return;
  if (game.status === 'intro') {
    if (--game.introTicks <= 0) game.status = 'playing';
    return;
  }
  if (game.hitStop > 0) { game.hitStop--; return; }
  game.tick++;
  const previous = { x: game.player.x, y: game.player.y }, previousBoss = { x: game.boss.x, y: game.boss.y };
  let dx = Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0;
  let dy = Number.isFinite(input.y) ? clamp(input.y, -1, 1) : 0;
  const length = Math.hypot(dx, dy);
  if (length > 1) { dx /= length; dy /= length; }
  if (activeModifiers(game).some((modifier) => modifier.kind === 'reverseControls')) { dx = -dx; dy = -dy; }
  const speed = input.focus ? PLAYER.focusSpeed : PLAYER.speed, margin = arenaMargin(game);
  game.player.x = clamp(game.player.x + dx * speed * DT, margin + 12, ARENA.width - margin - 12);
  game.player.y = clamp(game.player.y + dy * speed * DT, margin + 12, ARENA.height - margin - 12);
  game.player.focused = !!input.focus;

  updateScript(game);
  moveBoss(game, currentPhase(game).movement);
  updateAttacks(game);
  updateMinions(game);
  updateBullets(game);
  updateShots(game, input, previousBoss);
  playerCollisions(game, previous, previousBoss);

  // A simultaneous last hit is a defeat: surviving is part of winning.
  if (game.player.hearts <= 0 || game.tick >= TICK_RATE * 180) {
    game.status = 'lost'; event(game, 'lost', game.player, game.tick >= TICK_RATE * 180 ? 'Time expired.' : game.spec.taunts.onPlayerHit);
  } else if (game.boss.hp <= 0) {
    game.status = 'won'; event(game, 'won', game.boss, game.spec.taunts.onDeath);
  } else {
    let phase = 0;
    game.spec.phases.forEach((candidate, index) => { if (game.boss.hp / game.spec.hp <= candidate.hpBelow) phase = index; });
    if (phase !== game.boss.phase) {
      game.boss.phase = phase; game.boss.phaseStart = game.tick; game.boss.motion = null; game.boss.nextMotion = game.tick + 90;
      game.nextAttacks = currentPhase(game).attacks.map((_, index) => game.tick + 45 + index * 60);
      game.nextMinions = game.tick + 90;
      // Clear old-phase warnings so no attack fires with obsolete phase rules.
      game.pending = []; game.lasers = [];
      if (game.script) game.script.motion = null;
      event(game, 'phase', game.boss, game.spec.taunts.phaseChange);
    }
  }
}

/** Stable same-runtime replay checksum over all serializable future-affecting state. */
export function stateHash(game: GameState): string {
  const source = JSON.stringify(game);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
