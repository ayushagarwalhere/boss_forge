import { animateTextSwaps, bindTilt, mountPlatformBadge, playEntrance, prefersReducedMotion } from '../shared/motion';
import { ARENA, TICK_RATE } from '../../engine/constants';
import { createGame, stepGame, type Input } from '../../engine/simulation';
import { houseBosses } from './house-bosses';
import { Effects, renderGame } from './renderer';
import { SoundBoard } from './audio';
import type { ForgeFight, ForgeSnapshot } from '../../engine/forge-protocol';
import { ForgeClient } from '../shared/forge-client';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}
const canvas = element<HTMLCanvasElement>('arena');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is required to play Boss Forge.');
const ctx = context;
const curtain = element('curtain'), start = element<HTMLButtonElement>('start');
const title = element('curtain-title'), copy = element('curtain-copy'), label = element('curtain-label'), hint = element('curtain-hint');
const seedInput = element<HTMLInputElement>('seed'), difficultyInput = element<HTMLSelectElement>('difficulty');
const pauseButton = element<HTMLButtonElement>('pause');
const hearts = element('hearts'), clock = element('clock'), bulletCount = element('bullet-count'), phase = element('phase');
let selected = 0;
let seed = 314159;
let currentSpec = houseBosses[selected]!;
let fight: ForgeFight | null = null;
let origin = 'HOUSE BOSS / 01';
let verification = '';
let game = createGame(currentSpec, seed);
let effects = new Effects();
let lobby = true;
let paused = false;
let keys = new Set<string>();
let accumulator = 0, previousTime = 0;
let toastUntil = 0;
const buttons: HTMLButtonElement[] = [];
const sound = new SoundBoard();
const soundButton = element<HTMLButtonElement>('sound');
function renderSoundButton() { soundButton.firstChild!.textContent = sound.enabled ? '♪ Sound on ' : '♪ Sound off '; soundButton.setAttribute('aria-pressed', String(sound.enabled)); }
soundButton.addEventListener('click', () => { sound.unlock(); sound.toggle(); renderSoundButton(); });
const tags = ['HEAVY / FIRE RINGS', 'SWARM / FAST FOOTWORK', 'SNIPER / LOCKED LASERS'];
const icons = ['⬡', '◉', '◇'];

houseBosses.forEach((boss, index) => {
  const button = document.createElement('button');
  button.className = 'boss-option'; button.setAttribute('aria-pressed', String(index === selected));
  const icon = document.createElement('span'); icon.className = 'boss-icon'; icon.textContent = icons[index]!;
  icon.style.setProperty('--boss-color', boss.look.palette[0]!); icon.style.setProperty('--boss-bg', `${boss.look.palette[0]}0D`);
  const info = document.createElement('span'); info.className = 'boss-info';
  const name = document.createElement('strong'); name.textContent = boss.meta.name;
  const tag = document.createElement('small'); tag.textContent = tags[index]!;
  const mark = document.createElement('span'); mark.className = 'boss-choice-mark'; mark.textContent = '↗';
  info.append(name, tag); button.append(icon, info, mark);
  button.addEventListener('click', () => {
    if (fight) { const old = fight; fight = null; void client.post('finish', { id: old.id, outcome: 'skipped' }).catch(() => {}); }
    selected = index; currentSpec = houseBosses[index]!; origin = `HOUSE BOSS / 0${index + 1}`; verification = ''; reset();
  });
  element('boss-list').append(button); buttons.push(button);
});

