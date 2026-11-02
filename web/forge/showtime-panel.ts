import type { ForgeSnapshot } from '../../engine/forge-protocol';

type Post = (path: string, body: unknown) => Promise<void>;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
const seconds = (endsAt: number) => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));

/** Forge console panel for the stream show: rematch window, chat poll, record and Hall of Fame. */
export class ShowtimePanel {
  private state: ForgeSnapshot | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly root: HTMLElement, private readonly post: Post) {
    this.timer = setInterval(() => { if (this.state) this.render(this.state); }, 1000);
  }

  render(state: ForgeSnapshot) {
    this.state = state;
    const show = state.showtime, hall = show.hall;
    const blocks: HTMLElement[] = [];

    const record = node('div', 'show-record');
    record.append(node('strong', '', `${hall.wins}–${hall.losses}`), node('span', '', hall.streak ? `${Math.abs(hall.streak)}-fight ${hall.streak > 0 ? 'win' : 'losing'} streak` : 'Streamer record'));
    blocks.push(record);

    const rematch = show.rematch;
    const rematchBox = node('section', `show-box rematch ${rematch?.status ?? 'idle'}`);
    rematchBox.append(node('p', 'show-label', 'REMATCH PATCH'));
    if (!rematch) rematchBox.append(node('p', 'show-copy', 'Beat a forged boss and chat can send it back to the forge, harder (!rematch).'));
    else {
      rematchBox.append(node('p', 'show-title', `${rematch.boss} → ${rematch.nextName}`));
      rematchBox.append(node('p', 'show-copy', rematch.status === 'open' ? `${rematch.votes}/${rematch.needed} votes · ${seconds(rematch.endsAt)}s left. @${rematch.creator} or a mod can trigger it instantly.` : rematch.message));
      if (rematch.status === 'open') {
        const meter = node('div', 'show-meter'), fill = node('i', '');
        fill.style.width = `${Math.min(100, (rematch.votes / rematch.needed) * 100)}%`; meter.append(fill); rematchBox.append(meter);
        const button = node('button', 'show-action', 'Start rematch now ↗');
        button.addEventListener('click', () => { void this.post('showtime/rematch', {}); });
        rematchBox.append(button);
      }
    }
    blocks.push(rematchBox);

    const vote = show.vote;
    const voteBox = node('section', `show-box vote ${vote ? (vote.closed ? 'closed' : 'open') : 'idle'}`);
    voteBox.append(node('p', 'show-label', 'CHAT POLL · NEXT BOSS'));
    if (!vote) {
      voteBox.append(node('p', 'show-copy', state.queue.length >= 2 ? 'Let chat pick the next fight with !vote 1/2/3.' : 'Polls open when two or more verified bosses are queued.'));
      const button = node('button', 'show-action', 'Start poll ↗');
      button.disabled = state.queue.length < 2 || !!state.activeFight;
      button.addEventListener('click', () => { void this.post('showtime/vote', { action: 'start' }); });
      voteBox.append(button);
    } else {
      const total = Math.max(1, vote.options.reduce((sum, option) => sum + option.votes, 0));
      vote.options.forEach((option, index) => {
        const row = node('div', `show-option${vote.winner === index ? ' winner' : ''}`);
        const bar = node('i', ''); bar.style.width = `${(option.votes / total) * 100}%`;
        row.append(bar, node('span', '', `${index + 1}. ${option.name}`), node('b', '', String(option.votes)));
        voteBox.append(row);
      });
      voteBox.append(node('p', 'show-copy', vote.closed ? 'Poll closed. The winner fights next.' : `${seconds(vote.endsAt)}s left · closes automatically when you claim the next fight.`));
      if (!vote.closed) {
        const button = node('button', 'show-action', 'Close poll now');
        button.addEventListener('click', () => { void this.post('showtime/vote', { action: 'close' }); });
        voteBox.append(button);
      }
    }
    blocks.push(voteBox);

    const fame = node('section', 'show-box fame');
    fame.append(node('p', 'show-label', 'HALL OF FAME · !top'));
    if (!hall.creators.length) fame.append(node('p', 'show-copy', 'No forged bosses have fought yet.'));
    else {
      const list = node('ol', 'show-fame');
      for (const entry of hall.creators) {
        const item = node('li', '');
        item.append(node('span', '', `@${entry.creator}`), node('b', '', `${entry.score} pts`), node('small', '', `${entry.streamerDefeats} win${entry.streamerDefeats === 1 ? '' : 's'} vs you · ${entry.fights} fight${entry.fights === 1 ? '' : 's'}`));
        list.append(item);
      }
      fame.append(list);
    }
    if (hall.recent.length) {
      const recent = node('ul', 'show-recent');
      for (const fight of hall.recent.slice(0, 3)) recent.append(node('li', fight.outcome, `${fight.outcome === 'won' ? '🏆' : '💀'} ${fight.boss} · @${fight.creator}${fight.stats ? ` · ${fight.stats.seconds}s` : ''}`));
      fame.append(recent);
    }
    blocks.push(fame);
    this.root.replaceChildren(...blocks);
  }

  close() { clearInterval(this.timer); }
}
