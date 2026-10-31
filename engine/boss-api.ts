import { z } from 'zod';

import { ARENA, MAX_LIVE_BULLETS } from './constants';
export { ARENA, TICK_RATE, MAX_LIVE_BULLETS, MIN_TELEGRAPH_MS } from './constants';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Opaque RGB hex color.');
const shortText = z.string().min(1).max(40);

export const MovementSchema = z.strictObject({
  kind: z.enum(['hover', 'figure8', 'orbitCenter', 'teleport', 'charge', 'followPlayer', 'mirrorPlayer']),
  speed: z.number().min(0).max(1000).describe('Arena pixels per second.'),
  telegraphMs: z.number().int().min(0).max(5000).describe('Warning before a charge or teleport; gate checks charge minimum.'),
});

export const BulletAttackSchema = z.strictObject({
  emitter: z.enum(['spiral', 'ring', 'aimed', 'fan', 'wave', 'rain', 'homing', 'mine', 'wallWithGap']),
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

export const LaserAttackSchema = z.strictObject({
  emitter: z.literal('laser'),
  params: z.strictObject({
    width: z.number().min(4).max(100).describe('Beam width in pixels.'),
    length: z.number().min(40).max(1600).describe('Beam length in pixels.'),
    durationMs: z.number().int().min(50).max(3000).describe('Active beam time after the warning.'),
    aim: z.enum(['player', 'fixed']),
    angle: z.number().min(-360).max(360).describe('Fixed heading in degrees; 90 points down. Player aim locks at warning start.'),
    sweep: z.number().min(-180).max(180).describe('Degrees swept during active time; the warning shows the full sector.'),
    interval: z.number().min(0.5).max(30),
    telegraphMs: z.number().int().min(0).max(5000),
    color,
  }),
});

export const AttackSchema = z.discriminatedUnion('emitter', [BulletAttackSchema, LaserAttackSchema]);

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
    hp: z.number().int().min(1).max(1000),
    every: z.number().min(1).max(60).describe('Seconds between summons; minion live cap is enforced by the engine.'),
  }).optional(),
  modifiers: z.array(ModifierSchema).max(4).optional(),
  weakPoint: z.enum(['back', 'coreOpenAfterLaser', 'minionsFirst']).optional(),
});

export const BossCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('emit'), attack: AttackSchema }),
  z.strictObject({ kind: z.literal('moveTo'), x: z.number().min(0).max(ARENA.width), y: z.number().min(0).max(ARENA.height), durationMs: z.number().int().min(0).max(30000) }),
  z.strictObject({ kind: z.literal('wait'), durationMs: z.number().int().min(0).max(30000) }),
  z.strictObject({ kind: z.literal('say'), text: shortText }),
  z.strictObject({ kind: z.literal('telegraph'), x: z.number().min(0).max(ARENA.width), y: z.number().min(0).max(ARENA.height), radius: z.number().min(1).max(ARENA.width), durationMs: z.number().int().min(1).max(5000) }),
]);
export type BossCommand = z.infer<typeof BossCommandSchema>;
export const ScriptTapeSchema = z.strictObject({
  version: z.literal(1), seed: z.literal(1337), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  frames: z.array(z.strictObject({ tick: z.number().int().min(1).max(7200), command: BossCommandSchema })).max(512),
}).superRefine((tape, ctx) => {
  let previous = 0, count = 0;
  for (const frame of tape.frames) {
    count = frame.tick === previous ? count + 1 : 1;
    if (frame.tick < previous || count > 16) ctx.addIssue({ code: 'custom', message: 'Script frames must be ordered with at most 16 commands per tick.' });
    previous = frame.tick;
  }
  if (JSON.stringify(tape).length > 65536) ctx.addIssue({ code: 'custom', message: 'Compiled choreography exceeds 64 KiB.' });
});
export type ScriptTape = z.infer<typeof ScriptTapeSchema>;

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
    size: z.number().min(16).max(120).describe(`Boss radius in the ${ARENA.width} by ${ARENA.height} pixel arena.`),
    aura: z.enum(['flame', 'glitch', 'void', 'sparkle']),
  }),
  taunts: z.strictObject({ intro: shortText, phaseChange: shortText, onPlayerHit: shortText, onDeath: shortText }),
  hp: z.number().int().min(1).max(100000),
  phases: z.array(PhaseSchema).min(1).max(5),
  choreography: ScriptTapeSchema.optional().describe('Server-compiled commands from isolated boss.ts. Author boss.ts, never this field.'),
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

export function commandJsonSchema() {
  return { ...z.toJSONSchema(BossCommandSchema, { target: 'draft-2020-12' }), title: 'Boss Forge yielded command v1' };
}

/** Command factories only: function* script(api) yields commands to the sim.
 * wait yields simulation time; rand reads a seeded RNG. No Promise or wall clock.
 * M5 supplies isolation for untrusted generators, including a timeout around next().
 */
export interface BossAPI {
  emit(attack: Attack): Extract<BossCommand, { kind: 'emit' }>;
  moveTo(x: number, y: number, durationMs: number): Extract<BossCommand, { kind: 'moveTo' }>;
  wait(durationMs: number): Extract<BossCommand, { kind: 'wait' }>;
  say(text: string): Extract<BossCommand, { kind: 'say' }>;
  telegraph(x: number, y: number, radius: number, durationMs: number): Extract<BossCommand, { kind: 'telegraph' }>;
  rand(): number;
}

export type BossScript = (api: BossAPI) => Generator<BossCommand, void, unknown>;
