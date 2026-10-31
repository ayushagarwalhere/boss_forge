import { gsap } from 'gsap';
import type { ForgeEvent, ForgeSnapshot } from '../../engine/forge-protocol';
import { codexSvg, twitchSvg } from '../shared/brand-marks';
import { ForgeClient } from '../shared/forge-client';

// Read-only OBS overlay. Everything here is display; viewer text is only ever set as textContent.
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
for (const el of document.querySelectorAll<HTMLElement>('[data-mark]')) el.innerHTML = el.dataset.mark === 'twitch' ? twitchSvg() : codexSvg();

const STAGES: ForgeEvent['phase'][] = ['request', 'review', 'reading', 'writing', 'testing', 'verifying', 'queued'];
const STAGE_LABEL: Partial<Record<ForgeEvent['phase'], string>> = { request: 'Request received', review: 'Approved', reading: 'Codex is reading the brief', writing: 'Codex is writing the boss', testing: 'Testing the patterns', revising: 'Revising after the gate', verifying: 'Bot is playing it 5×', queued: 'Verified', failed: 'Rejected' };

let lastSeq = -1;
let bossVisible = false;
let shownHp = 1;
let lastFightId: string | null = null;
let ready = false;

function showBanner(eyebrow: string, title: string, copy: string, tone: 'good' | 'bad' | 'neutral') {
  const banner = $('banner');
  $('banner-eyebrow').textContent = eyebrow; $('banner-title').textContent = title; $('banner-copy').textContent = copy;
  banner.dataset.tone = tone; banner.hidden = false;
  gsap.killTweensOf(banner);
  gsap.timeline()
    .fromTo(banner, { y: -40, scale: 0.92, autoAlpha: 0, rotationX: -40, transformPerspective: 800 }, { y: 0, scale: 1, autoAlpha: 1, rotationX: 0, duration: 0.7, ease: 'back.out(1.7)' })
    .to(banner, { y: -30, autoAlpha: 0, duration: 0.5, ease: 'power2.in', delay: 4.5, onComplete: () => { banner.hidden = true; } });
}

function setBossVisible(visible: boolean) {
  if (visible === bossVisible) return;
  bossVisible = visible;
  const boss = $('boss');
  gsap.killTweensOf(boss);
  if (visible) { boss.hidden = false; gsap.fromTo(boss, { y: -80, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, ease: 'expo.out' }); }
  else gsap.to(boss, { y: -80, autoAlpha: 0, duration: 0.5, ease: 'power2.in', onComplete: () => { boss.hidden = true; } });
}

function renderBoss(state: ForgeSnapshot) {
  const t = state.telemetry, fight = state.activeFight;
  const live = !!t && ['intro', 'playing', 'paused'].includes(t.state) && Date.now() - t.at < 15_000;
  setBossVisible(live);
  if (!t || !live) return;
  const forged = fight && t.fightId === fight.id ? fight.boss : null;
  $('boss-name').textContent = t.boss;
  $('boss-creator').textContent = `by @${t.creator}`;
  $('boss-origin').textContent = forged ? (forged.mode === 'codex' ? 'FORGED LIVE BY CODEX' : forged.mode === 'replay' ? 'CACHED FORGE REPLAY' : 'HOUSE BOSS') : 'PRACTICE ROUND';
  $('boss-gate').textContent = forged ? `✓ fairness gate · bot ${forged.gate.wins}/5` : '';
  $('phase').textContent = `PHASE ${t.phase}/${t.phases}${t.state === 'paused' ? ' · PAUSED' : ''}`;
  $('hearts').textContent = Array.from({ length: 3 }, (_, i) => (i < t.hearts ? '♥' : '♡')).join(' ');
  $('clock').textContent = `${String(Math.floor(t.seconds / 60)).padStart(2, '0')}:${String(t.seconds % 60).padStart(2, '0')}`;
  $('hp-text').textContent = `${Math.ceil(t.bossHp * 100)}%`;
  if (t.bossHp !== shownHp) {
    const dropped = t.bossHp < shownHp; shownHp = t.bossHp;
    gsap.to($('hp-fill'), { scaleX: t.bossHp, duration: 0.25, ease: 'power2.out' });
    gsap.to($('hp-ghost'), { scaleX: t.bossHp, duration: 0.9, delay: 0.25, ease: 'power3.inOut' });
    if (dropped) gsap.fromTo($('boss'), { x: -4 }, { x: 0, duration: 0.3, ease: 'elastic.out(1, 0.3)' });
  }
}

