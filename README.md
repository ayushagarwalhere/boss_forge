# Boss Forge

**Chat designs the boss, Codex builds it, the streamer fights it.**

A Codex x TwitchCon hackathon project by [ayushagarwalhere](https://github.com/ayushagarwalhere). Viewers describe bullet-hell bosses; the planned runtime forge writes code, checks fairness, and queues a fight for the streamer.

## Current milestone: M0

Repository skeleton, a typed Zod BossAPI contract, JSON Schema export, three contrasting house boss specs, validation, linting, and tests. The pages are scaffolds. Gameplay, fairness verification, the forge, Twitch, sound, and demo mode are not implemented yet. House bosses are **not fairness-verified**.

## Run locally

Use Node 20.19+, 22.13+, or 24+ (latest Node 22 recommended; `.nvmrc` supplied) and npm.

```sh
npm ci
npm run check
npm run build
npm run bosses:validate
npm run schema:export
npm run dev
```

Open http://localhost:5173/ for setup, http://localhost:5173/play/ for the play scaffold, or http://localhost:5173/overlay/ for the intentionally empty transparent 1920×1080 OBS scaffold. No credentials are needed for M0. Future integrations will use `.env.local`, based on `.env.example`; never commit tokens.

Validate a custom spec: `npm run bosses:validate -- path/to/boss.json` (nonzero exit on invalid JSON/schema).

## Layout

| Path | Responsibility |
| --- | --- |
| `engine/` | Shared contract; M1 adds deterministic fixed 60 Hz simulation |
| `server/` | M3 forge/queue/websocket; M4 Twitch adapters |
| `web/play/` | Input-capable streamer game page |
| `web/overlay/` | Separate transparent OBS browser source |
| `forge/` | Ignored per-boss runtime workspaces |
| `bosses/house/` | Ember Anvil (heavy), Neon Brood (swarm), Prism Warden (sniper) |
| `scripts/` | Schema export and spec validation |
| `tests/` | Contract boundaries and schema export checks |

## Boss contract v1

`engine/boss-api.ts` is authoritative. Strict objects reject unknown properties. Specs use arena pixels, seconds for attack intervals and summon cadence, milliseconds for warnings/modifiers, degrees for angles, and remaining-HP fractions for phases. Start at `hpBelow: 1`, then descend; at a threshold, the last matching phase wins. A phase fully replaces the previous phase.

`engine/boss.schema.json` is generated, not hand-edited. It expresses structural constraints for editors and future agents; the Zod parser also checks cross-phase ordering. Before running a boss, the server must parse it and independently run M2's fairness gate. Fairness is deliberately separate from schema validity so the gate can measure and explain unsafe patterns.

The optional `boss.ts` API is a type-only draft in M0. No generated scripts execute. The future sandbox may expose only emit/moveTo/wait/say/telegraph/rand; type checking or a banned-word filter alone is not a security boundary.

## Milestones

- [x] M0: setup + schema + three house specs
- [ ] M1: deterministic engine and playable canvas game
- [ ] M2: reference dodger, metrics, independent fairness gate
- [ ] M3: real Codex forge, streamed events, queue, no-account demo
- [ ] M4: Twitch auth/EventSub/Helix and OBS overlay
- [ ] M5: feel/sound, moderation, script sandbox, submission README/video

Integration assumptions and verification sources are recorded in [docs/integrations.md](docs/integrations.md). Runtime agent rules arrive with the forge. All artwork and audio will be generated procedurally using canvas and WebAudio.
