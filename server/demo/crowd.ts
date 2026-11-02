import type { ForgeCoordinator } from '../forge/coordinator';
import type { Showtime } from '../showtime/showtime';

// Account-free demo only: simulated viewers take part in polls and rematch calls so the full
// show can be recorded without Twitch. Everything they do is labeled as simulated.
const CROWD = ['pixel_pirate', 'mint_condition', 'laser_librarian', 'toast_operator', 'bug_collector', 'three_more_orbs', 'capslock_captain'];

export class DemoCrowd {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastVote = '';
  private lastRematch = '';
  private unsubscribe: () => void = () => {};

  constructor(private readonly coordinator: ForgeCoordinator, private readonly showtime: Showtime, private readonly random: () => number = Math.random, private readonly pace = 1) {}

  start() {
    this.unsubscribe = this.coordinator.subscribe((state) => {
      const vote = state.showtime.vote, rematch = state.showtime.rematch;
      if (vote && !vote.closed && vote.id !== this.lastVote) {
        this.lastVote = vote.id;
        this.coordinator.notify('Simulated viewers are voting for the next boss.', 'info', 'demo');
        const voters = CROWD.slice(0, 4 + Math.floor(this.random() * 3));
        voters.forEach((login, index) => this.after(1200 + index * 1500, () => {
          // Biased toward the newest idea so the poll usually reorders the queue on camera.
          const choice = this.random() < 0.55 ? vote.options.length : 1 + Math.floor(this.random() * vote.options.length);
          this.showtime.castVote(login, choice);
        }));
      }
      if (rematch?.status === 'open' && rematch.fightId !== this.lastRematch) {
        this.lastRematch = rematch.fightId;
        this.coordinator.notify('Simulated viewers are calling for a rematch.', 'info', 'demo');
        for (let index = 0; index < rematch.needed; index++) {
          const login = CROWD[(index + 2) % CROWD.length]!;
          this.after(2500 + index * 1800, () => { void this.showtime.rematchVote(login, false); });
        }
      }
    });
  }

  private after(ms: number, fn: () => void) {
    const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, ms / this.pace);
    this.timers.add(timer);
  }

  close() { this.unsubscribe(); for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
}