function renderForge(state: ForgeSnapshot) {
  const active = state.jobs.filter((job) => ['pending', 'waiting', 'building', 'verifying'].includes(job.status))
    .sort((a, b) => Number(b.status === 'building' || b.status === 'verifying') - Number(a.status === 'building' || a.status === 'verifying') || a.createdAt - b.createdAt);
  const job = active[0];
  const box = $('forging');
  if (!job) {
    if (box.dataset.job !== '') { box.dataset.job = ''; const p = document.createElement('p'); p.className = 'ov-empty'; p.textContent = `Waiting for chat’s worst idea.`; box.replaceChildren(p); }
    return;
  }
  const lastEvent = [...state.events].reverse().find((event) => event.jobId === job.id);
  const phase = job.status === 'pending' ? 'request' : lastEvent?.phase ?? 'request';
  const index = Math.max(0, STAGES.indexOf(phase === 'revising' ? 'testing' : phase));
  if (box.dataset.job !== job.id) {
    box.dataset.job = job.id;
    const who = document.createElement('p'); who.className = 'ov-who'; who.textContent = `@${job.creator}`;
    const quote = document.createElement('blockquote'); quote.textContent = `“${job.text.length > 120 ? `${job.text.slice(0, 117)}…` : job.text}”`;
    const stage = document.createElement('p'); stage.className = 'ov-stage'; stage.id = 'stage';
    const bar = document.createElement('div'); bar.className = 'ov-progress'; const fill = document.createElement('i'); fill.id = 'stage-fill'; bar.append(fill);
    const more = document.createElement('p'); more.className = 'ov-more'; more.id = 'forge-more';
    box.replaceChildren(who, quote, stage, bar, more);
    gsap.from(box.children, { y: 16, autoAlpha: 0, stagger: 0.06, duration: 0.5, ease: 'power3.out' });
  }
  $('stage').textContent = job.status === 'pending' ? 'Waiting for the streamer’s OK' : `${STAGE_LABEL[phase] ?? 'Forging'}${job.attempt > 1 ? ` · attempt ${job.attempt}/3` : ''}`;
  gsap.to($('stage-fill'), { scaleX: (index + 1) / STAGES.length, duration: 0.6, ease: 'power2.out' });
  $('forge-more').textContent = active.length > 1 ? `+${active.length - 1} more in line` : '';
}

function renderQueue(state: ForgeSnapshot) {
  const list = $('queue');
  const key = state.queue.map((boss) => boss.id).join('|');
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  if (!state.queue.length) { const li = document.createElement('li'); li.className = 'ov-empty'; li.textContent = 'House bosses fill the gaps.'; list.replaceChildren(li); return; }
  list.replaceChildren(...state.queue.slice(0, 3).map((boss) => {
    const li = document.createElement('li'), name = document.createElement('strong'), by = document.createElement('span');
    name.textContent = boss.spec.meta.name; by.textContent = `@${boss.spec.meta.creator}`;
    li.style.setProperty('--c', boss.spec.look.palette[0] ?? '#cbf579'); li.append(name, by); return li;
  }));
  gsap.from(list.children, { x: 30, autoAlpha: 0, stagger: 0.08, duration: 0.5, ease: 'power3.out' });
}

function announce(state: ForgeSnapshot) {
  for (const event of state.events) {
    if (event.seq <= lastSeq) continue;
    lastSeq = event.seq;
    if (!ready) continue; // don't replay history when OBS reloads the source
    const job = state.jobs.find((entry) => entry.id === event.jobId);
    if (event.phase === 'queued' && job) {
      const boss = state.queue.find((entry) => entry.jobId === job.id);
      showBanner('PASSED THE FAIRNESS GATE', boss?.spec.meta.name ?? 'New boss', `Designed by @${job.creator} · added to the queue`, 'good');
    } else if (event.phase === 'failed' && job) {
      showBanner('REJECTED BY THE GATE', `@${job.creator}’s boss`, 'Too unfair to ship. Try another idea.', 'bad');
    } else if (event.phase === 'fight' && event.message.includes('boss defeated')) {
      showBanner('BOSS DEFEATED', event.message.split(':')[0] ?? 'Victory', 'The streamer survives… for now.', 'good');
    } else if (event.phase === 'fight' && event.message.includes('streamer defeated')) {
      showBanner('STREAMER DOWN', event.message.split(':')[0] ?? 'Defeat', 'Chat wins this round.', 'bad');
    }
  }
  const fightId = state.activeFight?.id ?? null;
  if (ready && fightId && fightId !== lastFightId && state.activeFight) {
    showBanner('INCOMING BOSS', state.activeFight.boss.spec.meta.name, `Designed by @${state.activeFight.boss.spec.meta.creator}`, 'neutral');
  }
  lastFightId = fightId;
  ready = true;
}

function renderCta(state: ForgeSnapshot) {
  $('cta-command').textContent = state.twitch?.command ?? '!boss';
  $('cta-reward').textContent = state.twitch?.rewards === 'ready' ? `or redeem “${state.twitch.rewardTitle}” with channel points` : '';
}

let latest: ForgeSnapshot | null = null;
const client = new ForgeClient((state) => {
  latest = state;
  renderBoss(state); renderForge(state); renderQueue(state); renderCta(state); announce(state);
}, (online) => { $('conn').textContent = online ? '' : 'FORGE OFFLINE'; $('conn').hidden = online; });
window.addEventListener('pagehide', () => client.close());

// Idle motion: the call to action breathes so chat notices it.
gsap.to('#cta', { y: -6, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
gsap.from('.ov-brand, .ov-rail, .ov-cta', { y: 24, autoAlpha: 0, stagger: 0.12, duration: 0.9, ease: 'expo.out' });
// Hide the boss bar when the arena stops reporting (closed tab) for 15 s.
setInterval(() => { if (latest) renderBoss(latest); }, 5000);