function clearInput() { keys = new Set(); accumulator = 0; }
function showCurtain(heading: string, message: string, action: string, eyebrow: string) {
  curtain.hidden = false; title.textContent = heading; copy.textContent = message; start.textContent = action; start.hidden = false;
  label.textContent = eyebrow; hint.textContent = 'Autofire is on. You take care of surviving.';
}
function reset() {
  game = createGame(currentSpec, seed, Number(difficultyInput.value));
  seedInput.value = String(seed); seedInput.setCustomValidity('');
  effects = new Effects(); lobby = true; paused = false; clearInput();
  pauseButton.disabled = true; pauseButton.textContent = 'Pause';
  buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(origin.startsWith('HOUSE') && index === selected)));
  element('boss-quote').textContent = `“${game.spec.meta.sourceQuote}”`;
  element('boss-reading').replaceChildren(...game.spec.meta.reading.map((reading) => {
    const li = document.createElement('li'); li.textContent = reading; return li;
  }));
  element('seed-label').textContent = `SEED ${seed}`;
  showCurtain(game.spec.meta.name, game.spec.taunts.intro, 'Enter arena ↗', origin);
  element('forged-verification').textContent = verification;
  element('game-toast').textContent = '';
  updateHUD();
}
function togglePause() {
  if (lobby || game.status === 'won' || game.status === 'lost') return;
  paused = !paused; clearInput();
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  if (paused) showCurtain('Take a breath.', 'Your fight will be right here.', 'Resume fight ↗', 'PAUSED');
  else { curtain.hidden = true; canvas.focus({ preventScroll: true }); }
  updateHUD();
}
start.addEventListener('click', () => {
  if (!applySeed()) return;
  if (paused) { togglePause(); return; }
  if (game.status === 'won' || game.status === 'lost') reset();
  sound.unlock(); if (game.status === 'intro' && game.tick === 0) sound.play('start');
  lobby = false; clearInput(); curtain.hidden = true; pauseButton.disabled = false;
  canvas.focus({ preventScroll: true });
});
element('restart').addEventListener('click', reset);
pauseButton.addEventListener('click', togglePause);
difficultyInput.addEventListener('change', reset);
function applySeed(): boolean {
  const value = Number(seedInput.value);
  if (!seedInput.value || !Number.isInteger(value) || value < 0 || value > 4294967295) {
    seedInput.setCustomValidity('Use an integer from 0 to 4294967295.'); seedInput.reportValidity(); return false;
  }
  seedInput.setCustomValidity('');
  if (value !== seed) { seed = value; reset(); }
  return true;
}
seedInput.addEventListener('change', applySeed);
seedInput.addEventListener('blur', applySeed);
seedInput.addEventListener('input', () => seedInput.setCustomValidity(''));
element('new-seed').addEventListener('click', () => {
  seed = crypto.getRandomValues(new Uint32Array(1))[0]!; seedInput.value = String(seed); reset();
});
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
  const key = event.code;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(key)) event.preventDefault();
  if (!event.repeat && (key === 'KeyP' || key === 'Escape')) togglePause();
  if (!event.repeat && key === 'KeyR') reset();
  if (!event.repeat && key === 'KeyM') { sound.unlock(); sound.toggle(); renderSoundButton(); }
  keys.add(key);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => { clearInput(); if (!paused && !lobby && (game.status === 'playing' || game.status === 'intro')) togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (!paused && !lobby && (game.status === 'playing' || game.status === 'intro')) togglePause(); } });

