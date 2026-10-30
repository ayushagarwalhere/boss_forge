import { describe, expect, it } from 'vitest';
import { commandAPI, CommandStepper } from '../engine/choreography';
import { commandJsonSchema, type BossAPI, type BossScript } from '../engine/boss-api';
import { random } from '../engine/random';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

describe('generator choreography draft', () => {
  it('uses simulation ticks for waits and accepts only a fixed command budget', () => {
    const script: BossScript = function* (api) {
      yield api.say('Incoming.');
      yield api.wait(50);
      yield api.moveTo(480, 180, 1000);
      yield api.telegraph(480, 180, 30, 500);
    };
    const runner = new CommandStepper(script(commandAPI(() => 0)), 2);
    expect(runner.tick().map((command) => command.kind)).toEqual(['say', 'wait']);
    expect(runner.tick()).toEqual([]);
    expect(runner.tick()).toEqual([]);
    expect(runner.tick().map((command) => command.kind)).toEqual(['moveTo', 'telegraph']);
    expect(runner.tick()).toEqual([]);
  });

  it('defers an endless sequence of yields across ticks', () => {
    function* repeating(api: BossAPI) { while (true) yield api.say('More.'); }
    const runner = new CommandStepper(repeating(commandAPI(() => 0)), 3);
    expect(runner.tick()).toHaveLength(3);
    expect(runner.tick()).toHaveLength(3);
  });

  it('makes zero waits yield until the following tick', () => {
    function* script(api: BossAPI) { yield api.wait(0); yield api.say('Next tick.'); }
    const runner = new CommandStepper(script(commandAPI(() => 0)));
    expect(runner.tick()).toEqual([{ kind: 'wait', durationMs: 0 }]);
    expect(runner.tick()).toEqual([{ kind: 'say', text: 'Next tick.' }]);
  });

  it('validates emitted commands before returning them to a consumer', () => {
    function* script(api: BossAPI) { yield api.moveTo(-10, 20, 30); }
    expect(() => new CommandStepper(script(commandAPI(() => 0))).tick()).toThrow();
    expect(() => new CommandStepper(script(commandAPI(() => 0)), 0)).toThrow();
  });

  it('produces replayable random choices without Promises', () => {
    function run() {
      const state = { rng: 12 };
      function* script(api: BossAPI) { yield api.moveTo(api.rand() * 900, 180, 500); yield api.say('Done.'); }
      return new CommandStepper(script(commandAPI(() => random(state)))).tick();
    }
    expect(run()).toEqual(run());
  });

  it('exports the yielded-command contract without schema drift', async () => {
    const exported: unknown = JSON.parse(await readFile(new URL('../engine/boss-command.schema.json', import.meta.url), 'utf8'));
    expect(exported).toEqual(commandJsonSchema());
    const validate = new Ajv2020({ strict: true }).compile(commandJsonSchema());
    expect(validate({ kind: 'wait', durationMs: 500 })).toBe(true);
    expect(validate({ kind: 'moveTo', x: 10000, y: 120, durationMs: 10 })).toBe(false);
    expect(validate({ kind: 'say', text: 'Okay', extra: true })).toBe(false);
  });
});
