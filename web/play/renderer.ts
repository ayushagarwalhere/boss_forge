import { ARENA, PLAYER, TICK_RATE } from '../../engine/constants';
import { activeModifiers, arenaMargin, laserAngle, laserEnd, type GameState, type Point } from '../../engine/simulation';

interface Particle extends Point { vx: number; vy: number; life: number; maxLife: number; color: string; radius: number }
export class Effects {
  particles: Particle[] = [];
  shake = 0;
  flash = 0;
  private serial = 0;
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  consume(game: GameState) {
    for (const event of game.events) {
      const count = event.kind === 'bossHit' ? 2 : event.kind === 'hit' ? 32 : event.kind === 'won' ? 90 : 20;
      const color = event.kind === 'hit' ? '#FF8674' : event.kind === 'bossHit' ? '#DDF8BD' : game.spec.look.palette[0]!;
      if (event.kind === 'hit') { this.shake = this.reducedMotion ? 0 : 13; this.flash = this.reducedMotion ? 0 : 0.25; }
      if (event.kind === 'phase' || event.kind === 'won') this.shake = this.reducedMotion ? 0 : 7;
      for (let index = 0; index < count && this.particles.length < 350; index++) {
        const value = ++this.serial;
        const angle = value * 2.399963;
        const speed = 30 + (value * 37 % 170);
        const life = 0.2 + (value % 11) * 0.035;
        this.particles.push({ x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life, maxLife: life, color, radius: event.kind === 'won' ? 3 : 2 });
      }
    }
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 38);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.particles = this.particles.filter((particle) => {
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.life -= dt;
      return particle.life > 0;
    });
  }
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string | CanvasGradient | CanvasPattern) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}
function polygon(ctx: CanvasRenderingContext2D, radius: number, points: number, offset = 0) {
  ctx.beginPath();
  for (let index = 0; index < points; index++) {
    const angle = offset + index * Math.PI * 2 / points;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawBoss(ctx: CanvasRenderingContext2D, game: GameState, time: number) {
  const { look } = game.spec, { boss } = game;
  const size = look.size, main = look.palette[0]!, light = look.palette[1]!;
  ctx.save(); ctx.translate(boss.x, boss.y);
  const glow = ctx.createRadialGradient(0, 0, size * 0.25, 0, 0, size * 3);
  glow.addColorStop(0, `${main}35`); glow.addColorStop(1, `${main}00`);
  circle(ctx, 0, 0, size * 3, glow);
  ctx.strokeStyle = `${main}55`; ctx.lineWidth = 1;
  ctx.save(); ctx.rotate(time * 0.18); ctx.setLineDash([3, 12]);
  ctx.beginPath(); ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  if (look.aura === 'flame') {
    for (let index = 0; index < 12; index++) {
      const angle = index * Math.PI / 6 + time * 0.13;
      const reach = size * (1.3 + Math.sin(time * 3 + index * 2) * 0.12);
      ctx.strokeStyle = `${main}66`; ctx.lineWidth = 3;
      line(ctx, { x: Math.cos(angle) * size * 0.9, y: Math.sin(angle) * size * 0.9 }, { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
    }
  } else if (look.aura === 'glitch') {
    ctx.fillStyle = `${main}55`;
    for (let index = 0; index < 4; index++) {
      const offset = Math.sin(time * 7 + index * 3);
      ctx.fillRect(-size * 1.5 + offset * 10, (index - 1.5) * size * 0.8, size * (1 + offset), 2);
    }
  } else {
    ctx.strokeStyle = `${main}44`;
    for (let index = 0; index < 3; index++) {
      ctx.beginPath(); ctx.ellipse(0, 0, size * (1.6 + index * 0.2), size * 0.55, time * 0.2 + index, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.strokeStyle = main; ctx.lineWidth = 2; ctx.fillStyle = `${main}25`;
  switch (look.shape) {
    case 'mech': {
      ctx.save(); ctx.rotate(Math.sin(time) * 0.03);
      polygon(ctx, size, 8, Math.PI / 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#241E19'; ctx.fillRect(-size * 0.82, -size * 0.38, size * 1.64, size * 0.76);
      ctx.strokeRect(-size * 0.82, -size * 0.38, size * 1.64, size * 0.76);
      ctx.fillStyle = light; ctx.fillRect(-size * 0.52, -size * 0.09, size * 1.04, size * 0.18);
      for (const side of [-1, 1]) for (let index = 0; index < 3; index++) {
        ctx.fillStyle = main; ctx.fillRect((index - 1) * size * 0.25 - 4, side * size * 0.58 - 3, 8, 6);
      }
      polygon(ctx, size * 0.22, 4); ctx.fillStyle = '#FFF5DB'; ctx.fill(); ctx.restore(); break;
    }
    case 'blob': {
      ctx.beginPath();
      for (let index = 0; index <= 48; index++) {
        const angle = index * Math.PI * 2 / 48, radius = size * (1 + Math.sin(angle * 5 + time * 3) * 0.12);
        const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
        if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.fill(); ctx.stroke();
      circle(ctx, -size * 0.31, -3, size * 0.17, light); circle(ctx, size * 0.31, -3, size * 0.17, light);
      ctx.strokeStyle = light; ctx.beginPath(); ctx.arc(0, size * 0.12, size * 0.33, 0.2, Math.PI - 0.2); ctx.stroke(); break;
    }
    case 'crystal': {
      ctx.save(); ctx.scale(0.85, 1.25); ctx.rotate(Math.sin(time * 0.6) * 0.13);
      polygon(ctx, size, 4); ctx.fill(); ctx.stroke();
      line(ctx, { x: 0, y: -size }, { x: -size * 0.4, y: 0 }); line(ctx, { x: 0, y: -size }, { x: size * 0.4, y: 0 });
      line(ctx, { x: -size, y: 0 }, { x: size, y: 0 }); line(ctx, { x: -size * 0.4, y: 0 }, { x: 0, y: size });
      line(ctx, { x: size * 0.4, y: 0 }, { x: 0, y: size });
      ctx.fillStyle = game.tick < boss.coreOpenUntil ? '#FFFFFF' : light; polygon(ctx, size * 0.28, 4); ctx.fill();
      ctx.restore(); break;
    }
    case 'eye':
      ctx.beginPath(); ctx.ellipse(0, 0, size, size * 0.65, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      circle(ctx, 0, 0, size * 0.5, main); circle(ctx, 0, 0, size * 0.25, '#080E0E'); circle(ctx, size * 0.1, -size * 0.15, size * 0.1, light); break;
    case 'skull':
      polygon(ctx, size, 7, -Math.PI / 2); ctx.fill(); ctx.stroke();
      circle(ctx, -size * 0.33, -size * 0.1, size * 0.23, main); circle(ctx, size * 0.33, -size * 0.1, size * 0.23, main);
      for (let index = -1; index <= 1; index++) line(ctx, { x: index * size * 0.2, y: size * 0.35 }, { x: index * size * 0.2, y: size * 0.65 }); break;
    case 'serpent':
      for (let index = 6; index >= 0; index--) {
        const x = Math.sin(time * 2 - index * 0.5) * size * 0.5, y = index * size * 0.24;
        circle(ctx, x, y, size * (0.55 - index * 0.055), `${main}88`);
      }
      circle(ctx, -size * 0.15, -4, 4, light); circle(ctx, size * 0.15, -4, 4, light); break;
  }
  ctx.restore();
}

export function renderGame(ctx: CanvasRenderingContext2D, game: GameState, time: number, effects: Effects, lobby: boolean) {
  const width = ARENA.width, height = ARENA.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0A1111'; ctx.fillRect(0, 0, width, height);
  const backdrop = ctx.createRadialGradient(width / 2, 200, 40, width / 2, 300, 650);
  backdrop.addColorStop(0, '#182624'); backdrop.addColorStop(1, '#080E10');
  ctx.fillStyle = backdrop; ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(Math.sin(time * 97) * effects.shake, Math.cos(time * 113) * effects.shake);
  ctx.strokeStyle = '#A9C69A0A'; ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) line(ctx, { x, y: 0 }, { x, y: height });
  for (let y = 0; y <= height; y += 48) line(ctx, { x: 0, y }, { x: width, y });
  ctx.save(); ctx.translate(width / 2, height / 2); ctx.strokeStyle = '#A9C69A12';
  for (const radius of [140, 260, 380]) { ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  for (let index = 0; index < 55; index++) {
    const x = (index * 137 + 33) % width, y = (index * 229 + 71) % height;
    circle(ctx, x, y, index % 3 === 0 ? 1.3 : 0.7, '#D6E8BD32');
  }
  const margin = arenaMargin(game);
  ctx.strokeStyle = '#788D5944'; ctx.lineWidth = 1; ctx.setLineDash([6, 9]);
  ctx.strokeRect(margin + 14, margin + 14, width - margin * 2 - 28, height - margin * 2 - 28); ctx.setLineDash([]);
  // Warnings are locked to the future attack's origin and direction.
  for (const pending of game.pending) {
    ctx.strokeStyle = `${pending.attack.params.color}77`; ctx.lineWidth = 1; ctx.setLineDash([4, 8]);
    const attack = pending.attack;
    if (attack.emitter === 'aimed' || attack.emitter === 'fan' || attack.emitter === 'homing') {
      line(ctx, pending, { x: pending.x + Math.cos(pending.angle) * 900, y: pending.y + Math.sin(pending.angle) * 900 });
    }
    ctx.beginPath(); ctx.arc(pending.x, pending.y, 18 + 8 * Math.sin(time * 7), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const laser of game.lasers) {
    const active = game.tick >= laser.fireTick;
    const end = laserEnd(laser, game.tick);
    ctx.strokeStyle = active ? `${laser.color}66` : `${laser.color}55`;
    ctx.lineWidth = laser.width + (active ? 12 : 0); ctx.setLineDash(active ? [] : [12, 12]);
    line(ctx, laser, end);
    if (!active && laser.sweep !== 0) {
      ctx.beginPath(); ctx.moveTo(laser.x, laser.y);
      ctx.arc(laser.x, laser.y, laser.length, laser.angle, laser.angle + laser.sweep, laser.sweep < 0); ctx.closePath();
      ctx.fillStyle = `${laser.color}16`; ctx.fill();
    }
    ctx.setLineDash([]); ctx.strokeStyle = active ? '#F9F9F0' : `${laser.color}AA`; ctx.lineWidth = active ? laser.width * 0.45 : 1;
    line(ctx, laser, end);
    if (active) { ctx.strokeStyle = laser.color; ctx.lineWidth = 2; const angle = laserAngle(laser, game.tick); circle(ctx, laser.x + Math.cos(angle) * 25, laser.y + Math.sin(angle) * 25, 7, laser.color); }
    circle(ctx, laser.x, laser.y, 9, `${laser.color}BB`);
  }
  const motion = game.boss.motion;
  for (const warning of game.script?.telegraphs ?? []) {
    ctx.strokeStyle = '#D7F6AA88'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(warning.x, warning.y, warning.radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (motion && game.tick < motion.fireTick) {
    ctx.strokeStyle = '#FFAE7277'; ctx.lineWidth = motion.kind === 'charge' ? game.spec.look.size * 1.5 : 2;
    ctx.setLineDash([9, 10]);
    if (motion.kind === 'charge') line(ctx, motion.from, motion.to);
    else { ctx.beginPath(); ctx.arc(motion.to.x, motion.to.y, game.spec.look.size + 10, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  for (const bullet of game.bullets) {
    const armed = game.tick >= bullet.armedAt;
    circle(ctx, bullet.x, bullet.y, bullet.radius + 5, `${bullet.color}${armed ? '22' : '10'}`);
    ctx.save(); ctx.translate(bullet.x, bullet.y); ctx.rotate(bullet.angle);
    ctx.fillStyle = armed ? bullet.color : `${bullet.color}77`;
    if (bullet.shape === 'diamond' || bullet.shape === 'shard') {
      ctx.scale(bullet.shape === 'shard' ? 1.7 : 1, 1); polygon(ctx, bullet.radius + 1, 4); ctx.fill();
    } else if (bullet.shape === 'capsule') {
      ctx.beginPath(); ctx.ellipse(0, 0, bullet.radius * 1.6, bullet.radius * 0.75, 0, 0, Math.PI * 2); ctx.fill();
    } else circle(ctx, 0, 0, bullet.radius, ctx.fillStyle);
    circle(ctx, 0, 0, 1.5, '#FFFFFFBB'); ctx.restore();
  }
  for (const minion of game.minions) {
    ctx.save(); ctx.translate(minion.x, minion.y); ctx.rotate(time + minion.angle);
    ctx.fillStyle = `${game.spec.look.palette[0]}33`; ctx.strokeStyle = game.spec.look.palette[0]!; ctx.lineWidth = 1.5;
    polygon(ctx, 13, minion.kind === 'turret' ? 4 : minion.kind === 'kamikaze' ? 3 : 6); ctx.fill(); ctx.stroke();
    circle(ctx, 0, 0, 4, game.spec.look.palette[1]!); ctx.restore();
    ctx.fillStyle = '#465349'; ctx.fillRect(minion.x - 14, minion.y + 20, 28, 2);
    ctx.fillStyle = game.spec.look.palette[0]!; ctx.fillRect(minion.x - 14, minion.y + 20, 28 * Math.max(0, minion.hp / minion.maxHp), 2);
  }
  ctx.strokeStyle = '#D7F6AA99'; ctx.lineWidth = 3;
  for (const shot of game.shots) line(ctx, shot, { x: shot.x - shot.vx * 0.018, y: shot.y - shot.vy * 0.018 });
  if (game.status !== 'won') drawBoss(ctx, game, effects.reducedMotion ? 0 : time);
  const player = game.player;
  if (!lobby && game.status !== 'lost') {
    ctx.save(); ctx.translate(player.x, player.y);
    ctx.globalAlpha = game.tick < player.invulnerableUntil && Math.floor(game.tick / 5) % 2 ? 0.35 : 1;
    ctx.fillStyle = '#CCEBAA22'; ctx.beginPath(); ctx.ellipse(0, 12, 12, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#DEF5BD'; ctx.strokeStyle = '#ECFFD7'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(10, 10); ctx.lineTo(0, 5); ctx.lineTo(-10, 10); ctx.closePath(); ctx.fill();
    if (player.focused) {
      ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      circle(ctx, 0, 0, PLAYER.radius + 2, '#14201A'); circle(ctx, 0, 0, PLAYER.radius, '#FFFFFF');
    } else circle(ctx, 0, 0, 2, '#566A37');
    ctx.restore();
  }
  for (const particle of effects.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    circle(ctx, particle.x, particle.y, particle.radius, particle.color);
  }
  ctx.globalAlpha = 1;
  if (activeModifiers(game).some((modifier) => modifier.kind === 'darkness')) {
    const darkness = activeModifiers(game).find((modifier) => modifier.kind === 'darkness');
    const mask = ctx.createRadialGradient(player.x, player.y, 70, player.x, player.y, 300);
    mask.addColorStop(0, '#00000000'); mask.addColorStop(1, `rgba(0,0,0,${darkness?.kind === 'darkness' ? darkness.strength : 0})`);
    ctx.fillStyle = mask; ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
  // HUD remains stable during screen shake.
  ctx.fillStyle = '#0A1010CC'; ctx.fillRect(45, 35, width - 90, 64);
  ctx.font = '11px "Courier New",monospace'; ctx.fillStyle = '#C3D2B7'; ctx.textAlign = 'left';
  ctx.fillText(game.spec.meta.name.toUpperCase(), 64, 59);
  ctx.textAlign = 'right'; ctx.fillStyle = '#829177'; ctx.fillText(`PHASE ${String(game.boss.phase + 1).padStart(2, '0')}  /  ${Math.ceil(game.boss.hp)} HP`, width - 64, 59);
  ctx.fillStyle = '#31402C'; ctx.fillRect(64, 74, width - 128, 5);
  ctx.fillStyle = game.spec.look.palette[0]!; ctx.fillRect(64, 74, (width - 128) * game.boss.hp / game.spec.hp, 5);
  for (const phase of game.spec.phases.slice(1)) {
    const x = 64 + (width - 128) * phase.hpBelow;
    ctx.fillStyle = '#E5EFDB'; ctx.fillRect(x - 1, 72, 2, 9);
  }
  ctx.textAlign = 'left'; ctx.font = '9px "Courier New",monospace'; ctx.fillStyle = '#697D6C';
  ctx.fillText('LOCAL PLAY / HOUSE COLLECTION', 28, height - 23);
  ctx.textAlign = 'right'; ctx.fillText(`${ARENA.width} × ${ARENA.height}  /  ${TICK_RATE} HZ`, width - 28, height - 23);
  if (effects.flash > 0) { ctx.fillStyle = `rgba(255,100,75,${effects.flash})`; ctx.fillRect(0, 0, width, height); }
}
