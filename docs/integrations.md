# Integration verification notes

Checked 2026-10-30. M3's Codex adapter is implemented; Twitch remains deferred to M4. See docs/forge.md for the current SDK and sandbox verification record.

- Codex SDK: installed @openai/codex-sdk 0.166.0; its README and dist/index.d.ts were read before implementation. Thread/runStreamed, outputSchema, AbortSignal, thread IDs, working directories and configuration overrides are verified against those types. Official guide: https://learn.chatgpt.com/docs/codex-sdk . Live mode uses a named workspace-write profile with denied outside reads and no tool networking; provider transport remains separate. Live authentication was not exercised without a key, and native Windows needs supported MXC/elevated isolation. See docs/forge.md.
- Twitch scope reference: https://dev.twitch.tv/docs/authentication/scopes/ . Token ownership and extra bot grants depend on token type and transport; validate broadcaster and bot grants separately in M4.
- EventSub subscriptions: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ . Verify channel.chat.message and channel.channel_points_custom_reward_redemption.add against WebSocket user-token requirements in M4.
- Create Custom Rewards: https://dev.twitch.tv/docs/api/reference/#create-custom-rewards . Requires channel:manage:redemptions and an Affiliate/Partner broadcaster. Fall back to !boss for ineligible channels.
- Update Redemption Status: https://dev.twitch.tv/docs/api/reference/#update-redemption-status . The client ID must be the one that created the reward; create and persist our own reward before accepting redemptions. Recheck before implementation.
- Zod JSON Schema: https://zod.dev/json-schema . Use native z.toJSONSchema. Exported schema handles structural constraints; phase ordering remains a server-side Zod check. Passing either is not evidence of fairness.

Still to resolve in the owning milestone: SDK package version and Windows sandbox behavior; Twitch localhost redirect registration, OAuth token refresh and validation, rate limits, reconnect/deduplication, channel-points availability, offline clip/marker errors; numerical aimed speed and simulation tick budgets.
