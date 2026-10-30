# Boss Forge

**Chat designs the boss, Codex builds it, the streamer fights it.**

A Codex x TwitchCon hackathon project by [ayushagarwalhere](https://github.com/ayushagarwalhere). Viewers will describe bullet-hell bosses; the runtime forge will write code, check fairness, and queue a fight for the streamer.

## Current milestone: M1

Three playable house bosses, a shared deterministic 60 Hz simulation, a procedural canvas renderer, keyboard/gamepad controls, and contract/replay tests. Includes autofire, three hearts, i-frames, focus hitbox, hit-stop, particles, screen shake, phase pips, difficulty settings, and seeded retries.

The fairness gate, live forge, Twitch integration, WebAudio, untrusted script execution, and no-account forge demo are still pending. House bosses are **not fairness-verified**. The OBS overlay is a transparent scaffold until M4.

## Run locally

Use Node 20.19+, 22.13+, or 24+ (latest Node 22 recommended; `.nvmrc` supplied) and npm.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173/play/**. Choose a house boss and click **Enter arena**. No account, tokens, network APIs, or credentials are needed to play. Vite prints the actual port if 5173 is occupied.

| Control | Action |
| --- | --- |
| WASD / arrows | Move; diagonal movement is normalized |
| Shift | Focus: slower movement and visible 4 px hitbox |
| P / Escape | Pause / resume |
| R / Reset | Return to the selected boss intro with the same seed |
| Gamepad left stick / D-pad | Move |
| Gamepad south button / left trigger | Focus |

Autofire aims at minions first, then the boss. Losing keyboard/window focus pauses the fight. A retry uses the same seed and difficulty. Changing boss, seed, or difficulty resets the round. The same seed **and the same per-tick inputs** reproduce the fight; aimed patterns respond to where you move. Select Relaxed (75%), Standard (100%), or Intense (125%) for projectile/movement speed and attack cadence. Settings last for the current page session.

The game page accepts input and can be captured in OBS. `/overlay/` is a separate 1920x1080 transparent browser source; OBS browser sources do not receive game input.

## Checks

```sh
npm run check            # lint, app + DOM-free engine types, tests, house specs
npm run build            # production pages in dist/web
npm run schema:export    # regenerate both JSON Schemas
npm run bosses:validate  # schema validation only; not a fairness claim
```

Validate a custom spec: `npm run bosses:validate -- path/to/boss.json` (nonzero exit on invalid JSON/schema). CI runs checks/build/schema drift checks on Node 20 and 22. Replay tests compare state hashes across seeded input sequences and JSON save/restore, alongside collision, telegraph, phase, minion, cap, and command scheduler tests.

## Layout

| Path | Responsibility |
| --- | --- |
| `engine/constants.ts` | Shared 960x720 arena, tick rate, player constants, caps |
| `engine/boss-api.ts` | Zod boss/command schemas and TypeScript API |
| `engine/simulation.ts` | Fixed-step movement, attacks, collision, HP, phases, outcomes |
| `engine/random.ts` | Explicit serializable seeded RNG |
| `engine/choreography.ts` | Trusted generator command factories and tick scheduler draft |
| `web/play/` | Streamer play page, renderer, effects, input, house-spec imports |
| `web/overlay/` | Transparent OBS scaffold |
| `bosses/house/` | Ember Anvil (heavy), Neon Brood (swarm), Prism Warden (sniper) |
| `server/`, `forge/` | Future server and ignored per-boss runtime workspaces |

All boss shapes, bullet art, and effects are drawn procedurally. No downloaded assets, third-party fonts, game IP, or audio are included. MIT licensed; see [LICENSE](LICENSE).

## Simulation and BossAPI v1

`engine/boss-api.ts` is authoritative. Strict objects reject unknown fields. Positions use arena pixels; intervals/summon cadence use seconds; warnings/modifiers use milliseconds; angles use degrees (90 points down). Start phases at `hpBelow: 1`, then strictly descend; the last matching threshold applies inclusively and replaces the previous phase. Old pending warnings/lasers are canceled on phase changes; existing bullets and minions persist.

Bullet emitters use count, speed, acceleration, spin, gap, interval, warning, shape, color, and bounce. Lasers have their own width, length, active duration, aim mode, fixed angle, sweep, interval, warning, and color. Laser origin/heading lock when the warning begins; a sweeping warning displays the entire swept sector. Minions have explicit HP and a 12-entity live cap; enemy bullets cap at 400, pending volleys at 32, and lasers at 16. Excess spawns are dropped. Bullets expire after ten combat seconds.

The engine implements all schema movement/emitter/minion kinds. Phase modifiers activate once at phase entry for their declared duration. Darkness is a visual visibility mask; shrinkArena clamps movement bounds. Shields reduce damage; minionsFirst blocks boss damage while minions survive; coreOpenAfterLaser grants full damage for two seconds after a beam (half damage while closed); back reduces frontal damage to a quarter. These rules are tunable before M2 balance verification.

`createGame(spec, seed, difficulty)` validates and owns a copy of the spec. `stepGame(state, input)` mutates one fixed input step; `stateHash(state)` hashes serializable state, including RNG and pending attacks. Intro and hit-stop consume input steps while holding the combat clock. Browser wall-clock time only feeds an accumulator; pausing/hidden tabs clear the accumulator and keys. Headless callers supply the same input sequence directly. Replay equality targets the same JavaScript runtime; cross-runtime floating-point bit identity is not promised.

Both JSON Schemas are generated: `engine/boss.schema.json` and `engine/boss-command.schema.json`. Structural schema validity must be followed by the Zod phase-order check, then M2's independent fairness gate before a runtime boss can run.

### Generator choreography draft

```ts
import type { BossScript } from './engine/boss-api';

export const script: BossScript = function* (api) {
  yield api.say('Eyes up.');
  yield api.telegraph(480, 180, 40, 500);
  yield api.wait(500);
  yield api.moveTo(240, 180, 1000);
  yield api.wait(1000);
};
```

`api.emit`, `moveTo`, `wait`, `say`, and `telegraph` return commands for `yield`; `api.rand()` reads seeded randomness. No Promises or wall clocks are used. A trusted `CommandStepper` validates and yields at most 16 commands per tick by default. `wait` rounds up to whole sim ticks, with zero waiting until the next tick. `moveTo` schedules movement and does not itself wait. The import above is a host-side type illustration; future generated boss scripts may not import anything.

This scheduler is a contract draft, **not an untrusted-code sandbox**: a generator can loop forever inside `.next()`. M1 never loads or executes `boss.ts`; M5 must add the isolated executor, static checks, per-tick timeout, and command application before generated scripts are enabled. The shipped game runs only declarative specs.

## Milestones

- [x] M0: setup + schema + three house specs
- [x] M1: deterministic engine and playable canvas game
- [ ] M2: reference dodger, metrics, independent fairness gate
- [ ] M3: real Codex forge, streamed events, queue, no-account demo
- [ ] M4: Twitch auth/EventSub/Helix and OBS overlay
- [ ] M5: sound/polish, moderation, isolated script execution, submission material

Integration verification notes are in [docs/integrations.md](docs/integrations.md). Future server credentials belong in `.env.local`, based on `.env.example`; never commit tokens or put them in `VITE_` variables.
