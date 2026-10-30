import { createServer as createViteServer } from 'vite';
import { loadConfig } from './config';
import { PROJECT_ROOT } from './gate/files';
import { buildRuntime, loadHouse, prepareWorkspace, saveJob, verifyWorkspace } from './forge/artifacts';
import { ForgeCoordinator, gateSummary } from './forge/coordinator';
import { CodexAgent } from './forge/codex-agent';
import { ReplayAgent } from './demo/replay-agent';
import { DEMO_REQUESTS } from './demo/requests';
import { createForgeHttp } from './http';

const config = loadConfig();
console.log('Preparing runtime and independently checking house fallbacks…');
await buildRuntime();
const house = (await loadHouse()).map((boss) => ({ id: boss.id, jobId: null, mode: 'house' as const, threadId: null, spec: boss.spec, gate: gateSummary(boss.report) }));
const agent = config.mode === 'codex' ? new CodexAgent(config.apiKey, config.model) : new ReplayAgent();
const coordinator = new ForgeCoordinator({ agent, prepare: prepareWorkspace, verify: verifyWorkspace, save: saveJob }, house, config);
const http = createForgeHttp(coordinator, config.port, config.production);
const vite = config.production ? null : await createViteServer({
  configFile: `${PROJECT_ROOT}/vite.config.ts`, appType: 'mpa',
  server: { middlewareMode: true, ws: { server: http.server }, fs: {
    strict: true, allow: ['web', 'engine', 'bosses', 'node_modules'].map((path) => `${PROJECT_ROOT}/${path}`),
    deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.artifacts/**', `${PROJECT_ROOT.replaceAll('\\', '/')}/forge/**`],
  } },
});
if (vite) http.setFrontend(vite.middlewares);
await new Promise<void>((resolve, reject) => { http.server.once('error', reject); http.server.listen(config.port, '127.0.0.1', resolve); });
console.log(`Boss Forge: http://127.0.0.1:${config.port}/forge/\nPlay: http://127.0.0.1:${config.port}/play/\nMode: ${config.mode === 'replay' ? 'CACHED OFFLINE REPLAY — no live Codex generation' : 'LIVE CODEX'}\nTwitch and API moderation are not connected in M3.`);
let timer: ReturnType<typeof setTimeout> | undefined;
let index = 0;
async function simulateChat() {
  const request = DEMO_REQUESTS[index]; if (!request) return;
  try { await coordinator.submit({ creator: request.creator, text: request.text }, 'demo'); index++; }
  catch { console.log('Demo feed is waiting for forge capacity.'); }
  if (index < DEMO_REQUESTS.length) timer = setTimeout(() => { void simulateChat(); }, 20000);
}
if (config.demo) timer = setTimeout(() => { void simulateChat(); }, 1500);
let closing = false;
async function close() {
  if (closing) return; closing = true; if (timer) clearTimeout(timer);
  await coordinator.close(); await vite?.close(); await http.close();
}
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
