# Forge pipeline, M3

This records the M3 forge implementation and SDK sandbox limits. M4 adds Twitch, refunds and OBS cards in [twitch.md](twitch.md). M5 adds request moderation and [isolated generator compilation](scripts.md), with read-only worker/schema files in each workspace. Earlier statements below about disabled scripts and deferred Twitch describe the M3 baseline; current behavior is documented in those guides. The strict SDK permission profile and honest replay labels remain unchanged.

## Start and inspect

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:8787/forge/` and `/play/`. The single Node process serves the local console, game, API, read-only WebSocket snapshots, and Vite preview. `npm run build` then `npm run demo -- --production` serves built static pages; use `npm.cmd` in PowerShell if its `.ps1` wrapper consumes flag separators.

The demo feeds fifteen named viewers and varied descriptions on a 20-second timer. It waits for capacity when the ten-request limit is reached. Five verified bosses fit in the fight queue; the forge continues while one fight is active. Empty queues use independently verified house fallbacks. Normal typed requests wait for local approval; only the server's trusted simulated requests bypass review. `AUTO_APPROVE=true` is an explicit local setting. Twitch and API moderation are not connected yet.

The console supports request submission, approval/rejection, status, mode provenance, gate summaries, viewer feed, build ticker, and skipping an abandoned fight. The arena claims a queued boss and submits won/lost results. A retry after a finished fight is local practice; it does not create another channel-points redemption or clip. Disconnecting does not silently replace an active fight; use the console's Skip button to release it.

## Live versus cached replay

- A key in `CODEX_API_KEY` or `OPENAI_API_KEY` selects live Codex, including in demo mode. Credentials are loaded from `.env.local`, then `.env`, without overriding the process environment.
- `FORGE_MODE=replay` explicitly selects cached replay, even if a key exists. A no-key `npm run demo` also selects replay. A no-key non-demo server refuses to start live mode.
- `CODEX_MODEL` is optional; omitted means the installed SDK/CLI default. `FORGE_TIMEOUT_MS` defaults to 180000 and is limited to 1000–300000.
- Live demo requests can consume model tokens. Cached replay makes no model API call. A live generation failure never silently becomes a successful cached replay.

The replay fixtures in `bosses/replays/` are recordings of an **offline house-template preparation and actual fairness run**, produced by `npm run demo:record`. They are not fabricated SDK transcripts and do not have Codex thread IDs. Their source is explicitly recorded in each fixture and labeled in the console, ticker, job, queue card, and arena intro. Replay timing is paced for readability. Arbitrary typed text reuses a matching cached pattern; it does not receive fresh model-authored choreography.

The current replay cache uses the three house patterns. A cached report is checked for content/policy identity, then the server reruns the current gate on the viewer-bound copy anyway. A cached fixture that fails the current gate is rejected, not replayed repeatedly until timing happens to pass. Regenerate recordings after any relevant house or gate-policy change.

## Runtime Codex contract

Verified against installed `@openai/codex-sdk@0.166.0` README and `dist/index.d.ts` on 2026-10-30. The adapter uses `Codex.startThread`, `Thread.runStreamed`, `Thread.id`, streamed `thread.started`, item events, `turn.completed`/errors, and per-turn `outputSchema`/`signal`. It reuses one thread for up to three revision turns and saves the thread ID with each job. Resume/rematch UI is deferred.

The final answer is a strict JSON object with `status: ready|failed`, `summary`, and `files`. An answer claiming ready is not evidence of a pass. The server always reads and validates the actual boss JSON. SDK file-change and command events become fixed public progress messages; raw reasoning, command strings, stdout/stderr, provider errors, credentials, and environment values are never sent to the ticker.

Sources: [official SDK guide](https://learn.chatgpt.com/docs/codex-sdk), [permission profiles](https://learn.chatgpt.com/docs/permissions), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). Installed types/README take precedence for method signatures; no guessed SDK methods are used.

## Workspace and credentials

Each request gets `forge/<id>/` with:

```text
AGENTS.md              runtime rules, overriding parent build/commit instructions
request.txt/json       immutable, JSON-delimited viewer DATA
boss.schema.json       trusted declarative schema
arena.json/policy.json shared arena and immutable gate policy
examples/              known-good starting specs
package.json/gate.mjs  self-contained offline npm run gate harness
boss.json              agent output
gate-report.json       agent feedback only, never trusted by the server
```

The harness is bundled from the original gate at server startup. Agent commands need no package installation or access to the application source. The runtime permission profile allows writes only in this request directory, grants minimal system/Node runtime reads, denies broad outside reads, protects the request/schema/harness/example files, denies local `.codex/.agents/.git/.aws` directories, and disables command networking. Approval policy is never; web search is disabled. No dangerous-full-access fallback is used.

The adapter supplies a credential-clean CLI environment and separate ignored `CODEX_HOME` per job. The API key goes to the SDK transport; shell environment policy excludes keys/secrets/tokens and provider/Twitch variables. Auth credential storage is ephemeral. The SDK transport's access to OpenAI is distinct from the model's command network access, which remains off.

The SDK is configured through a named **workspace-write permission profile**, rather than legacy `ThreadOptions.sandboxMode`. Legacy sandbox settings would take precedence over the profile and lose its denied-read rules. On native Windows the adapter prefers MXC when supported and selects elevated as the legacy fallback; unelevated is not used because it lacks denied reads. Configure a supported backend through the [official Windows sandbox setup](https://learn.chatgpt.com/docs/windows/windows-sandbox), or run live mode in WSL/Linux. This build did not provision administrator accounts, change machine firewall rules, or weaken system settings.

The authentication-free native Windows smoke test using the selected default backend failed with “Restricted read-only access requires the elevated Windows sandbox backend.” This establishes that the tested default lacked the needed read restrictions, not that every supported backend is absent. The adapter's explicit MXC/elevated selection was not natively exercised. No live model request was made because no API key was present. Options, typed event consumption, structured output, thread reuse, and suppression of raw output are covered with mocked SDK events; native live generation remains an environment-dependent validation step.

## Independent server validation

After each generation turn the server rejects scripts, nonregular/symlink/hardlinked files, oversized JSON, invalid schema, or creator/sourceQuote drift. It gates an in-memory copy in a separate trusted worker, with a 30-second timeout, and checks the report's spec hash, policy version, and decision. The agent's local report is ignored. Only the verified in-memory copy enters the queue; later file edits cannot replace it.

Failed live attempts receive the real failed-check diagnostics on the same thread, up to three turns. An unchanged rejected boss cannot become accepted merely because a later timing measurement differs. Generation exceptions/timeouts, shutdown, worker failure, or persistence failure queue nothing. M4 will connect rejection to refunds; M3 does not claim any points were refunded or any Twitch message was sent.

Metadata/thread IDs and server-owned reports are stored outside the model workspace in `.artifacts/requests/`. These are ignored, server-owned diagnostic files. In-memory jobs/history are bounded to 50, ticker events to 200, chat messages to 50, active requests to 10, queue entries to 5, and active fights to 1. Queue/fight state is process-local: a server restart clears it and does not automatically resume model calls or charge another generation. Prior metadata remains on disk for inspection and later rematch support. Runtime directories are retained for debugging and never committed.

## Local HTTP boundary

The server binds only `127.0.0.1`. Host and Origin must match its actual local port. Mutating JSON routes require a random per-start local control token from `/api/session`; the token is not in public snapshots. Request bodies are limited to 8 KiB; request fields and viewer login/description are validated. Per-user cooldown is one minute. WebSocket snapshots use the shared Zod protocol, accept no commands, limit payload/client buffering, and cap clients at 16. The Vite preview allows only web/engine/bosses/dependency source paths and excludes secrets, runtime workspaces, and `.artifacts/`.

Routes: `GET /api/state`, `GET /api/session`, `POST /api/requests`, `/api/review`, `/api/claim`, `/api/finish`; read-only snapshots at `/ws`. These are trusted local streamer controls, not a public or remotely authenticated admin service. M4's Twitch chat adapter must validate broadcaster/moderator roles before calling review/skip operations.

## Verification

Tests cover the SDK's actual installed types, permission/env configuration, structured event mapping, thread reuse, three-attempt rejection, genuine revision feedback, refusal to accept an unchanged rejected boss, cached provenance/staleness, server-owned verification, invalid metadata/files/scripts, standalone offline gate command, stuck/malformed gate workers, approval/cooldown/capacity, queue refill during a fight, verified fallbacks, idempotent outcomes, shutdown, local origin/token/body limits, and real HTTP/WebSocket transitions.

The no-key demo was exercised through the browser: simulated requests → recorded events → independent verification → queue → arena claim, plus local submission/approval. Live SDK transport/authentication was not exercised without a key. OBS cards, real Twitch chat/redemptions/refunds/clips, API moderation, generated script execution, and Rematch Patch are outside M3.

## Live Codex on Windows via WSL

Running the forge inside WSL2 (Ubuntu) uses the Linux sandbox (bubblewrap), which this build checked: the bundled `codex sandbox` ran a command and blocked writes outside its workspace.

1. In Ubuntu, install Node 22. A user-local tarball under `~/.local/node` is enough.
2. Keep the checkout on the Linux filesystem (for example `~/boss_forge`), not under `/mnt/c`, and run `npm ci` there so the Linux Codex binary is installed.
3. Copy `.env.local` with your keys and Twitch tokens into that checkout, then run `npm run build && npm run server`.
4. Open `http://127.0.0.1:8787/` from Windows; WSL2 forwards localhost by default. Run only one server per Twitch reward.
