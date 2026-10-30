import { z } from 'zod';

export const TICK_RATE = 60;
export const MAX_LIVE_BULLETS = 400;
export const MIN_TELEGRAPH_MS = 350;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Opaque RGB hex color.');
const shortText = z.string().min(1).max(40);

export const MovementSchema = z.strictObject({
  kind: z.enum(['hover', 'figure8', 'orbitCenter', 'teleport', 'charge', 'followPlayer', 'mirrorPlayer']),
  speed: z.number().min(0).max(1000).describe('Arena pixels per second.'),
  telegraphMs: z.number().int().min(0).max(5000).describe('Warning before a charge or teleport; gate checks charge minimum.'),
});

export const AttackSchema = z.strictObject({
  emitter: z.enum(['spiral', 'ring', 'aimed', 'fan', 'wave', 'rain', 'laser', 'homing', 'mine', 'wallWithGap']),
  params: z.strictObject({
    count: z.number().int().min(1).max(MAX_LIVE_BULLETS),
    speed: z.number().min(0).max(1200).describe('Initial bullet speed in pixels/second; aimed cap is a gate rule.'),
    accel: z.number().min(-1000).max(1000).describe('Pixels/second squared; clamp bullet speed at zero.'),
    spin: z.number().min(-720).max(720).describe('Emitter rotation in degrees/second.'),
    gapAngle: z.number().min(0).max(360).describe('Opening width in degrees, centered opposite the emitter heading.'),
    interval: z.number().min(0.05).max(30).describe('Seconds between volleys.'),
    telegraphMs: z.number().int().min(0).max(5000),
    bulletShape: z.enum(['circle', 'diamond', 'shard', 'capsule']),
    color,
    bounce: z.number().int().min(0).max(3).describe('Maximum wall reflections per bullet.'),
  }),
});

export const ModifierSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('speedUp'), durationMs: z.number().int().min(1).max(10000), strength: z.number().min(1).max(2) }),
  z.strictObject({ kind: z.literal('darkness'), durationMs: z.number().int().min(1).max(10000), strength: z.number().min(0).max(0.75) }),
  z.strictObject({ kind: z.literal('shrinkArena'), durationMs: z.number().int().min(1).max(10000), strength: z.number().min(0).max(0.3) }),
  z.strictObject({ kind: z.literal('shield'), durationMs: z.number().int().min(1).max(3000), strength: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('reverseControls'), durationMs: z.number().int().min(1).max(3000) }),
]);

export const PhaseSchema = z.strictObject({
  hpBelow: z.number().gt(0).max(1).describe('Inclusive remaining-HP fraction. First phase is 1; thresholds strictly descend.'),
  movement: MovementSchema,
  attacks: z.array(AttackSchema).min(1).max(8),
  minions: z.strictObject({
    kind: z.enum(['orbiter', 'kamikaze', 'turret', 'splitter']),
    count: z.number().int().min(1).max(12),
    every: z.number().min(1).max(60).describe('Seconds between summons; minion live cap is enforced by the engine.'),
  }).optional(),
  modifiers: z.array(ModifierSchema).max(4).optional(),
  weakPoint: z.enum(['back', 'coreOpenAfterLaser', 'minionsFirst']).optional(),
});

// JSON-representable structure. Cross-phase ordering is checked by BossSchema below.
export const BossStructureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  meta: z.strictObject({
    name: z.string().min(1).max(24),
    creator: z.string().regex(/^[a-z0-9_]{1,25}$/).describe('Lowercase Twitch login.'),
    sourceQuote: z.string().min(1).max(1000),
    reading: z.array(z.string().min(1).max(100)).length(3),
  }),
  look: z.strictObject({
    shape: z.enum(['eye', 'skull', 'crystal', 'blob', 'mech', 'serpent']),
    palette: z.array(color).min(2).max(5),
    size: z.number().min(16).max(120).describe('Boss radius in arena pixels.'),
    aura: z.enum(['flame', 'glitch', 'void', 'sparkle']),
  }),
  taunts: z.strictObject({ intro: shortText, phaseChange: shortText, onPlayerHit: shortText, onDeath: shortText }),
  hp: z.number().int().min(1).max(100000),
  phases: z.array(PhaseSchema).min(1).max(5),
});

export const BossSchema = BossStructureSchema.superRefine((boss, ctx) => {
  boss.phases.forEach((phase, index) => {
    const previous = boss.phases[index - 1];
    if ((index === 0 && phase.hpBelow !== 1) || (previous && phase.hpBelow >= previous.hpBelow)) {
      ctx.addIssue({ code: 'custom', path: ['phases', index, 'hpBelow'], message: 'Start at 1 and use strictly descending HP thresholds.' });
    }
  });
});

export type BossSpec = z.infer<typeof BossSchema>;
export type Attack = z.infer<typeof AttackSchema>;
export type Movement = z.infer<typeof MovementSchema>;

export function bossJsonSchema() {
  return {
    ...z.toJSONSchema(BossStructureSchema, { target: 'draft-2020-12' }),
    title: 'Boss Forge BossSpec v1',
    description: 'Structural contract only. Also run BossSchema.parse for phase ordering, then the independent fairness gate before execution.',
  };
}

/** Draft choreography contract; no script execution is implemented in M0.
 * Coordinates are arena pixels; time uses simulation milliseconds, angles use degrees.
 * moveTo schedules movement; wait advances choreography without blocking the sim.
 * rand returns a seeded value in [0, 1). Methods must validate payloads at runtime.
 */
export interface BossAPI {
  emit(attack: Attack): void;
  moveTo(x: number, y: number, durationMs: number): void;
  wait(durationMs: number): Promise<void>;
  say(text: string): void;
  telegraph(x: number, y: number, radius: number, durationMs: number): void;
  rand(): number;
}

export type BossScript = (api: BossAPI) => Promise<void>;
