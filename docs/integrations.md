# Integration verification notes

Checked 2026-10-31. M4 implements Twitch with user tokens and EventSub WebSockets. See [twitch.md](twitch.md) for setup, transport decisions, tests and live verification limits; see [forge.md](forge.md) for the SDK sandbox record.

- Codex SDK: installed @openai/codex-sdk 0.166.0; its README and dist/index.d.ts were read before implementation. Thread/runStreamed, outputSchema, AbortSignal, thread IDs, working directories and configuration overrides are verified against those types. Official guide: https://learn.chatgpt.com/docs/codex-sdk . Live mode uses a named workspace-write profile with denied outside reads and no tool networking; provider transport remains separate. Live authentication was not exercised without a key, and native Windows needs supported MXC/elevated isolation. See docs/forge.md.
- Twitch scope reference: https://dev.twitch.tv/docs/authentication/scopes/ . Broadcaster and bot grants are validated separately; the M4 table records the selected user-token transport.
- EventSub subscriptions: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ . M4 uses channel.chat.message and channel.channel_points_custom_reward_redemption.add on separate role sockets.
- Create Custom Rewards: https://dev.twitch.tv/docs/api/reference/#create-custom-rewards . Requires channel:manage:redemptions and an Affiliate/Partner broadcaster. Fall back to !boss for ineligible channels.
- Update Redemption Status: https://dev.twitch.tv/docs/api/reference/#update-redemption-status . M4 discovers only manageable rewards and persists our reward ID before accepting redemptions; the creating client ID is required for status updates.
- Zod JSON Schema: https://zod.dev/json-schema . Use native z.toJSONSchema. Exported schema handles structural constraints; phase ordering remains a server-side Zod check. Passing either is not evidence of fairness.

## M4 endpoint and token record

All Helix requests use `https://api.twitch.tv/helix/`. Verified against the [API reference](https://dev.twitch.tv/docs/api/reference/) before implementation:

| Endpoint | User-token owner | Scope |
| --- | --- | --- |
| GET/POST/PATCH `channel_points/custom_rewards` | Broadcaster | `channel:manage:redemptions` |
| GET/PATCH `channel_points/custom_rewards/redemptions` | Broadcaster; app-created reward only | `channel:manage:redemptions` |
| POST `eventsub/subscriptions`: chat v1 | Bot; condition `user_id` matches | `user:read:chat` |
| POST `eventsub/subscriptions`: redemption.add v1 | Broadcaster | `channel:manage:redemptions` |
| POST `chat/messages` | Bot; `sender_id` matches | `user:write:chat` |
| POST `clips`; GET `clips` confirmation | Broadcaster | `clips:edit`; authenticated read |
| POST `streams/markers` | Broadcaster | `channel:manage:broadcast` |

Rewards need Affiliate/Partner eligibility. Manageable-only discovery establishes client ownership. CANCELED refunds; FULFILLED follows server verification. Clips are asynchronous; markers need a live stream and VOD support.

OAuth uses `https://id.twitch.tv/oauth2/authorize`, POST `/oauth2/token` for code exchange/refresh, and GET `/oauth2/validate`. Validation runs at startup/hourly; both rotated tokens are persisted. Sources: [code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow), [refresh](https://dev.twitch.tv/docs/authentication/refresh-tokens/), [validation](https://dev.twitch.tv/docs/authentication/validate-tokens/).

User-token WebSockets use `wss://eventsub.wss.twitch.tv/ws`, separate role sockets, welcome-session subscriptions, keepalives, duplicate suppression, reconnect handoff without resubscribing, and revocation shutdown. Extra app-token cloud-bot grants are unnecessary here. Sources: [chat authentication](https://dev.twitch.tv/docs/chat/authenticating/), [subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), [WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/). HTTP 429 reset handling has one bounded retry; network failures never blindly repeat mutations.

Remaining live checks: operator OAuth consent, Twitch delivery/refunds, real stream highlight creation, OBS desktop capture, and the existing Windows Codex isolation test. M5 verification follows below.

## M5 verification record

Checked 2026-10-31. Moderation uses server-side `POST https://api.openai.com/v1/moderations`, platform-key Bearer authentication, model `omni-moderation-latest`, text `input`, and the single result's boolean `flagged`. The response schema, timeout and outage handling were tested with injected transports; no live moderation request was made without a key. Sources opened before implementation: [Create moderation](https://developers.openai.com/api/reference/resources/moderations/methods/create), [moderation guide](https://developers.openai.com/api/docs/guides/moderation). Manual mode is explicit and always requires human approval; it is not an API moderation claim.

Script isolation uses pinned `quickjs-emscripten-core@0.32.0` and `@jitl/quickjs-singlefile-cjs-release-sync@0.32.0`. The installed variant README and core declarations were read for module construction, memory/stack limits, interrupt callbacks, result disposal and evaluation. The [upstream documentation](https://github.com/justjake/quickjs-emscripten) was checked before implementation. The single-file variant embeds WASM and is built with filesystem support disabled. Guest code gets no host callbacks or module loader. The separate Node compiler worker uses explicit resource/termination limits; the simulator gets data only. See [scripts.md](scripts.md) for the exact trust boundary and tested limits.

The installed Codex SDK README and declarations were reread before changing the runtime authoring prompt. No SDK API or permission broadening was introduced. Named workspace-write permissions, denied outside reads, disabled tool networking, real thread provenance and all prior live-verification limitations remain in force.
