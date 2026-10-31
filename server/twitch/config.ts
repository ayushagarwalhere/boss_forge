export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Chat command viewers type, e.g. "!boss". */
  command: string;
  rewards: 'auto' | 'off';
  rewardTitle: string;
  rewardCost: number;
}

/** Returns null when Twitch is not configured; the forge then runs local/demo only. */
export function loadTwitchConfig(env: NodeJS.ProcessEnv, port: number): TwitchConfig | null {
  const clientId = env.TWITCH_CLIENT_ID?.trim() ?? '', clientSecret = env.TWITCH_CLIENT_SECRET?.trim() ?? '';
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error('Set both TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, or neither.');
  const redirectUri = env.TWITCH_REDIRECT_URI?.trim() || `http://localhost:${port}/auth/callback`;
  const url = new URL(redirectUri);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/auth/callback' || Number(url.port || 80) !== port) {
    throw new Error(`TWITCH_REDIRECT_URI must be http://localhost:${port}/auth/callback (and registered in the Twitch developer console).`);
  }
  const command = (env.TWITCH_COMMAND?.trim() || '!boss').toLowerCase();
  if (!/^![a-z0-9_]{1,20}$/.test(command)) throw new Error('TWITCH_COMMAND must look like !boss.');
  const rewards = env.TWITCH_REWARDS?.trim() || 'auto';
  if (rewards !== 'auto' && rewards !== 'off') throw new Error('TWITCH_REWARDS must be auto or off.');
  const rewardTitle = (env.TWITCH_REWARD_TITLE?.trim() || 'Forge a boss').slice(0, 45);
  const rewardCost = Number(env.TWITCH_REWARD_COST || 500);
  if (!Number.isInteger(rewardCost) || rewardCost < 1) throw new Error('TWITCH_REWARD_COST must be a positive whole number.');
  return { clientId, clientSecret, redirectUri, command, rewards, rewardTitle, rewardCost };
}
