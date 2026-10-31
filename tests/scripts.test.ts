import { describe, expect, it, beforeAll } from 'vitest';
import { buildScriptRuntime } from '../server/scripts/bundle';
import { compileIsolated } from '../server/scripts/isolate';
import { checkScript } from '../server/scripts/static-check';
import { createGame, stateHash, stepGame } from '../engine/simulation';
import { runGate } from '../server/gate/runner';
import { replay } from './forge-helpers';

let runtime: string;
beforeAll(async () => { runtime = await buildScriptRuntime(); }, 30000);
const compile = (source: string) => compileIsolated(source, runtime);
describe('isolated generator compilation', () => {
  it('compiles seeded generators deterministically and enforces the 16-command tick budget', async () => {
    const source = 'export function* script(api) { for(let i=0;i<17;i++){yield api.say("Ready");} yield api.wait(17); yield api.telegraph(api.rand()*900,100,20,500); }';
    const first = await compile(source), second = await compile(source);
    expect(first).toEqual(second); expect(first.frames[15]?.tick).toBe(1); expect(first.frames[16]?.tick).toBe(2);
    expect(first.frames.at(-1)?.tick).toBe(4); expect(first.frames.at(-1)?.command.kind).toBe('telegraph');
  });
  it.each([
    'import x from "node:fs"; export function* script(api) {}',
    'export async function* script(api) { yield api.wait(1); }',
    'export function* script(api) { yield api.say(process.env.SECRET); }',
    'export function* script(api) { yield api.wait(Date.now()); }',
    'export function* script(api) { yield api.wait(Math.random()); }',
    'export function* script(api) { api.say.constructor("return process")(); }',
    'export function* script(api) { api["say"]("x"); }',
  ])('rejects forbidden source without running it: %s', (source) => { expect(() => checkScript(source)).toThrow(); });
  it('interrupts non-yielding loops, memory growth, and invalid or excessive commands', async () => {
    for (const source of [
      'export function* script(api) { while(true){} }',
      'export function* script(api) { let x="aaaaaaaa"; while(true){x=x+x;} }',
      'export function* script(api) { yield api.moveTo(999999,0,100); }',
      'export function* script(api) { for(let i=0;i<600;i++){yield api.say("loop");} }',
    ]) await expect(compile(source)).rejects.toThrow();
  });
  it('applies all commands on simulation ticks, warns before movement, and survives JSON save/restore', async () => {
    const spec = structuredClone(replay.spec);
    spec.choreography = await compile('export function* script(api) { yield api.say("Eyes up"); yield api.telegraph(200,200,30,500); yield api.moveTo(200,200,1000); yield api.wait(1000); yield api.say("Again"); }');
    const game = createGame(spec, 17); game.introTicks = 1; stepGame(game, {x:0,y:0}); stepGame(game, {x:0,y:0});
    expect(game.events.some((event) => event.kind === 'taunt' && event.text === 'Eyes up')).toBe(true);
    expect(game.script?.telegraphs).toHaveLength(1); expect(game.boss.motion!.fireTick-game.tick).toBe(21);
    const start = game.boss.x; for(let i=0;i<20;i++) stepGame(game,{x:0,y:0}); expect(game.boss.x).toBe(start);
    const restored = JSON.parse(JSON.stringify(game));
    for(let i=0;i<120;i++){stepGame(game,{x:0,y:0});stepGame(restored,{x:0,y:0});}
    expect(stateHash(game)).toBe(stateHash(restored)); expect(game.script?.cursor).toBe(spec.choreography.frames.length);
  });
  it('gates scripted attacks, including unreached lasers and targeted speeds, instead of trusting a tape hash', async () => {
    const spec = structuredClone(replay.spec), attack = structuredClone(spec.phases[0]!.attacks[0]!);
    if(attack.emitter === 'laser') throw new Error('Expected bullet fixture');
    attack.emitter = 'aimed'; attack.params.speed = 600;
    spec.choreography = await compile(`export function* script(api) { yield api.emit(${JSON.stringify(attack)}); }`);
    const report = runGate(spec); expect(report.passed).toBe(false); expect(report.checks.find((check)=>check.id==='aimedSpeed')?.passed).toBe(false);
  });
});
