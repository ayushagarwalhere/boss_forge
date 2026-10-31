import { gsap } from 'gsap';
import type { ForgeSnapshot, ShowtimeState } from '../../engine/forge-protocol';

// Broadcast layer for the stream show. Viewer-provided strings are only ever set as textContent.
function el<T extends HTMLElement = HTMLElement>(id: string) { const element = document.getElementById(id); if (!element) throw new Error(`Missing ${id}`); return element as T; }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = '') { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; }
const left = (endsAt: number) => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RECAP_MS = 14000, ANNOUNCE_MS = 9000;

function reveal(element: HTMLElement, show: boolean, from: gsap.TweenVars) {
  if (show === !element.hidden) return;
  gsap.killTweensOf(element);
  if (show) { element.hidden = false; if (!reduced) gsap.fromTo(element, from, { y: 0, x: 0, scale: 1, autoAlpha: 1, rotationX: 0, duration: 0.7, ease: 'back.out(1.5)' }); }
  else if (reduced) element.hidden = true;
  else gsap.to(element, { autoAlpha: 0, y: -20, duration: 0.35, ease: 'power2.in', onComplete: () => { element.hidden = true; gsap.set(element, { clearProps: 'all' }); } });
}

export class OverlayShowtime {
  private show: ShowtimeState | null = null;
  private keys = { rematch: '', recap: '', vote: '', hall: '', announce: '' };
  private readonly timer = setInterval(() => this.tick(), 500);

  render(state: ForgeSnapshot) { this.show = state.showtime; this.tick(); }

  private tick() {
    const show = this.show; if (!show) return;
    this.renderRematch(show); this.renderRecap(show); this.renderVote(show); this.renderHall(show); this.renderAnnouncement(show);
  }

  private renderRematch(show: ShowtimeState) {
    const box = el('show-rematch'), rematch = show.rematch;
    reveal(box, !!rematch && rematch.status !== 'expired', { y: -60, autoAlpha: 0, rotationX: -50, transformPerspective: 800 });
    if (!rematch) return;
    box.dataset.status = rematch.status;
    const key = `${rematch.fightId}:${rematch.status}:${rematch.votes}`;
    if (key !== this.keys.rematch) {
      this.keys.rematch = key;
      const title = rematch.status === 'open' ? 'REMATCH?' : rematch.status === 'forging' ? 'REMATCH PATCH IN THE FORGE' : rematch.status === 'queued' ? 'REMATCH READY' : 'REMATCH REJECTED';
      const meter = node('div', '', 'show-meter'), fill = node('i', '');
      fill.style.transform = `scaleX(${Math.min(1, rematch.votes / rematch.needed)})`; meter.append(fill);
      box.replaceChildren(node('p', title, 'eyebrow'), node('h2', `${rematch.boss} → ${rematch.nextName.replace(rematch.boss.replace(/\s+MK\s+[IVX]+$/i, ''), '').trim() || rematch.nextName}`), node('p', rematch.status === 'open' ? `Type !rematch · ${rematch.votes}/${rematch.needed} · or @${rematch.creator} calls it` : rematch.message, 'show-sub'), ...(rematch.status === 'open' ? [meter, node('span', '', 'show-count')] : []));
      if (!reduced && rematch.status === 'open' && rematch.votes > 0) gsap.fromTo(box, { scale: 1.04 }, { scale: 1, duration: 0.4, ease: 'elastic.out(1, 0.4)' });
    }
    const count = box.querySelector<HTMLElement>('.show-count');
    if (count) count.textContent = `${left(rematch.endsAt)}s`;
  }

