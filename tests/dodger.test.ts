import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createDodger, dodge } from '../engine/dodger';
import { createGame, stepGame, type Bullet } from '../engine/simulation';

const fixture: unknown = JSON.parse(await readFile(new URL('../bosses/house/prism-warden.json', import.meta.url), 'utf8'));
describe('reference dodger', () => {
  it('replays legal inputs with its own seeded state', () => {
    const a = createGame(fixture, 17), b = createGame(fixture, 17);
    const botA = createDodger(17), botB = createDodger(17);
    for (let tick = 0; tick < 600; tick++) {
      const inputA = dodge(a, botA), inputB = dodge(b, botB);
      expect(inputA).toEqual(inputB);
      expect(Math.hypot(inputA.x, inputA.y)).toBeLessThanOrEqual(1.0000001);
      expect(inputA.fire).toBe(true);
      stepGame(a, inputA); stepGame(b, inputB);
    }
    expect(a.player.hearts).toBeLessThanOrEqual(3);
    expect(a.player.invulnerableUntil).toBeLessThan(100000); // No damage-probe immunity in the reference bot.
  });

  it('pushes away from an oncoming bullet instead of steering toward it', () => {
    const game = createGame(fixture), bot = createDodger(17); game.status = 'playing';
    bot.anchorX = game.player.x; bot.anchorY = game.player.y; bot.sway = 0;
    const bullet: Bullet = { id: 1, x: game.player.x + 30, y: game.player.y - 80, previousX: 0, previousY: 0,
      angle: Math.PI / 2, speed: 180, accel: 0, radius: 5, color: '#FFFFFF', shape: 'circle', bounce: 0, expires: 600, homing: false, armedAt: 0, targeted: true };
    game.bullets.push(bullet);
    expect(dodge(game, bot).x).toBeLessThan(0);
  });
});
