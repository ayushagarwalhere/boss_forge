import { config as dotenv } from 'dotenv';
import { join } from 'node:path';
import { PROJECT_ROOT } from './gate/files';
import { twitchConfig } from './twitch/config';

export function loadConfig(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  if (env === process.env) {
    dotenv({ path: join(PROJECT_ROOT, '.env.local'), quiet: true });
    dotenv({ path: join(PROJECT_ROOT, '.env'), quiet: true });
  }
  const demo = args.includes('--demo'), apiKey = env.CODEX_API_KEY || env.OPENAI_API_KEY || '';
  const mode = env.FORGE_MODE || (apiKey ? 'codex' : demo ? 'replay' : 'codex');
  if (mode !== 'codex' && mode !== 'replay') throw new Error('FORGE_MODE must be codex or replay.');
  if (mode === 'codex' && !apiKey) throw new Error('Set CODEX_API_KEY/OPENAI_API_KEY, or run npm run demo for the no-key replay.');
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535.');
  const attemptTimeoutMs = Number(env.FORGE_TIMEOUT_MS || 180000);
  if (!Number.isInteger(attemptTimeoutMs) || attemptTimeoutMs < 1000 || attemptTimeoutMs > 300000) throw new Error('FORGE_TIMEOUT_MS must be 1000–300000.');
  const moderationKey = env.MODERATION_API_KEY || env.OPENAI_API_KEY || '';
  const moderationMode = env.MODERATION_MODE || (moderationKey ? 'api' : 'manual');
  if (moderationMode !== 'api' && moderationMode !== 'manual') throw new Error('MODERATION_MODE must be api or manual.');
  if (moderationMode === 'api' && !moderationKey) throw new Error('API moderation requires MODERATION_API_KEY or OPENAI_API_KEY.');
  const bounded = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number ${min}–${max}.`);
    return value;
  };
  const showtime = {
    rematchVotes: bounded('REMATCH_VOTES', 3, 1, 50), rematchWindowMs: bounded('REMATCH_SECONDS', 60, 15, 300) * 1000,
    voteMs: bounded('VOTE_SECONDS', 45, 15, 180) * 1000, autoVote: env.AUTO_VOTE !== 'false',
  };
  return { demo, mode, apiKey, showtime, model: env.CODEX_MODEL || undefined, port, autoApprove: env.AUTO_APPROVE === 'true', attemptTimeoutMs, production: args.includes('--production'), twitch: twitchConfig(env, demo), moderationKey, moderationMode } as const;
}
