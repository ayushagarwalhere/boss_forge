# Integration verification notes

Checked 2026-10-30 for M0. No SDK or Twitch integration is implemented yet.

- Official Codex SDK entry point: https://developers.openai.com/codex/sdk (currently redirects to https://learn.chatgpt.com/docs/codex-sdk). Before M3, install the SDK, read its bundled README and .d.ts, and verify exact thread, streaming, output-schema, sandbox, working-directory, network and resume options. Do not infer option names from the brief. Restricted tool network must still permit authenticated model access; distinguish model transport from the agent's network access.
- Twitch scope reference: https://dev.twitch.tv/docs/authentication/scopes/ . Token ownership and extra bot grants depend on token type and transport; validate broadcaster and bot grants separately in M4.
- EventSub subscriptions: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ . Verify channel.chat.message and channel.channel_points_custom_reward_redemption.add against WebSocket user-token requirements in M4.
- Create Custom Rewards: https://dev.twitch.tv/docs/api/reference/#create-custom-rewards . Requires channel:manage:redemptions and an Affiliate/Partner broadcaster. Fall back to !boss for ineligible channels.
- Update Redemption Status: https://dev.twitch.tv/docs/api/reference/#update-redemption-status . The client ID must be the one that created the reward; create and persist our own reward before accepting redemptions. Recheck before implementation.
- Zod JSON Schema: https://zod.dev/json-schema . Use native z.toJSONSchema. Exported schema handles structural constraints; phase ordering remains a server-side Zod check. Passing either is not evidence of fairness.

Still to resolve in the owning milestone: SDK package version and Windows sandbox behavior; Twitch localhost redirect registration, OAuth token refresh and validation, rate limits, reconnect/deduplication, channel-points availability, offline clip/marker errors; numerical aimed speed and simulation tick budgets.
