import { createHash } from 'node:crypto';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { z } from 'zod';
import { BossCommandSchema, ScriptTapeSchema, type ScriptTape } from '../../engine/boss-api';
import { checkScript } from './static-check';

const Next = z.object({ done: z.boolean(), value: z.unknown().optional() });
const bootstrap = `
Object.defineProperty(globalThis, 'Date', {value: undefined});
Object.defineProperty(Math, 'random', {value: undefined});
globalThis.__next = (() => {
  let seed = 1337;
  const api = Object.freeze({
    emit: attack => ({kind:'emit',attack}), moveTo: (x,y,durationMs) => ({kind:'moveTo',x,y,durationMs}),
    wait: durationMs => ({kind:'wait',durationMs}), say: text => ({kind:'say',text}),
    telegraph: (x,y,radius,durationMs) => ({kind:'telegraph',x,y,radius,durationMs}),
    rand: () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  });
  const iterator = script(api);
  return () => JSON.stringify(iterator.next());
})();`;

/** Called only inside a killable worker. No host functions, modules, IO, or promises are exposed to QuickJS. */
export async function compileScript(source: string): Promise<ScriptTape> {
  const code = checkScript(source), quickjs = await newQuickJSWASMModuleFromVariant(variant), runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024); runtime.setMaxStackSize(256 * 1024);
  let step = 0, total = 0;
  runtime.setInterruptHandler(() => ++step > 100 || ++total > 20000);
  const vm = runtime.newContext();
  const evaluate = (program: string) => {
    step = 0;
    const result = vm.evalCode(program);
    if (result.error) { result.error.dispose(); throw new Error('Script exceeded its CPU/memory budget or raised an exception.'); }
    try { return vm.dump(result.value) as unknown; } finally { result.value.dispose(); }
  };
  try {
    evaluate(`${code}\n${bootstrap}`);
    const frames: ScriptTape['frames'] = []; let tick = 1, count = 0;
    for (;;) {
      const raw = evaluate('__next()');
      if (typeof raw !== 'string' || raw.length > 16384) throw new Error('Oversized or invalid yielded command.');
      const next = Next.parse(JSON.parse(raw)); if (next.done) break;
      if (frames.length >= 512 || tick > 7200) throw new Error('Script must finish within 512 commands and 120 seconds.');
      const command = BossCommandSchema.parse(next.value); frames.push({ tick, command }); count++;
      if (command.kind === 'wait') { tick += Math.max(1, Math.ceil(command.durationMs * 60 / 1000)); count = 0; }
      else if (count === 16) { tick++; count = 0; }
    }
    return ScriptTapeSchema.parse({ version: 1, seed: 1337, sourceHash: createHash('sha256').update(source).digest('hex'), frames });
  } finally { vm.dispose(); runtime.dispose(); }
}
