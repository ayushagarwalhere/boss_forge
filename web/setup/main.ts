import { z } from 'zod';
import { ForgeClient } from '../shared/forge-client';
import { mountPlatformBadge, playEntrance } from '../shared/motion';

const Diagnostics = z.object({
  ready: z.boolean(), live: z.boolean(), mode: z.enum(['codex', 'replay']), demo: z.boolean(),
  urls: z.object({ forge: z.string(), play: z.string(), overlay: z.string(), setup: z.string() }),
  checks: z.array(z.object({ id: z.string(), label: z.string(), status: z.enum(['ok', 'warn', 'off', 'error']), detail: z.string(), fix: z.string().optional() })),
});
type Diagnostics = z.infer<typeof Diagnostics>;

function el<T extends HTMLElement = HTMLElement>(id: string) { const element = document.getElementById(id); if (!element) throw new Error(`Missing ${id}`); return element as T; }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; }
const STATUS_LABEL = { ok: 'READY', warn: 'CHECK', off: 'OFF', error: 'FIX' } as const;

function render(data: Diagnostics) {
  const verdict = el('verdict');
  verdict.className = `verdict ${data.ready ? (data.live ? 'live' : 'ready') : 'blocked'}`;
  verdict.textContent = !data.ready ? 'Something needs fixing before you go live. See the items marked FIX.'
    : data.live ? 'You are live-ready: Twitch chat is connected and the forge is running.'
      : data.demo ? 'Demo mode: everything works with simulated viewers. Connect Twitch when you want real chat.'
        : 'Ready for local play. Connect Twitch (docs/twitch.md) to let your chat in.';
  el('checks').replaceChildren(...data.checks.map((check) => {
    const item = node('li', `check ${check.status}`), body = node('div', '');
    body.append(node('strong', '', check.label), node('p', '', check.detail));
    if (check.fix) body.append(node('p', 'fix', `→ ${check.fix}`));
    item.append(node('span', 'dot'), body, node('span', 'badge', STATUS_LABEL[check.status]));
    return item;
  }));
  el('url-play').textContent = data.urls.play; el('url-overlay').textContent = data.urls.overlay; el('url-forge').textContent = data.urls.forge;
}

async function refresh() {
  try {
    const response = await fetch('/api/diagnostics', { cache: 'no-store' });
    if (!response.ok) throw new Error('unavailable');
    render(Diagnostics.parse(await response.json()));
  } catch {
    el('verdict').className = 'verdict blocked';
    el('verdict').textContent = 'The local server is not running. Start it with npm run demo (no accounts) or npm run server.';
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh() { if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, 2000); }
const client = new ForgeClient(() => scheduleRefresh(), (online) => { el('connection').textContent = online ? '● LOCAL SERVER' : '○ OFFLINE'; });
const result = el('test-result');
async function run(path: string, body: unknown, success: string) {
  result.className = 'test-result';
  try { await client.post(path, body); result.textContent = success; result.classList.add('ok'); }
  catch (error) { result.textContent = error instanceof Error ? error.message : 'That test failed.'; result.classList.add('bad'); }
}
el('test-overlay').addEventListener('click', () => { void run('showtime/preview', {}, 'Sent. The overlay should show a banner and a toast within a second.'); });
el('test-idea').addEventListener('click', () => { void run('requests', { creator: 'setup_test', text: 'A polite toaster that fires slow rings of crumbs and taunts in puns.' }, 'Sample idea submitted. Approve it on the forge console.'); });
el('test-twitch').addEventListener('click', () => { void run('twitch/test', {}, 'Sent! Check your Twitch chat.'); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', () => {
    const text = el(button.dataset.copy!).textContent ?? '';
    void navigator.clipboard?.writeText(text).then(() => { button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1500); }).catch(() => { button.textContent = 'Select it'; });
  });
}
window.addEventListener('pagehide', () => client.close());
void refresh();
mountPlatformBadge();
playEntrance('.verdict, .setup-card');
