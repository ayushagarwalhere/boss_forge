# Server (M3–M4)

Owns the forge queue, Codex SDK runner, gate worker, websocket hub, and Twitch auth/EventSub/Helix adapters. No external API calls or server are implemented in M0. Credentials stay here, never in the browser.
