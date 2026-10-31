import type { GameEvent } from '../../engine/simulation';

// Procedural WebAudio only: every sound is synthesized here, no audio files.
// The context starts on the first user gesture (browser autoplay rules).
type Cue = GameEvent['kind'] | 'start';
const STORAGE_KEY = 'boss-forge-sound';

export class SoundBoard {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<Cue, number>();
  enabled: boolean;

  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage may be blocked */ }
    this.enabled = saved !== 'off';
  }

  /** Call from a click/keypress so the browser allows audio. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain(); this.master.gain.value = this.enabled ? 0.5 : 0;
      const compressor = this.ctx.createDynamicsCompressor();
      this.master.connect(compressor).connect(this.ctx.destination);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = (seed / 2147483647) * 2 - 1; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try { localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off'); } catch { /* per-viewer convenience only */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.5 : 0, this.ctx.currentTime, 0.02);
    return this.enabled;
  }

  play(cue: Cue) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled || ctx.state !== 'running') return;
    const gap = cue === 'bossHit' ? 0.07 : cue === 'minionDown' ? 0.05 : 0.02;
    if (ctx.currentTime - (this.lastPlayed.get(cue) ?? -1) < gap) return;
    this.lastPlayed.set(cue, ctx.currentTime);
    const t = ctx.currentTime;
    switch (cue) {
      case 'bossHit': this.tone('square', 880 + Math.random() * 120, 660, t, 0.04, 0.035); break;
      case 'minionDown': this.tone('triangle', 520, 1200, t, 0.08, 0.12); this.burst(t, 0.06, 4000, 0.08); break;
      case 'hit': this.burst(t, 0.25, 900, 0.45); this.tone('sawtooth', 140, 45, t, 0.35, 0.35); break;
      case 'teleport': this.sweep(t, 0.35, 300, 4000, 0.2); this.tone('sine', 1200, 300, t, 0.3, 0.08); break;
      case 'phase': this.sweep(t, 0.6, 200, 2400, 0.25); [220, 277, 330].forEach((f, i) => this.tone('sawtooth', f, f, t + 0.1 + i * 0.07, 0.6, 0.12)); break;
      case 'start': this.tone('sine', 55, 40, t, 1.2, 0.5); this.sweep(t, 0.8, 120, 900, 0.15); break;
      case 'won': [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.11, 0.5, 0.22)); break;
      case 'lost': [392, 311, 247, 196].forEach((f, i) => this.tone('sawtooth', f, f * 0.97, t + i * 0.16, 0.45, 0.16)); break;
    }
  }

  private tone(type: OscillatorType, from: number, to: number, at: number, length: number, volume: number) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length);
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(volume, at + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(this.master!); osc.start(at); osc.stop(at + length + 0.02);
  }

  private burst(at: number, length: number, cutoff: number, volume: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(filter).connect(gain).connect(this.master!); src.start(at); src.stop(at + length + 0.02);
  }

  private sweep(at: number, length: number, from: number, to: number, volume: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = this.noise; filter.type = 'bandpass'; filter.Q.value = 6;
    filter.frequency.setValueAtTime(from, at); filter.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(volume, at + length * 0.3); gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(filter).connect(gain).connect(this.master!); src.start(at); src.stop(at + length + 0.02);
  }
}
