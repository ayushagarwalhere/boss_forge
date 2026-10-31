import type { ForgeSnapshot } from '../../engine/forge-protocol';
import { ForgeClient } from '../shared/forge-client';
import { animateNewChildren, mountPlatformBadge, playEntrance } from '../shared/motion';

function el<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`Missing ${id}`); return element as T; }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
const message = el('form-message');
const client = new ForgeClient(render, (online) => { el('connection').textContent = online ? '● LOCAL CONNECTION' : '○ RECONNECTING'; });
let activeId: string | null = null;
async function action(path: string, data: unknown) {
  try { await client.post(path, data); message.textContent = ''; }
  catch (error) { message.textContent = error instanceof Error ? error.message : 'Local action failed.'; }
}
function render(state: ForgeSnapshot) {
  el('moderation-status').textContent = state.moderationMode === 'api' ? 'API MODERATION · Request text is checked before admission. Flagged or failed checks are not admitted.' : 'MANUAL REVIEW · No API moderation. Viewer requests always need approval; simulated demo ideas are preapproved.';
  el('twitch-status').textContent = `${state.twitch.status === 'demo' ? 'SIMULATED VIEWERS' : `TWITCH ${state.twitch.status.toUpperCase()}${state.twitch.channel ? ` / @${state.twitch.channel}` : ''}`} · ${state.twitch.message} · ${state.twitch.reward === 'active' ? 'Channel Points enabled.' : 'Channel Points inactive.'}`;
  el('chat-source').textContent = state.demo ? 'SIMULATED VIEWERS' : state.twitch.status === 'connected' ? 'TWITCH + LOCAL' : 'LOCAL REQUESTS';
  el('integration-toasts').replaceChildren(...state.toasts.slice(-3).reverse().map((toast) => node('p', `integration-toast ${toast.kind}`, `${toast.source === 'demo' ? 'DEMO / ' : ''}${toast.message}`)));
  el('mode-banner').classList.toggle('replay', state.mode === 'replay');
  el('mode-banner').textContent = state.mode === 'replay'
    ? 'CACHED REPLAY · No live Codex generation. Recorded house templates are replayed, then independently reverified by the server.'
    : 'LIVE CODEX · The agent writes boss.json in a restricted workspace. The server independently verifies every boss before queueing.';
  el('job-count').textContent = `${state.jobs.length} REQUESTS`;
  const priority = (status: string) => ['building', 'verifying'].includes(status) ? 0 : status === 'pending' ? 1 : status === 'waiting' ? 2 : 3;
  const jobs = [...state.jobs].sort((a, b) => priority(a.status) - priority(b.status) || b.createdAt - a.createdAt).slice(0, 15).map((job) => {
    const article = node('article', 'job'), top = node('div', 'job-top');
    top.append(node('span', 'job-user', `@${job.creator}`), node('span', `job-status ${job.status}`, job.status.toUpperCase()));
    article.append(top, node('blockquote', '', job.text));
    article.append(node('div', 'job-detail', `${job.mode === 'replay' ? 'CACHED REPLAY' : 'LIVE CODEX'} · ${job.source === 'demo' ? 'SIMULATED VIEWER' : job.source.toUpperCase()} · ATTEMPT ${job.attempt}/3`));
    article.append(node('p', 'job-detail', job.message));
    article.append(node('p', 'job-detail', job.moderation === 'api' ? 'API MODERATION PASSED' : job.moderation === 'demo' ? 'TRUSTED SIMULATED IDEA · NO API MODERATION' : 'MANUAL REVIEW · NO API MODERATION'));
    if (job.status === 'pending') article.append(node('code', 'job-detail', `!approve ${job.id}`));
    if (job.threadId) article.append(node('p', 'job-detail', `Thread ${job.threadId}`));
    if (job.gate && job.message !== job.gate.summary) article.append(node('p', 'job-detail', job.gate.summary));
    if (job.status === 'pending') {
      const controls = node('div', 'job-actions');
      for (const approve of [true, false]) { const button = node('button', '', approve ? 'Approve ↗' : 'Reject'); button.addEventListener('click', () => { void action('review', { id: job.id, approve }); }); controls.append(button); }
      article.append(controls);
    }
    return article;
  });
  el('jobs').replaceChildren(...(jobs.length ? jobs : [node('p', 'empty', 'Waiting for an idea. Simulated viewers arrive automatically in demo mode.')]));
  el('queue-count').textContent = `${state.queue.length} / 5`;
  el('queue').replaceChildren(...(state.queue.length ? state.queue.map((boss) => {
    const card = node('article', 'queue-card'); card.append(node('h3', '', boss.spec.meta.name), node('p', 'creator', `@${boss.spec.meta.creator} · ${boss.mode === 'replay' ? 'CACHED REPLAY' : 'LIVE CODEX'}`), node('p', 'verified', boss.gate.summary)); return card;
  }) : [node('p', 'empty', 'Verified bosses land here. House bosses fill the gaps.')]));
  el('ticker').replaceChildren(...[...state.events].reverse().slice(0, 30).map((event) => {
    const li = node('li', ''), time = node('time', '', new Date(event.at).toLocaleTimeString([], { hour12: false }));
    const text = node('div', ''); text.append(node('span', 'event-origin', `${event.mode === 'replay' ? 'CACHED REPLAY' : event.mode.toUpperCase()} / ${event.phase.toUpperCase()}`), document.createTextNode(event.message)); li.append(time, text); return li;
  }));
  el('chat').replaceChildren(...[...state.chat].reverse().slice(0, 15).map((chat) => {
    const p = node('p', ''); p.append(node('strong', '', `@${chat.creator}`), document.createTextNode(chat.text)); return p;
  }));
  activeId = state.activeFight?.id ?? null;
  el('active-fight').textContent = state.activeFight ? `${state.activeFight.boss.spec.meta.name} by @${state.activeFight.boss.spec.meta.creator}` : 'No fight active.';
  el('skip-fight').hidden = !activeId;
}
el<HTMLFormElement>('request-form').addEventListener('submit', (event) => {
  event.preventDefault(); const button = el<HTMLButtonElement>('submit-request'); button.disabled = true;
  void client.post('requests', { creator: el<HTMLInputElement>('creator').value, text: el<HTMLTextAreaElement>('description').value })
    .then(() => { message.textContent = 'Request received. Approve it below if review is required.'; el<HTMLTextAreaElement>('description').value = ''; })
    .catch((error: unknown) => { message.textContent = error instanceof Error ? error.message : 'Request failed.'; })
    .finally(() => { button.disabled = false; });
});
el('skip-fight').addEventListener('click', () => { if (activeId) void action('finish', { id: activeId, outcome: 'skipped' }); });
window.addEventListener('pagehide', () => client.close());

// Page motion: only rows the forge hasn't shown before animate in.
mountPlatformBadge();
playEntrance('.mode-banner, .forge-panel, .forge-rail > .build-note');
const text = (e: Element): string => e.textContent ?? '';
animateNewChildren(el('ticker'), text, { x: -28, autoAlpha: 0, duration: 0.6, ease: 'power3.out' });
animateNewChildren(el('chat'), text, { x: 24, autoAlpha: 0, duration: 0.5, ease: 'power3.out' });
animateNewChildren(el('queue'), (e) => e.querySelector('h3')?.textContent ?? text(e), { y: 24, rotationX: -40, transformPerspective: 600, autoAlpha: 0, duration: 0.8, ease: 'back.out(1.6)' });
animateNewChildren(el('jobs'), (e) => `${e.querySelector('.job-user')?.textContent}|${e.querySelector('blockquote')?.textContent}`, { y: 30, scale: 0.96, autoAlpha: 0, duration: 0.7, ease: 'expo.out' });
