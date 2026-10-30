# Fairness gate, M2

The authoritative entry point is `server/gate/runner.ts: runGate(spec)`. It parses the actual spec and runs fresh evaluations. It accepts no configurable seeds, weakened limits, bot skill, difficulty, clock, or prior pass report. The file wrapper also rejects neighboring `boss.ts`; scripts are not silently ignored or certified.

## Versioned policy

`engine/fairness-policy.ts` fixes policy `m2-v1`, bot `potential-field-v1`, difficulty 1, and seeds **17, 101, 509, 1337, 9001**. All normal runs have the same three hearts, movement, input interface, autofire, and collision rules as the browser game. Each seed initializes both the game RNG and a separate bot state. The bot never changes the game's RNG or gains invulnerability in normal fights.

Changing engine behavior, bot behavior, geometry, or limits requires a new policy/bot version and fresh reports. The SHA-256 fingerprints the normalized Zod-parsed boss spec. A fingerprint is for identifying content, not authenticating a report. The future server must rerun the gate; an agent's saved report is never authority.

## Reference dodger

The bot recomputes its steering every six ticks (100 ms). It combines an anchored positioning field, seeded lateral drift, arena-boundary repulsion, projected bullet closest approaches over 0.5 seconds, visible laser/charge/teleport warnings, and contact avoidance for bosses/minions. It uses bounded legal analog input and ordinary autofire. It does not read future RNG, remove hazards, alter damage, deliberately lose a selected seed, or use a separate bot profile per boss.

The bot is intentionally imperfect: it predicts bullets linearly and reacts to a sweeping beam's current heading, not a perfect future escape path. Passing is a bounded heuristic for this player model, not a mathematical proof that any human can win.

## What must pass

| Check | Definition |
| --- | --- |
| Schema | Strict BossSpec v1, including descending phase thresholds |
| Telegraphs | Every phase's laser and charge warning is at least 350 ms, even if unreached |
| Aimed speed | Aimed, fan, homing, and minion targeted bullets stay <=300 px/s at standard difficulty; static bounds include positive acceleration over bullet lifetime and speedUp |
| Bullet cap | No more than 400 live bullets, and no requested spawns dropped by the hard cap |
| Safe space | At least 25% wholly safe cells in every rolling 30-combat-tick window, across all ten evaluations |
| TTK | All five damage probes kill within 120 seconds; their median is 45–120 seconds; the probes cover every phase |
| Beatable | At least two of five normal runs win |
| Interesting | At least one normal run dies; surviving until timeout is not counted as a loss |
| Exceptions | Zero thrown exceptions or non-finite simulation state |
| Tick budget | Every measured `stepGame` call that advances combat fits within 1000/60 ms |

The normal win range is therefore 2–4/5. Normal runs and damage probes are independently bounded at 120 combat seconds plus intro/hit-stop input steps. A timeout is explicitly reported; no unobserved kill is extrapolated.

## Rolling safe-space geometry

The 960x720 arena is divided into **24x18 cells, each 40x40 pixels**. A cell is safe only if its entire area stays untouched throughout the last 30 combat ticks. The metric is the union of occupied cells, not an average of snapshots and not a once-per-half-second sample. Every possible rolling window is considered after the first 30 ticks; the report records the worst seed, probe flag, ending tick, and safe-cell count.

Danger covers swept bullet segments expanded by bullet radius plus the player's 4 px radius, active finite laser beams and swept sectors, boss/minion contact, and cells not wholly inside the current movement bounds. Warnings and unarmed mines are not damaging yet. A teleported boss marks its landing, not an imaginary contact path across the arena. Swept traces are retained for bullets removed by a collision or arena exit during the current step.

Segment/cell tests conservatively expand axis-aligned cell bounds. Sweeping laser coverage samples rays no more than 20 pixels apart at the beam tip and adds padding for the intervening arc. This can mark a near-miss cell unsafe; it does not count a partially clear cell as wholly safe. The denominator is always the full 432-cell arena, so shrinkArena cannot manufacture a favorable percentage by shrinking the denominator.

Safe space is geometric, not necessarily a connected or reachable escape route. The separate normal bot fights provide a practical check against configurations with plentiful but inaccessible space. Neither measure proves fairness for every possible seed or input sequence.

## Damage probes and clocks

Five additional evaluations use the same bot, seeds, aiming, movement, minion HP, and boss damage rules, with player invulnerability explicitly enabled **only in probes**. This lets the runner observe the complete fight even when the normal bot dies early. A probe still has to hit and kill the boss; shield/weak-point/minion rules are not bypassed. Early normal deaths cannot conceal unfair late phases, and low observed damage cannot be reported as a guessed TTK.

`combatSeconds` excludes the intro and hit-stop, matching the game HUD. `inputSteps` includes them. Gameplay metrics, per-run final state hashes, and non-timing checks replay identically in the same JavaScript runtime. Cross-runtime floating-point bit identity is not promised.

Timing uses Node's `performance.now()` around the **simulation step only**. Bot decisions, grid measurement, validation, hashing, and report serialization are outside that sample. The report records maximum, p99, sample count, and over-budget count; even one over-budget sample rejects the gate. No slow sample is discarded and there is no automatic retry-until-pass. OS scheduling, GC, runtime warm-up, and host load can change timing and the final pass decision while leaving gameplay metrics identical. This is a local measured check, not a browser FPS claim or an isolation timeout.

## CLI and artifacts

```sh
npm run gate -- ember-anvil
npm run gate -- viewer_request_123
npm run gate -- path/to/boss.json
npm run gate -- --all
npm run gate -- tests/fixtures/unfair-boss.json  # must exit 1
```

Plain IDs are resolved under `forge/<id>/boss.json`, then `bosses/house/<id>.json`. Explicit `.json` paths are for trusted local CLI use, not server route parameters. Inputs over 128 KiB and malformed JSON are rejected with structured reports. No imported/generated script is executed.

The CLI writes JSON to stdout, summaries/paths to stderr, and a report per target to ignored `.artifacts/gates/`. Runtime IDs also receive `forge/<id>/gate-report.json`. `--all` emits a JSON array. Exit 0 requires every requested target to pass; any rejection, missing file, unsupported script, or output error returns 1. Use `npm --silent run gate -- <id>` for machine-readable stdout; use `npm.cmd` in PowerShell when the `.ps1` wrapper consumes flag separators.

The GateReport Zod schema is in `engine/gate-report.ts`; regenerate its JSON Schema with `npm run schema:export`. Reports include all individual outcomes and static failure paths for the future forge revision loop. M3 will run this synchronous CPU work inside a server worker boundary, then send the report to the queue/ticker. Live overlay cards arrive in M4; M2's play page does not claim a fresh, current-policy certificate.

## House balance and regression coverage

All house specs are balanced against the same fixed bot and policy. Ember Anvil has denser second-phase spirals and more HP; Neon Brood has faster/wider fans and waves; Prism Warden has gently sweeping, explicitly warned beams. Shared autofire leads observed target motion, fixing the formerly unkillable fast-orbiter pattern for the streamer as well as the bot. Fast sweeping lasers use sector collision so they cannot tunnel between tick positions.

The suite covers repeatable hashes/metrics, all three house bosses, a deliberately unfair schema-valid boss, dense but dodgeable patterns, hidden overflow at the engine cap, static checks in unreachable phases, acceleration/boost speed bounds, the exact 350 ms boundary, safe-space unions and sweeps, timeouts, thrown simulation errors, measured budget rejection, forged neighboring reports, script refusal, and CLI JSON/exit behavior.
