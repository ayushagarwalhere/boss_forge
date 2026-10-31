import { config as dotenv } from 'dotenv';
import { join } from 'node:path';
import { PROJECT_ROOT } from './gate/files';

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
  const moderationKey = env.OPENAI_API_KEY || env.CODEX_API_KEY || '';
  const blocklist = (env.MODERATION_BLOCKLIST || '').split(',').map((word) => word.trim().toLowerCase()).filter(Boolean).slice(0, 200);
  return { demo, mode, apiKey, moderationKey, blocklist, model: env.CODEX_MODEL || undefined, port, autoApprove: env.AUTO_APPROVE === 'true', attemptTimeoutMs, production: args.includes('--production') } as const;
}
