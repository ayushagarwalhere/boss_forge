import { BossCommandSchema, type BossAPI, type BossCommand } from './boss-api';
import { TICK_RATE } from './constants';

export function commandAPI(rand: () => number): BossAPI {
  return {
    emit: (attack) => ({ kind: 'emit', attack }),
    moveTo: (x, y, durationMs) => ({ kind: 'moveTo', x, y, durationMs }),
    wait: (durationMs) => ({ kind: 'wait', durationMs }),
    say: (text) => ({ kind: 'say', text }),
    telegraph: (x, y, radius, durationMs) => ({ kind: 'telegraph', x, y, radius, durationMs }),
    rand,
  };
}

/** For trusted generators only. A yield budget cannot interrupt code inside next().
 * Runtime boss.ts loading is disabled until the isolated M5 executor exists.
 */
export class CommandStepper {
  private waitTicks = 0;
  private finished = false;

  constructor(private readonly generator: Generator<BossCommand, void, unknown>, readonly budget = 16) {
    if (!Number.isInteger(budget) || budget < 1 || budget > 100) throw new Error('Command budget must be 1–100.');
  }

  tick(): BossCommand[] {
    if (this.finished) return [];
    if (this.waitTicks > 0 && --this.waitTicks > 0) return [];
    const commands: BossCommand[] = [];
    for (let index = 0; index < this.budget; index++) {
      const next = this.generator.next();
      if (next.done) { this.finished = true; break; }
      const command = BossCommandSchema.parse(next.value);
      commands.push(command);
      if (command.kind === 'wait') {
        this.waitTicks = Math.max(1, Math.ceil(command.durationMs * TICK_RATE / 1000));
        break;
      }
    }
    return commands;
  }
}
