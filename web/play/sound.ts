import type { GameState } from '../../engine/simulation';

/** Original oscillator envelopes only. Audio state never enters the simulation. */
export class GameSound {
  private context: AudioContext | null = null;
  private voices = 0;
  private readonly last = new Map<string, number>();
  enabled = false;
  readonly available = typeof AudioContext !== 'undefined';
  constructor() { try { this.enabled = localStorage.getItem('boss-forge-sound') === 'on'; } catch { /* Storage is optional. */ } }
  async unlock() {
    if (!this.available || !this.enabled) return;
    try { this.context ??= new AudioContext(); await this.context.resume(); } catch { this.enabled = false; }
  }
  async toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('boss-forge-sound', this.enabled ? 'on' : 'off'); } catch { /* Storage is optional. */ }
    if (this.enabled) { await this.unlock(); this.tone('enabled', 440, 660, 0.12, 'sine', 0.07); }
    else await this.context?.suspend().catch(() => {});
  }
  pause(paused: boolean) { if (this.context && this.enabled) void (paused ? this.context.suspend() : this.context.resume()).catch(() => {}); }
  private tone(key: string, from: number, to: number, duration: number, wave: OscillatorType, volume: number) {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running' || this.voices >= 12) return;
    const time = context.currentTime;
    if (time - (this.last.get(key) ?? -Infinity) < 0.08) return; this.last.set(key, time);
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = wave; oscillator.frequency.setValueAtTime(from, time); oscillator.frequency.exponentialRampToValueAtTime(to, time + duration);
    gain.gain.setValueAtTime(0.0001, time); gain.gain.exponentialRampToValueAtTime(volume, time + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain); gain.connect(context.destination); this.voices++;
    oscillator.onended = () => { this.voices--; oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(time); oscillator.stop(time + duration + 0.015);
  }
  consume(game: GameState) {
    if (!this.enabled) return;
    if (game.status === 'playing' && game.tick % 8 === 0) this.tone('shot', 530, 220, 0.045, 'triangle', 0.018);
    if (game.lasers.some((laser) => laser.born === game.tick) || game.boss.motion?.born === game.tick) this.tone('warning', 180, 540, 0.28, 'sine', 0.035);
    for (const event of game.events) {
      if (event.kind === 'bossHit') this.tone('impact', 145, 95, 0.045, 'triangle', 0.025);
      else if (event.kind === 'hit' || event.kind === 'lost') this.tone('damage', 210, 43, 0.3, 'sawtooth', 0.045);
      else if (event.kind === 'phase') this.tone('phase', 190, 760, 0.32, 'triangle', 0.055);
      else if (event.kind === 'won') this.tone('victory', 330, 990, 0.55, 'sine', 0.065);
      else if (event.kind === 'minionDown') this.tone('minion', 630, 120, 0.12, 'triangle', 0.035);
      else if (event.kind === 'teleport') this.tone('teleport', 110, 880, 0.15, 'sine', 0.035);
    }
  }
  close() { void this.context?.close().catch(() => {}); }
}
