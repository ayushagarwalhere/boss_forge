import { BossSchema, type BossSpec } from '../../engine/boss-api';
import type { FightStats } from '../../engine/forge-protocol';
import { mark, rematchName } from './rematch';

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Offline Rematch Patch used when no live Codex is available (replay/demo mode). Deterministic and
 * deliberately mild: the authoritative server gate still decides whether the upgrade ships.
 * `slack` (0..1) reflects how easily the reference bot beat the original (more bot wins => more room).
 */
export function tuneForRematch(previous: BossSpec, generation: number, stats: FightStats | null, gateWins = 3): BossSpec {
  const slack = clamp((gateWins - 2) / 2, 0, 1); // 2 wins -> 0, 4 wins -> 1
  const comfortable = !stats || stats.heartsLeft >= 2;
  const cadence = 1 - (0.04 + 0.06 * slack) * (comfortable ? 1 : 0.6); // shorter interval = more pressure
  const { choreography: _compiled, ...rest } = structuredClone(previous); void _compiled; // inline tapes are rejected; scripts aren't replayed offline
  const spec = rest as BossSpec;
  spec.meta.name = rematchName(previous.meta.name, generation);
  spec.meta.reading = [
    `${mark(generation)} rematch after the streamer won${stats ? ` with ${stats.heartsLeft} heart${stats.heartsLeft === 1 ? '' : 's'} left` : ''}.`.slice(0, 100),
    'Attack cadence tightened; bullets move slightly faster.',
    'The final phase moves faster and hits harder.',
  ];
  spec.taunts.intro = `Round ${generation}. No mercy.`.slice(0, 40);
  spec.hp = clamp(Math.round(previous.hp * (stats && stats.seconds < 60 ? 1.1 : 1.05)), 1, 100000);
  const last = spec.phases.length - 1;
  spec.phases.forEach((phase, index) => {
    const final = index === last;
    for (const attack of phase.attacks) {
      if (attack.emitter === 'laser') {
        attack.params.interval = round(clamp(attack.params.interval * (final ? cadence - 0.02 : cadence), 0.5, 30));
      } else {
        attack.params.interval = round(clamp(attack.params.interval * (final ? cadence - 0.02 : cadence), 0.05, 30), 3);
        // Aimed/homing speed is capped by the gate; only untargeted patterns get faster.
        if (!['aimed', 'homing'].includes(attack.emitter)) attack.params.speed = round(clamp(attack.params.speed * (1 + 0.04 * slack), 0, 1200), 1);
      }
    }
    if (final) phase.movement.speed = round(clamp(phase.movement.speed * 1.08, 0, 1000), 1);
  });
  return BossSchema.parse(spec);
}
