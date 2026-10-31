# Test Boss Forge on Twitch

This takes about 10 minutes. You need a Twitch account that can stream, and optionally a second account for the bot.

## 1. Register a Twitch app (once)

1. Open https://dev.twitch.tv/console/apps and click **Register Your Application**. Enable two-factor authentication on the account if Twitch asks.
2. Fill in the form:
   - **Name:** anything unique, e.g. `boss-forge-yourname`.
   - **OAuth Redirect URLs:** `http://localhost:8787/auth/callback` (exactly this).
   - **Category:** Game Integration.
   - **Client type:** Confidential.
3. Click **Manage**, copy the **Client ID**, then click **New Secret** and copy the secret.

## 2. Configure the server

Create `.env.local` in the repo root. Never commit it.

```sh
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
# Optional: set AUTO_APPROVE=true while testing alone, so requests skip manual approval.
```

Then:

```sh
npm ci
npm run demo      # cached replay forge, no OpenAI key needed
# or: npm run server  (live Codex; needs CODEX_API_KEY / OPENAI_API_KEY)
```

The console prints `Twitch: configured`. When Twitch is configured, the simulated demo viewers turn off, so only real chat feeds the forge.

## 3. Connect accounts

1. Open **http://localhost:8787/forge/**. Use `localhost`, not `127.0.0.1`, so the Twitch redirect returns to the same host.
2. In the **Twitch** panel, click **Connect** and log in as the **streamer** account. Approve the scopes:
   - `user:read:chat` and `user:write:chat` to read `!boss` and reply.
   - `channel:bot` so an optional bot account may chat here.
   - `channel:read:redemptions` and `channel:manage:redemptions` to create the reward and refund points.
3. Optional: click **Add bot** and log in as a *second* account (scopes `user:read:chat`, `user:write:chat`, `user:bot`). Replies then come from the bot. Without one, the streamer account replies.

The panel shows **● LIVE** when chat is connected. Tokens are stored in `.artifacts/twitch/tokens.json` (git-ignored), refreshed automatically, and validated hourly as Twitch requires. Click **Disconnect** to remove them.

## 4. Try it

In your Twitch chat (as any viewer):

| Chat | What happens |
| --- | --- |
| `!boss a disco ball that fires spirals and taunts in rhymes` | Request enters the forge; the bot replies. |
| `!queue` | Lists the next verified bosses. |
| `!fight` | Says what the streamer is fighting now. |

Unless `AUTO_APPROVE=true`, approve the request on `/forge/` (**Approve ↗**). The forge builds it, the server reruns the fairness gate, and the bot posts `✅ … passed the fairness gate` or `❌ … not queued`. Open **http://localhost:8787/play/**, click **Fight next forged boss**, then **Enter arena**. Fight start and end are announced in chat.

**Channel points:** on Affiliate/Partner channels with `TWITCH_REWARDS=auto`, the server creates a **Forge a boss** reward (500 points, viewer text required). It reuses that reward on later runs. A queued boss marks the redemption **fulfilled**. A rejected, failed or refused request is **canceled**, which refunds the points, and the bot says so. Shutting the server down refunds any redemption still in progress. Non-affiliate channels skip the reward; the chat command still works.

## 5. Put it on stream (OBS)

- Add a **Window Capture** of the `/play/` browser window. Input goes to that window.
- Add a **Browser Source** for `http://localhost:8787/overlay/` (1920×1080) once the overlay lands. It is transparent and read-only.

## Troubleshooting

- **"redirect_mismatch"**: the Redirect URL in the Twitch console must exactly match `TWITCH_REDIRECT_URI` (default `http://localhost:8787/auth/callback`).
- **Panel stuck on "○ CONNECTING"**: check the detail line. A revoked or expired session asks you to reconnect.
- **No replies in chat**: if you use a bot account, make sure the streamer granted `channel:bot` (reconnect the streamer once), or make the bot a moderator.
- **Reward errors**: Twitch only lets the app that created a reward manage it. If you made a reward with the same title by hand, rename it or set `TWITCH_REWARD_TITLE`.
