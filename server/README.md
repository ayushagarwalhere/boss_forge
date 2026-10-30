# Server (M3–M4)

`gate/` contains the fairness runner, safe-space metrics, file loader, report writer, and independent worker entry point. `forge/` contains workspace preparation, the Codex SDK adapter, the three-attempt state machine, queue, and server-owned job metadata. `demo/` contains the offline replay adapter and fifteen simulated viewer briefs.

`main.ts` starts the loopback HTTP/WebSocket server and the Vite preview (or built static pages with `--production`). Gate CPU work runs in a separately bundled worker with a 30-second timeout. Codex uses a separate runtime workspace and credential-clean child environment. The server always revalidates the actual file and reruns the gate before queueing.

M4 adds Twitch auth/EventSub/Helix adapters; M5 adds API moderation and isolated choreography execution. Credentials stay on the server, never in the browser. See docs/forge.md for operation and limits.
