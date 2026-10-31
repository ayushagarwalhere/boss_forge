import { z } from 'zod';

export const SCOPES = {
  broadcaster: ['channel:manage:redemptions', 'channel:manage:broadcast', 'clips:edit'],
  bot: ['user:read:chat', 'user:write:chat'],
} as const;
export type TokenRole = keyof typeof SCOPES;
const secret = z.string().min(1).max(2048).regex(/^\S+$/);
export const TwitchConfigSchema = z.object({
  clientId: secret, clientSecret: secret,
  broadcasterId: z.string().regex(/^\d+$/), botId: z.string().regex(/^\d+$/),
  broadcasterAccess: secret, broadcasterRefresh: secret, botAccess: secret, botRefresh: secret,
  rewardId: z.string().max(128).default(''), rewardCost: z.coerce.number().int().min(1).max(1000000).default(1000),
});
export type TwitchConfig = z.infer<typeof TwitchConfigSchema>;
export function twitchConfig(env: NodeJS.ProcessEnv, demo: boolean): TwitchConfig | null {
  if (demo || env.TWITCH_ENABLED !== 'true') return null;
  const result = TwitchConfigSchema.safeParse({ clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET,
    broadcasterId: env.TWITCH_BROADCASTER_ID, botId: env.TWITCH_BOT_ID,
    broadcasterAccess: env.TWITCH_BROADCASTER_ACCESS_TOKEN, broadcasterRefresh: env.TWITCH_BROADCASTER_REFRESH_TOKEN,
    botAccess: env.TWITCH_BOT_ACCESS_TOKEN, botRefresh: env.TWITCH_BOT_REFRESH_TOKEN,
    rewardId: env.TWITCH_REWARD_ID || '', rewardCost: env.TWITCH_REWARD_COST || 1000 });
  if (!result.success) throw new Error('Twitch configuration is incomplete. Run npm run auth for both accounts; see docs/twitch.md.');
  return result.data;
}