  private renderRecap(show: ShowtimeState) {
    const box = el('show-recap'), recap = show.recap;
    const visible = !!recap && Date.now() - recap.at < RECAP_MS;
    reveal(box, visible, { scale: 0.85, autoAlpha: 0, y: 40 });
    if (!recap || recap.id === this.keys.recap) return;
    this.keys.recap = recap.id;
    const won = recap.outcome === 'won';
    box.dataset.outcome = recap.outcome;
    const stats = recap.stats;
    const grid = node('div', '', 'recap-stats');
    const cells: Array<[string, string]> = stats ? [
      [`${Math.floor(stats.seconds / 60)}:${String(stats.seconds % 60).padStart(2, '0')}`, 'FIGHT TIME'],
      [`${stats.heartsLeft}/3`, 'HEARTS LEFT'], [`${Math.round(stats.bossHpLeft * 100)}%`, 'BOSS HP LEFT'], [`${stats.phaseReached}`, 'PHASE REACHED'],
    ] : [];
    for (const [value, label] of cells) { const cell = node('div', ''); cell.append(node('strong', value), node('small', label)); grid.append(cell); }
    box.replaceChildren(
      node('p', won ? 'BOSS DEFEATED' : 'STREAMER DEFEATED', 'eyebrow'),
      node('h2', recap.boss),
      node('p', won ? `GG @${recap.creator}. The streamer survives.` : `@${recap.creator}'s boss wins this round!`, 'show-sub'),
      grid,
      node('p', `RECORD ${show.hall.wins}–${show.hall.losses}${recap.generation > 1 ? ` · REMATCH UPGRADE` : ''} · ${recap.mode === 'codex' ? 'LIVE CODEX' : recap.mode === 'replay' ? 'CACHED REPLAY' : 'HOUSE'}`, 'recap-foot'),
    );
  }

  private renderVote(show: ShowtimeState) {
    const box = el('show-vote'), vote = show.vote;
    reveal(box, !!vote, { x: 40, autoAlpha: 0 });
    if (!vote) return;
    const votes = vote.options.reduce((sum, option) => sum + option.votes, 0), total = Math.max(1, votes);
    const key = `${vote.id}:${vote.closed}:${vote.options.map((option) => option.votes).join(',')}`;
    if (key !== this.keys.vote) {
      const fresh = !this.keys.vote.startsWith(vote.id);
      this.keys.vote = key;
      const rows = vote.options.map((option, index) => {
        const row = node('div', '', `vote-row${vote.winner === index ? ' winner' : ''}`), bar = node('i', '');
        row.append(bar, node('b', `!vote ${index + 1}`), node('span', option.name), node('em', String(option.votes)));
        if (reduced || fresh) bar.style.transform = `scaleX(${option.votes / total})`;
        else gsap.fromTo(bar, { scaleX: Number(box.querySelectorAll<HTMLElement>('.vote-row i')[index]?.dataset.share ?? 0) }, { scaleX: option.votes / total, duration: 0.5, ease: 'power2.out' });
        bar.dataset.share = String(option.votes / total);
        return row;
      });
      box.replaceChildren(node('p', vote.closed ? 'CHAT HAS SPOKEN' : 'CHAT PICKS THE NEXT BOSS', 'eyebrow'), ...rows, node('p', '', 'vote-foot'));
    }
    box.querySelector<HTMLElement>('.vote-foot')!.textContent = vote.closed ? 'The winner fights next.' : `${left(vote.endsAt)}s left · ${votes} vote${votes === 1 ? '' : 's'}`;
  }

  private renderHall(show: ShowtimeState) {
    const hall = show.hall, key = JSON.stringify([hall.wins, hall.losses, hall.creators.slice(0, 3)]);
    if (key === this.keys.hall) return; this.keys.hall = key;
    const box = el('show-hall');
    const top = hall.creators.slice(0, 3).map((entry, index) => { const row = node('li', ''); row.append(node('span', `${index + 1}`), node('b', `@${entry.creator}`), node('em', `${entry.streamerDefeats}★`)); return row; });
    const list = node('ol', ''); list.append(...top);
    box.replaceChildren(node('h2', 'HALL OF FAME'), node('p', `STREAMER ${hall.wins}–${hall.losses}${hall.streak ? ` · ${Math.abs(hall.streak)} ${hall.streak > 0 ? 'W' : 'L'} STREAK` : ''}`, 'hall-record'), ...(top.length ? [list] : [node('p', 'Beat the streamer to get on the board. !top', 'hall-empty')]));
  }

  private renderAnnouncement(show: ShowtimeState) {
    const box = el('show-announce'), latest = show.announcements.at(-1);
    const visible = !!latest && Date.now() - latest.at < ANNOUNCE_MS;
    reveal(box, visible, { y: 30, autoAlpha: 0 });
    if (latest && latest.id !== this.keys.announce) { this.keys.announce = latest.id; box.textContent = latest.text; }
  }

  close() { clearInterval(this.timer); }
}
