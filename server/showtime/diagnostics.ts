import type { ForgeSnapshot } from '../../engine/forge-protocol';
import type { loadConfig } from '../config';

type Config = ReturnType<typeof loadConfig>;
export type CheckStatus = 'ok' | 'warn' | 'off' | 'error';
export interface SetupCheck { id: string; label: string; status: CheckStatus; detail: string; fix?: string }

/** Streamer-facing readiness checklist. Never includes keys, tokens or file contents. */
export function diagnostics(config: Config, snapshot: ForgeSnapshot, historyCount: number, platform = process.platform, nodeVersion = process.version) {
  const major = Number(/^v(\d+)/.exec(nodeVersion)?.[1] ?? 0);
  const checks: SetupCheck[] = [
    { id: 'node', label: 'Node.js', status: major >= 20 ? 'ok' : 'error', detail: `${nodeVersion} on ${platform}`, ...(major >= 20 ? {} : { fix: 'Install Node 22 LTS (see .nvmrc).' }) },
    config.mode === 'codex'
      ? { id: 'forge', label: 'Boss forge', status: platform === 'win32' ? 'warn' : 'ok', detail: `Live Codex${config.model ? ` (${config.model})` : ''}. Each boss is written in an isolated workspace and reverified by the server.`,
        ...(platform === 'win32' ? { fix: 'Native Windows needs MXC or the elevated Codex sandbox; see docs/forge.md. WSL also works.' } : {}) }
      : { id: 'forge', label: 'Boss forge', status: 'warn', detail: 'Cached replay: recorded house templates are replayed and reverified. No live Codex generation.', fix: 'Add CODEX_API_KEY (or OPENAI_API_KEY) to .env.local for live generation.' },
    { id: 'moderation', label: 'Viewer text moderation', status: config.moderationMode === 'api' ? 'ok' : 'warn',
      detail: config.moderationMode === 'api' ? 'API moderation checks every viewer brief before it is admitted.' : 'Manual review: every viewer request waits for your approval.',
      ...(config.moderationMode === 'api' ? {} : { fix: 'Set MODERATION_API_KEY or OPENAI_API_KEY to enable API checks (approval is still available).' }) },
    { id: 'approval', label: 'Approval', status: 'ok', detail: snapshot.autoApprove ? 'Auto-approve is on for API-passed requests.' : 'You approve requests on the forge console or with !approve in chat.' },
    twitchCheck(config, snapshot),
    { id: 'rewards', label: 'Channel Points reward', status: snapshot.twitch.reward === 'active' ? 'ok' : config.twitch ? 'warn' : 'off',
      detail: snapshot.twitch.reward === 'active' ? '“Forge a Boss” is live; failed requests are refunded.' : config.twitch ? 'Not active. Chat !boss still works.' : 'Needs Twitch (Affiliate/Partner).' },
    { id: 'show', label: 'Stream show', status: 'ok', detail: `Rematch needs ${config.showtime.rematchVotes} chat vote${config.showtime.rematchVotes === 1 ? '' : 's'} (or the creator / a mod). Polls ${config.showtime.autoVote ? 'start automatically between fights' : 'start from the console or !startvote'}. ${historyCount} fight${historyCount === 1 ? '' : 's'} in the Hall of Fame.` },
  ];
  const base = `http://127.0.0.1:${config.port}`;
  return {
    ready: checks.every((check) => check.status !== 'error'),
    live: !config.demo && snapshot.twitch.status === 'connected',
    mode: config.mode, demo: config.demo,
    urls: { forge: `${base}/forge/`, play: `${base}/play/`, overlay: `${base}/overlay/`, setup: `${base}/setup/` },
    checks,
  };
}

function twitchCheck(config: Config, snapshot: ForgeSnapshot): SetupCheck {
  if (config.demo) return { id: 'twitch', label: 'Twitch', status: 'off', detail: 'Demo mode uses simulated viewers and never connects to Twitch.', fix: 'For a real stream: follow docs/twitch.md, set TWITCH_ENABLED=true and run npm run server.' };
  if (!config.twitch) return { id: 'twitch', label: 'Twitch', status: 'off', detail: 'Disabled. Local requests and the overlay still work.', fix: 'Run npm run auth -- broadcaster and npm run auth -- bot, then set TWITCH_ENABLED=true (docs/twitch.md).' };
  const status = snapshot.twitch.status;
  return { id: 'twitch', label: 'Twitch', status: status === 'connected' ? 'ok' : status === 'error' ? 'error' : 'warn',
    detail: `${status === 'connected' ? `Connected to #${snapshot.twitch.channel}` : status}: ${snapshot.twitch.message}`,
    ...(status === 'error' ? { fix: 'Re-run npm run auth for both accounts, then restart.' } : {}) };
}
