# Recording and submission runbook

## Account-free recording

1. Use Node 20.19+, 22.13+ or 24+. Run `npm ci`, `npm run check`, `npm run build`, and `npm run gate -- --all`.
2. Set `FORGE_MODE=replay` if a Codex key is saved and you want an offline recording. Run `npm run demo` and wait for house verification and the first simulated viewer.
3. Open `/forge/`, `/play/` and `/overlay/` at the printed loopback URL (default http://127.0.0.1:8787). Add the overlay to OBS at 1920×1080 above a window capture of the play page. Keep the middle transparent. Click **Sound off** to enable original WebAudio cues; the page needs a user gesture.
4. Let simulated requests show reading/writing/testing events, the server's independent verification and a queue card. These are visibly **cached house-template replays**, not recorded SDK runs or new live code generation. Simulated viewers are not Twitch events.
5. Claim a verified boss, enter the arena, move with WASD/arrows and use Shift to focus. Show a phase warning or a defeat. Demo highlight toasts are explicitly previews; they create no clips or markers on Twitch.
6. Submit a local idea to demonstrate manual approval. The console states when API moderation is unavailable; it never labels manual review as an API check.

Suggested 90-second sequence: 0–10s landing and premise; 10–30s viewer idea and forge ticker; 30–45s server gate metrics and queue; 45–75s gameplay, sound and overlay; 75–90s outcome and architecture. Keep source labels visible throughout. Mention the script compiler separately using the checked-in example and its real gate report; don't pretend cached fixtures were generated on stage.

## Live recording

Follow [Twitch setup](twitch.md), authorize both users and start `npm run server` with live Codex mode. Supply a platform key for API moderation. The native Windows Codex isolation limitation in [forge.md](forge.md) still needs operator verification; don't broaden the permission profile to make a recording work. Use a supported isolation environment if necessary. Show an actual SDK thread ID only when the SDK supplies one.

Verify a test Channel Points request, moderator approval, queueing and failed-request refund on your own channel before recording. Real highlights need a live stream with the appropriate clip/VOD settings. Keep credentials and local files out of the capture. No automated live Twitch or model calls were made to fabricate demonstration evidence.

The repository is the code deliverable. A final recorded video, Devpost upload and operator-specific live verification are still actions for the entrant; they are not claimed to have been completed by the build.
