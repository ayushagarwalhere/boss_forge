# Server (M3–M5)

`gate/` contains the fairness runner, safe-space metrics, file loader, report writer, and independent worker entry point. `forge/` contains workspace preparation, the Codex SDK adapter, the three-attempt state machine, queue, and server-owned job metadata. `demo/` contains the offline replay adapter and fifteen simulated viewer briefs.

`main.ts` starts the loopback HTTP/WebSocket server and Vite preview (or built static pages with `--production`). Gate CPU work runs in a bounded, separately bundled worker. Codex uses a separate runtime workspace and credential-clean child environment. The server always revalidates the actual files, compiles optional source in isolation and reruns the gate before queueing.

`twitch/` owns auth/EventSub/Helix. `moderation.ts` checks requests before admission; manual mode always requires approval. `scripts/` checks a restricted generator subset, runs QuickJS inside a killable worker, and validates command tapes. Credentials stay on the server, never in the browser. See docs/forge.md, docs/scripts.md and docs/twitch.md for operation and limits.
