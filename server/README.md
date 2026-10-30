# Server (M3–M4)

`gate/` now contains the M2 fairness runner, safe-space metrics, file loader, and report writer. `runGate(spec)` always revalidates and simulates the actual declarative spec with a fixed policy. Use it inside the future server's worker boundary; it is synchronous CPU work and should not run on a live websocket event loop.

M3 adds the forge queue, Codex SDK runner and websocket hub. M4 adds Twitch auth/EventSub/Helix adapters. No external API calls or HTTP server are implemented yet. Credentials stay here, never in the browser.
