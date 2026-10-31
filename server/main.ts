import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { loadConfig } from './config';
import { PROJECT_ROOT } from './gate/files';
import { buildRuntime, loadHouse, prepareWorkspace, saveJob, verifyWorkspace } from './forge/artifacts';
import { ForgeCoordinator, gateSummary } from './forge/coordinator';
import { CodexAgent } from './forge/codex-agent';
import { ReplayAgent } from './demo/replay-agent';
import { DEMO_REQUESTS } from './demo/requests';
import { DemoCrowd } from './demo/crowd';
import { createForgeHttp } from './http';
import { TwitchService } from './twitch/service';
import { createModerator } from './moderation';
import { FightHistory } from './showtime/history';
import { Showtime } from './showtime/showtime';
import { diagnostics } from './showtime/diagnostics';

const config = loadConfig();
console.log('Preparing runtime and independently checking house fallbacks…');
await buildRuntime();
const house = (await loadHouse()).map((boss) => ({ id: boss.id, jobId: null, mode: 'house' as const, threadId: null, spec: boss.spec, gate: gateSummary(boss.report) }));
const agent = config.mode === 'codex' ? new CodexAgent(config.apiKey, config.model) : new ReplayAgent();
const coordinator = new ForgeCoordinator({
  agent, verify: verifyWorkspace, save: saveJob, moderate: createModerator(config.moderationMode, config.moderationKey),
  prepare: (job, rematch) => prepareWorkspace(job, PROJECT_ROOT, rematch ?? null),
}, house, config);

// Stream show: recaps, Rematch Patch, chat polls and the Hall of Fame. Demo history is kept separate
// so simulated fights never mix with a real channel's record.
const history = new FightHistory(join(PROJECT_ROOT, '.artifacts', 'showtime', config.demo ? 'history-demo.json' : 'history.json'));
const showtime = new Showtime(coordinator, history, config.showtime);
await showtime.start();
const twitch = config.twitch ? new TwitchService(coordinator, config.twitch, {}, showtime) : null;

const http = createForgeHttp(coordinator, config.port, config.production, {
  showtime,
  twitchTest: twitch ? () => twitch.testMessage() : null,
  diagnostics: () => diagnostics(config, coordinator.snapshot(), history.all().length),
});
const vite = config.production ? null : await createViteServer({
  configFile: `${PROJECT_ROOT}/vite.config.ts`, appType: 'mpa',
  server: { middlewareMode: true, ws: { server: http.server }, fs: {
    strict: true, allow: ['web', 'engine', 'bosses', 'node_modules'].map((path) => `${PROJECT_ROOT}/${path}`),
    deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.artifacts/**', `${PROJECT_ROOT.replaceAll('\\', '/')}/forge/**`],
  } },
});
if (vite) http.setFrontend(vite.middlewares);
await new Promise<void>((resolve, reject) => { http.server.once('error', reject); http.server.listen(config.port, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${config.port}`;
console.log(`Boss Forge is ready.
  Setup checklist:  ${base}/setup/
  Forge console:    ${base}/forge/
  Arena (capture):  ${base}/play/
  OBS overlay:      ${base}/overlay/  (Browser Source, 1920×1080)
Mode: ${config.mode === 'replay' ? 'CACHED OFFLINE REPLAY — no live Codex generation' : 'LIVE CODEX'}
Twitch: ${config.demo ? 'SIMULATED VIEWERS — disconnected' : config.twitch ? 'starting' : 'disabled'}. Moderation: ${config.moderationMode === 'api' ? 'API checks enabled' : 'MANUAL REVIEW — no API moderation'}.
Show: rematch needs ${config.showtime.rematchVotes} vote(s); chat polls ${config.showtime.autoVote ? 'start automatically' : 'are manual'}.`);
await twitch?.start();
if (config.demo) coordinator.onFightFinished((fight, outcome) => {
  if (outcome !== 'skipped') coordinator.notify(`Demo: ${fight.boss.spec.meta.name} ended. Clip and marker preview only; nothing was sent to Twitch.`, 'info', 'demo');
});
const crowd = config.demo ? new DemoCrowd(coordinator, showtime) : null;
crowd?.start();
let timer: ReturnType<typeof setTimeout> | undefined;
let index = 0;
async function simulateChat() {
  const request = DEMO_REQUESTS[index]; if (!request) return;
  try { await coordinator.submit({ creator: request.creator, text: request.text }, 'demo'); coordinator.notify(`Simulated viewer @${request.creator} sent a boss idea.`, 'info', 'demo'); index++; }
  catch { console.log('Demo feed is waiting for forge capacity.'); }
  if (index < DEMO_REQUESTS.length) timer = setTimeout(() => { void simulateChat(); }, 20000);
}
if (config.demo) timer = setTimeout(() => { void simulateChat(); }, 1500);
let closing = false;
async function close() {
  if (closing) return; closing = true; if (timer) clearTimeout(timer);
  crowd?.close(); await showtime.close();
  await coordinator.close(); await twitch?.close(); await vite?.close(); await http.close();
}
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
