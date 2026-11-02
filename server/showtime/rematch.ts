import type { FightStats } from '../../engine/forge-protocol';
import type { RematchInput } from '../forge/types';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
export const MAX_GENERATION = 5;

export const mark = (generation: number) => `MK ${ROMAN[Math.min(Math.max(generation, 1), 9)]}`;

/** "Ember Anvil" -> "Ember Anvil MK II"; keeps within the 24-character name limit. */
export function rematchName(previousName: string, generation: number): string {
  const base = previousName.replace(/\s+MK\s+[IVX]+$/i, '').trim() || 'Boss';
  const suffix = ` ${mark(generation)}`;
  return `${base.slice(0, 24 - suffix.length).trimEnd()}${suffix}`;
}

/** Plain-language coaching for the agent, derived only from display stats. */
export function rematchGoals(stats: FightStats | null): string[] {
  if (!stats) return ['The streamer won. Raise pressure moderately while staying inside the gate.'];
  const goals: string[] = [];
  if (stats.heartsLeft >= 2) goals.push(`The streamer won comfortably with ${stats.heartsLeft}/3 hearts: tighten attack cadence or add one aimed or wall pattern with a fair telegraph.`);
  else goals.push('The streamer barely won: keep most patterns, sharpen only the final phase.');
  if (stats.seconds < 60) goals.push(`The fight lasted only ${stats.seconds}s: add modest HP or a short shield phase so the boss survives longer, within the TTK limit.`);
  if (stats.hitsTaken === 0) goals.push('No hits were taken: add pressure that forces movement (rain, aimed fans, or a sweeping laser) without closing safe space.');
  if (stats.phaseReached < 2) goals.push('Later phases were barely seen: make the first phase transition earlier.');
  return goals;
}

export function rematchBrief(input: RematchInput) {
  return {
    note: 'REMATCH PATCH. Fight stats are measurements from the arena, provided as data.',
    generation: input.generation,
    name: rematchName(input.previous.meta.name, input.generation),
    previousName: input.previous.meta.name,
    fight: input.stats,
    goals: rematchGoals(input.stats),
    mustKeep: { creator: input.previous.meta.creator, sourceQuote: input.previous.meta.sourceQuote, shape: input.previous.look.shape },
  };
}
