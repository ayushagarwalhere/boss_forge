import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ForgeFight } from '../../engine/forge-protocol';
import type { ForgeCoordinator } from '../forge/coordinator';
import type { TwitchApi } from './api';

export class Highlights {
  private readonly abort = new AbortController();
  constructor(private readonly api: TwitchApi, private readonly coordinator: ForgeCoordinator, private readonly wait = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal })) {}
  async finish(fight: ForgeFight, outcome: 'won' | 'lost' | 'skipped') {
    if (outcome === 'skipped') return;
    const label = `${fight.boss.spec.meta.name}: ${outcome === 'won' ? 'boss defeated' : 'streamer defeated'}`;
    await Promise.allSettled([this.clip(), this.marker(label)]);
  }
  private async marker(description: string) {
    try {
      z.object({ data: z.array(z.object({ id: z.string(), position_seconds: z.number() })).min(1) }).parse(await this.api.request('broadcaster', 'POST', 'streams/markers', {}, { user_id: this.api.config.broadcasterId, description: description.slice(0, 140) }));
      this.coordinator.notify('Stream marker saved.', 'success', 'twitch');
    } catch { if (!this.abort.signal.aborted) this.coordinator.notify('Marker unavailable. Check that the stream is live, VODs are enabled and permissions are valid.', 'warning', 'twitch'); }
  }
  private async clip() {
    try {
      const result = z.object({ data: z.array(z.object({ id: z.string().min(1) })).min(1) }).parse(await this.api.request('broadcaster', 'POST', 'clips', { broadcaster_id: this.api.config.broadcasterId }));
      const id = result.data[0]!.id;
      this.coordinator.notify('Twitch accepted a clip request. Waiting for confirmation…', 'info', 'twitch');
      for (let attempt = 0; attempt < 12; attempt++) {
        await this.wait(5000, this.abort.signal);
        const clips = z.object({ data: z.array(z.object({ id: z.string(), url: z.url() })) }).parse(await this.api.request('broadcaster', 'GET', 'clips', { id }));
        const clip = clips.data.find((entry) => entry.id === id);
        if (clip) {
          const url = new URL(clip.url);
          if (url.protocol !== 'https:' || !['clips.twitch.tv', 'www.twitch.tv'].includes(url.hostname)) throw new Error('Invalid clip URL.');
          this.coordinator.notify(`Clip confirmed: ${clip.url}`, 'success', 'twitch'); return;
        }
      }
      throw new Error('Clip confirmation timed out.');
    } catch { if (!this.abort.signal.aborted) this.coordinator.notify('Clip unavailable. The stream may be offline, clips disabled, or creation could not be confirmed.', 'warning', 'twitch'); }
  }
  close() { this.abort.abort(); }
}