function input(): Input {
  let x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  let y = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  let focus = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const pad = navigator.getGamepads?.().find((gamepad) => gamepad?.connected);
  if (pad) {
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    if (Math.abs(ax) > 0.15) x = ax;
    if (Math.abs(ay) > 0.15) y = ay;
    x += Number(pad.buttons[15]?.pressed ?? false) - Number(pad.buttons[14]?.pressed ?? false);
    y += Number(pad.buttons[13]?.pressed ?? false) - Number(pad.buttons[12]?.pressed ?? false);
    focus ||= !!pad.buttons[0]?.pressed || !!pad.buttons[6]?.pressed;
  }
  return { x, y, focus };
}
function updateHUD() {
  hearts.textContent = Array.from({ length: 3 }, (_, index) => index < game.player.hearts ? '♥' : '♡').join(' ');
  hearts.setAttribute('aria-label', `${game.player.hearts} hearts`);
  const seconds = Math.floor(game.tick / TICK_RATE);
  clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  bulletCount.replaceChildren(document.createTextNode(`${String(game.bullets.length).padStart(3, '0')} `), Object.assign(document.createElement('small'), { textContent: '/ 400' }));
  phase.replaceChildren(document.createTextNode(`${String(game.boss.phase + 1).padStart(2, '0')} `), Object.assign(document.createElement('small'), { textContent: `/ ${String(game.spec.phases.length).padStart(2, '0')}` }));
  element('round-status').textContent = lobby ? 'READY WHEN YOU ARE' : paused ? 'PAUSED' : game.status === 'intro' ? 'INCOMING BOSS' : game.status === 'playing' ? 'FIGHT IN PROGRESS' : game.status === 'won' ? 'BOSS DEFEATED' : 'ROUND OVER';
}
let hudTick = -1;
function frame(milliseconds: number) {
  const dt = previousTime ? Math.min((milliseconds - previousTime) / 1000, 0.1) : 0;
  previousTime = milliseconds;
  if (!paused && !lobby) {
    accumulator += dt;
    while (accumulator >= 1 / TICK_RATE) {
      stepGame(game, input()); accumulator -= 1 / TICK_RATE; effects.consume(game);
      for (const event of game.events) {
        sound.play(event.kind);
        if (event.kind === 'hit' || event.kind === 'phase') { element('game-toast').textContent = event.text; toastUntil = milliseconds + 2200; }
      }
      if (game.status === 'won' || game.status === 'lost') {
        if (curtain.hidden) {
          const won = game.status === 'won';
          showCurtain(won ? 'Forged. Fought. Finished.' : 'One more round?', won ? game.spec.taunts.onDeath : `Defeated by ${game.spec.meta.name}.`, 'Run it back ↗', won ? 'BOSS DEFEATED' : 'YOU WERE DEFEATED');
          hint.textContent = 'Same seed. Learn the pattern. Make it count.'; pauseButton.disabled = true;
          if (fight) { const ended = fight; fight = null; void client.post('finish', { id: ended.id, outcome: game.status }).catch(() => { element('game-toast').textContent = 'Fight finished locally. Use the forge console to clear a disconnected fight.'; toastUntil = performance.now() + 5000; }); }
        }
        accumulator = 0; break;
      }
    }
    if (game.status === 'intro') { element('game-toast').textContent = `${game.spec.meta.name.toUpperCase()}\n${game.spec.taunts.intro}`; toastUntil = milliseconds + 500; }
  }
  if (milliseconds > toastUntil) element('game-toast').textContent = '';
  if (!paused) effects.update(dt);
  if (hudTick !== Math.floor(milliseconds / 100)) { updateHUD(); hudTick = Math.floor(milliseconds / 100); }
  renderGame(ctx, game, paused ? game.tick / TICK_RATE : milliseconds / 1000, effects, lobby);
  requestAnimationFrame(frame);
}
// Keep the simulation's coordinate system independent of CSS size and display density.
canvas.width = ARENA.width; canvas.height = ARENA.height;
const claimButton = element<HTMLButtonElement>('claim-forged');
const client = new ForgeClient((state: ForgeSnapshot) => {
  claimButton.disabled = !!state.activeFight;
  claimButton.textContent = state.queue.length ? `Fight next forged boss (${state.queue.length}) ↗` : 'Fight a verified house boss ↗';
  element('forge-state').textContent = `${state.mode === 'replay' ? 'CACHED REPLAY · no live Codex' : 'LIVE CODEX'} · ${state.queue.length} queued${state.activeFight ? ' · a fight is active' : ''}.`;
}, (online) => { forgeOnline = online; if (!online) { claimButton.disabled = true; element('forge-state').textContent = 'House play is available. Start npm run demo to connect the forge.'; } });
claimButton.addEventListener('click', () => {
  claimButton.disabled = true;
  void client.claim().then((next) => {
    fight = next; currentSpec = next.boss.spec; seed = next.seed;
    if (next.boss.mode === 'house') { const index = houseBosses.findIndex((boss) => boss.meta.name === currentSpec.meta.name); if (index >= 0) selected = index; }
    origin = next.boss.mode === 'replay' ? 'CACHED REPLAY / SERVER VERIFIED' : next.boss.mode === 'codex' ? 'LIVE CODEX / SERVER VERIFIED' : 'HOUSE FALLBACK / SERVER VERIFIED';
    verification = `${next.boss.gate.summary} (standard difficulty)`;
    reset(); canvas.focus({ preventScroll: true });
  }).catch((error: unknown) => { element('forge-state').textContent = error instanceof Error ? error.message : 'Cannot claim the next boss.'; claimButton.disabled = false; });
});
window.addEventListener('pagehide', () => client.close());

// Live fight stats for the OBS overlay (display only; the server never trusts them for outcomes).
let forgeOnline = false, lastTelemetry = '', lastTelemetryAt = 0;
setInterval(() => {
  if (!forgeOnline) return;
  const payload = {
    fightId: fight?.id ?? null, boss: game.spec.meta.name.slice(0, 60), creator: game.spec.meta.creator.slice(0, 25),
    state: lobby ? 'lobby' : paused ? 'paused' : game.status, bossHp: Math.round((game.boss.hp / game.spec.hp) * 1000) / 1000,
    phase: game.boss.phase + 1, phases: game.spec.phases.length, hearts: game.player.hearts,
    seconds: Math.min(3600, Math.floor(game.tick / TICK_RATE)), bullets: Math.min(1000, game.bullets.length),
  };
  const key = JSON.stringify({ ...payload, bullets: Math.round(payload.bullets / 25) });
  if (key === lastTelemetry && performance.now() - lastTelemetryAt < 3000) return;
  lastTelemetry = key; lastTelemetryAt = performance.now();
  void client.post('telemetry', payload).catch(() => {});
}, 250);
reset();
renderSoundButton();
requestAnimationFrame(frame);

// Page motion: entrance, platform badge, tilt on boss picks, animated curtain title.
mountPlatformBadge();
playEntrance('.arena-panel, .sidebar > *');
if (!prefersReducedMotion()) document.querySelectorAll<HTMLElement>('.boss-option').forEach((option) => bindTilt(option, 8));
animateTextSwaps(document.getElementById('curtain-title')!);
