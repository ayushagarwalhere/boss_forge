# The stream show: Rematch Patch, chat polls and Hall of Fame

Boss Forge's core loop is: chat designs a boss, Codex builds it, the gate proves it's fair, and the streamer fights it. The *show* layer gives chat a reason to keep playing after each fight. It sits on top of the forge (`server/showtime/`) and never bypasses moderation, approval or the fairness gate.

| Feature | Chat | What happens |
| --- | --- | --- |
| **Post-fight recap** | — | A win or loss posts a recap to chat and a 14-second card on the overlay: fight time, hearts left, boss HP left, phase reached, the streamer's record, and the boss's provenance (live Codex, cached replay or house). |
| **Rematch Patch** | `!rematch` | After the streamer **beats** a boss, a 60-second window opens. When `REMATCH_VOTES` viewers (default 3) type `!rematch`, or the boss's creator or a mod types it once, the boss goes back to the forge as **MK II** (then MK III, and so on, up to MK V). |
| **Chat poll** | `!vote 1/2/3` | Between fights, when two or more verified bosses are queued, a 45-second poll opens automatically (`AUTO_VOTE=false` turns that off; mods can use `!startvote`). Claiming the next fight closes the poll and promotes the winner. One vote per viewer; voting again changes your vote. |
| **Hall of Fame** | `!top`, `!record`, `!mybosses` | Every finished fight is stored in `.artifacts/showtime/history.json` (the demo uses a separate file). Creators earn 1 point per fight, 3 per win against the streamer and 2 per rematch upgrade. The streamer's W–L record and streak persist across streams. |

## How a rematch is built

1. The arena reports display-only fight stats with the outcome (`POST /api/finish` with `stats`, validated by `FightStatsSchema`). The outcome stays authoritative; stats never affect the gate.
2. `ForgeCoordinator.submitRematch` creates a `source: 'rematch'` job. It reuses the original creator and source quote, which were already admitted (moderated and approved) with the first boss, so `moderation: 'rematch'` is shown instead of re-checking. Rematch jobs jump ahead of new ideas in the forge, and a passed upgrade goes to the **front** of the queue.
3. **Live Codex:** the workspace also gets two read-only files, `previous-boss.json` (compiled choreography removed) and `rematch.json` (MK name, fight stats, and plain-language goals such as "won comfortably with 3/3 hearts: tighten cadence"). Both are pinned read-only in the Codex permission profile. `forge/AGENTS.md` has a *Rematch Patch* section: keep identity, creator and source quote, make it noticeably harder, still pass the gate.
4. **Replay/demo (no key):** an **offline tuner** (`server/showtime/tuner.ts`) makes a deterministic, mild upgrade: tighter cadence, slightly faster untargeted bullets, a faster final phase and modest HP. It scales with how much slack the original had in the gate (bot wins). Aimed/homing speeds are never raised, because the gate caps them. Every ticker line says `Cached replay: Offline tuner…`, and nothing claims live Codex.
5. The server reruns the **unchanged gate** on the actual spec. If the upgrade is too unfair, it is rejected and chat is told so: "The gate rejected Ember Anvil MK II: too unfair to ship." This is the same rule as for any boss.

An auto-poll is skipped in the break where chat forged a rematch, because chat already picked the next fight.

## Demo mode

`npm run demo` adds a **simulated crowd** (`server/demo/crowd.ts`) that votes in polls and calls rematches. Toasts label it as simulated, it never touches Twitch, and demo fights go to `history-demo.json`.

## Setup page

`/setup/` is a streamer checklist built from `GET /api/diagnostics`. It covers Node, forge mode (with the Windows sandbox note), moderation, approval, Twitch, the Channel Points reward and the show settings, each with a fix hint. It also has OBS URLs with copy buttons and three test buttons: an overlay banner and toast, a sample viewer idea, and a Twitch chat test message (only when Twitch is connected). Diagnostics never include keys, tokens or file contents.

## Settings (`.env.local`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMATCH_VOTES` | `3` | Distinct viewers needed to force a rematch (1–50). The creator and mods count as enough on their own. |
| `REMATCH_SECONDS` | `60` | How long the rematch window stays open (15–300). |
| `VOTE_SECONDS` | `45` | Poll length (15–180). |
| `AUTO_VOTE` | `true` | Set `false` to start polls only from the console or `!startvote`. |
