# Devpost submission: Boss Forge

Copy-ready text for the Codex x TwitchCon hackathon form. Fill in the two placeholders before submitting.

- **Video:** `<YouTube link>`
- **Codex session ID (main build thread, from `/status`):** `<session id>`
- **Repo:** https://github.com/ayushagarwalhere/boss_forge

---

## Tagline

Chat designs the boss. Codex builds it. The streamer has to beat it.

## Inspiration

Twitch already has lots of games that chat can play along with: chat votes, spawns enemies, picks a door. But chat never gets to *make* the game. We wanted the most creative person in chat to be able to type one sentence and, about a minute later, watch the streamer fight the thing they imagined, with their name on it.

The hard part is not generating a boss. It's generating one that is new every time, actually playable, and fair enough to put in front of a live audience without a troll making the stream unwinnable.

## What it does

1. **A viewer types** `!boss a giant toaster that shoots flaming bread` in chat (or redeems the *Forge a Boss* Channel Points reward). The bot replies with a short code, and the streamer or a mod approves it with `!approve`.
2. **Codex builds it, live.** Each request opens a Codex SDK thread in a locked-down workspace: a typed BossAPI, the rules in `forge/AGENTS.md`, and the viewer's words passed in as untrusted data, never as instructions. Codex writes `boss.json` (attack patterns, phases, movement, taunts) and optional TypeScript choreography, which compiles inside an isolated QuickJS sandbox. It runs the local checks and fixes its own mistakes, for up to three attempts.
3. **The fairness gate decides.** The server, not Codex, re-runs an unchangeable gate on the actual spec. A reference dodger bot with ~100 ms reactions fights the boss five times. It must win at least 2/5 (beatable) and lose at least 1/5 (interesting), a safe space must always exist, and p99 tick time must stay under budget. A failing boss is rejected ("too unfair to ship"), and Channel Points are refunded automatically.
4. **The streamer fights it** in an original bullet-hell arena with procedural art and WebAudio sound. A transparent 1920×1080 OBS overlay shows the boss card, the viewer's quote, gate metrics, the queue and a live "inside the forge" ticker of what Codex is doing.
5. **The show keeps going:**
   - After a win, chat types `!rematch`. Codex reads the previous boss and the fight stats and patches a harder **MK II**, which must pass the same gate.
   - `!vote 1/2/3` polls pick the next boss.
   - A persistent **Hall of Fame** (`!top`, `!record`, `!mybosses`) tracks whose bosses beat the streamer.
   - Each finished fight requests a Twitch clip and stream marker.

Setup takes minutes: `npm run auth -- broadcaster`, `npm run auth -- bot`, add one OBS browser source, and use the `/setup/` checklist.

## How we built it (and how we used Codex)

Codex is in two layers.

- **Building the product.** Boss Forge was built in OpenAI Codex, milestone by milestone:
  - M0: contract and tooling.
  - M1: the deterministic 60 Hz engine and arena.
  - M2: the fairness gate.
  - M3: the Codex forge.
  - M4: Twitch and the OBS overlay.
  - M5: moderation, sound and isolated scripts.

  `AGENTS.md` files hold the project's rules for every Codex session, including no secrets in the browser, viewer text as data, honest labels for demo replays, and never weakening gate checks. Teammate pull requests added the landing page, motion polish and the show layer on top of the Codex-built core.
- **Running the product.** Every viewer request is a real Codex SDK run (`@openai/codex-sdk`). The server streams Codex's typed events (reading, writing, compiling, testing) to the overlay. It keeps the thread for follow-up repair attempts and enforces a workspace-write permission profile that denies reads outside the workspace and allows no network. Codex output is never trusted directly: the server re-validates the schema, recompiles scripts in QuickJS and re-runs the gate before anything reaches the queue.

**Stack:** TypeScript, Node, Vite, Zod, Vitest, Three.js and GSAP (landing page), Canvas 2D (arena), WebAudio, QuickJS, Twitch EventSub WebSockets plus Helix (chat, Channel Points, clips, markers), OBS browser source, and the OpenAI Codex SDK.

## Challenges we ran into

- **Safety on a live stream.** Viewer text is adversarial. We kept it as data all the way through: moderation runs before intake, approval is manual by default, Codex can only touch an isolated workspace with read-only protected inputs, and the gate runs on the server, outside Codex's reach.
- **"Fair" had to be measurable.** We replaced "looks fine" with a reproducible bot-based gate, deterministic seeds and recorded reports.
- **Live platform edge cases.** These included refunds when a forge fails, deduplicating EventSub deliveries and handling reconnect handoffs. During our live test we also found that using one Twitch account as both broadcaster and bot made the bot ignore the streamer's own commands, and fixed it.

## Accomplishments we're proud of

- A full loop that works on a real Twitch channel: chat message, Codex, gate, overlay, fight, rematch.
- An account-free `npm run demo` that runs the whole show with clearly labeled simulated viewers and cached replays.
- 160+ automated tests, covering OAuth ownership, refunds, reconnects, sandbox escapes and gate policy.

## What we learned

LLM code generation becomes shippable live content when you pair it with an independent, deterministic judge. Codex is the creative engine; the gate is what lets a streamer trust it.

## What's next

- Multi-boss tournaments voted on by chat.
- Shareable boss cards with replay seeds.
- An "ask Codex why" button that explains a rejection in plain language.
- A hosted version, so streamers don't run a local server.

## Built with

openai-codex · codex-sdk · typescript · node.js · twitch-api · eventsub · obs · vite · quickjs · canvas · webaudio · zod · vitest
