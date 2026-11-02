import type { BossSpec } from '../../engine/boss-api';
import { createDodger, dodge } from '../../engine/dodger';
import { createGame, stepGame } from '../../engine/simulation';

const MAX_TICKS = 60 * 240;

/**
 * Demo helper: the engine is deterministic, so replaying the reference dodger headlessly tells us
 * which bot seed wins this exact fight. Returns the first winning seed, or the fight seed if none do.
 * It only chooses the bot; the boss, fight seed and rules are untouched.
 */
export function findWinningBot(spec: BossSpec, seed: number, difficulty = 1, attempts = 24): number {
  for (let candidate = 0; candidate < attempts; candidate++) {
    const botSeed = (seed + candidate * 7919) >>> 0;
    const game = createGame(spec, seed, difficulty), bot = createDodger(botSeed);
    for (let tick = 0; tick < MAX_TICKS && game.status !== 'won' && game.status !== 'lost'; tick++) stepGame(game, dodge(game, bot));
    if (game.status === 'won') return botSeed;
  }
  return seed;
}
