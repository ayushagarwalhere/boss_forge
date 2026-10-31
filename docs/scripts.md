# Isolated generator choreography (M5)

Boss JSON remains the primary format. An optional sibling `boss.ts` adds a **finite, deterministic command generator**. In a runtime workspace the files are `boss.json` and `boss.ts`; the local CLI also accepts named pairs such as `example.json` and `example.ts`.

```js
export function* script(api) {
  yield api.say('Eyes up.');
  yield api.telegraph(240, 180, 50, 500);
  yield api.wait(500);
  yield api.moveTo(240, 180, 1000);
  yield api.wait(1500);
  yield api.say('Your turn.');
}
```

Use plain JavaScript syntax in the `.ts` file. The static checker permits one exported generator named `script(api)`, local variables, literals, finite loops, conditionals, command factories and deterministic Math members. It rejects imports, async/Promise, constructors, computed access, nested functions, prototype access, host APIs, Date and Math.random. Invalid syntax is rejected; the checker never evaluates source. See `server/scripts/static-check.ts` for the exact allowlist. This deliberately supports a small language, not arbitrary TypeScript.

Commands are `emit(attack)`, `moveTo(x,y,durationMs)`, `wait(durationMs)`, `say(text)` and `telegraph(x,y,radius,durationMs)`. `emit` schedules one volley using the same warning, cap and aiming rules as phase attacks; it does not install a recurring emitter. Phase attacks continue. `wait` rounds upward to 60 Hz, with zero waiting until the next tick. `moveTo` automatically warns for 350 ms, then moves over its requested duration (at least one tick); targets clamp to boss-radius arena bounds. It overrides normal movement until complete and cancels at phase change. Additional same-tick moves replace the previous move. `telegraph` is a visual circle, not damage. `say` produces a brief game taunt. `api.rand()` uses a separate fixed Mulberry32 seed, **1337**, at compilation; movement and aiming still respond to each fight's game seed and player position through the engine.

## Isolation and limits

1. Server file loading rejects symlinks, hardlinks, oversized files, changes to the opened file's identity, and hand-authored `choreography` JSON. It preserves creator/sourceQuote against the accepted request.
2. A dedicated Node worker loads a **QuickJS WebAssembly interpreter** (quickjs-emscripten-core and the embedded single-file release variant, version 0.32.0). User source never runs as Node/host JavaScript, and no host functions or module loader are installed in the guest. No filesystem, network, environment, wall-clock or browser objects are passed across the boundary.
3. The guest heap is capped at **8 MiB**, stack at **256 KiB**, with at most **100 interrupt polls per evaluation** and **20,000 total**. These are instruction-poll budgets, not claimed milliseconds. Node's trusted compiler worker has a 256 MiB old-generation cap and a **10-second termination deadline**; inherited loader arguments and environment variables are cleared. Guest limits stay separate from the compiler/parser's host memory needs.
4. Every yielded value passes `BossCommandSchema`. The complete generator must finish within **512 commands**, at most **16 per combat tick**, with commands scheduled by tick **7200**. The serialized tape is capped at **64 KiB**. Infinite loops, runaway allocation, invalid commands and partial output fail closed.
5. Only the validated immutable command tape crosses into the shared engine and browser. Its source SHA-256, fixed compilation seed, version, frame ticks and commands are included in `specHash`. A source change requires recompilation and a fresh gate, even if the generator says it passed. The server uses its original trusted worker, never an agent-supplied worker or cached tape/report.

The five fixed dodger runs and five damage probes simulate **the actual compiled commands plus the JSON spec**, including scripted lasers, aimed speed, motion, swept hazards, overflow, errors and measured simulation ticks. Policy `m5-v1` preserves every fairness threshold and seed from `m2-v2`; it versions script execution and cap-accounting semantics. The bot remains `potential-field-v1`. The execution limit for compiling untrusted source and the 16.667 ms simulation tick budget are separate checks.

The runtime Codex profile still denies outside reads and tool networking. The copied compiler worker and command schema are read-only to the agent. The host-side `CommandStepper` remains for trusted tests/examples and is never used to run viewer/agent JavaScript. QuickJS is a software isolation boundary, not a claim that a general-purpose Node worker is an OS sandbox or that all JavaScript engine vulnerabilities are impossible.

Run `npm run gate -- bosses/examples/scripted/boss.json` for the included safe scripted example. Its script supplies original taunts and visual warnings over an existing house attack spec; it is a local example, not a live Codex result. Source stays server-side.
