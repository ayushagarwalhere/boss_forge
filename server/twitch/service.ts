import { z } from 'zod';
import type WebSocket from 'ws';
import type { TwitchState, ForgeSnapshot } from '../../engine/forge-protocol';
import type { ForgeCoordinator } from '../forge/coordinator';
import { TwitchApi, TwitchError } from './api';
import { ChatCommands } from './chat';
import type { TwitchConfig } from './config';
import { saveEnvironment } from './environment';
import { EventSub } from './eventsub';
import { Highlights } from './highlights';
import { Redemptions } from './redemptions';
import { RewardsApi } from './rewards';

const Subscription = z.object({ type: z.string(), version: z.literal('1'), condition: z.object({ broadcaster_user_id: z.string(), user_id: z.string().optional(), reward_id: z.string().optional() }) });
export class TwitchService {
  private readonly api: TwitchApi;
  private readonly rewards: RewardsApi;
  private readonly commands: ChatCommands;
  private readonly redemptions: Redemptions;
  private readonly highlights: Highlights;
  private readonly sockets: EventSub[] = [];
  private readonly jobStates = new Map<string, string>();
  private state: TwitchState = { status: 'connecting', channel: null, reward: 'off', message: 'Validating Twitch accounts…' };
  private activity = Promise.resolve();
  private backlog = 0;
  private unsubscribe = () => {};
  private unsubscribeFights = () => {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private validation: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private chatConnected = false;
  constructor(private readonly coordinator: ForgeCoordinator, config: TwitchConfig,
    private readonly transport: { fetcher?: typeof fetch; socket?: (url: string) => WebSocket; persist?: typeof saveEnvironment } = {}) {
    const persist = transport.persist ?? saveEnvironment;
    this.api = new TwitchApi(config, persist, transport.fetcher); this.rewards = new RewardsApi(this.api, persist);
    const say = (text: string) => this.say(text);
    this.commands = new ChatCommands(coordinator, config.broadcasterId, config.botId, say);
    this.redemptions = new Redemptions(coordinator, this.rewards, config.broadcasterId, say);
    this.highlights = new Highlights(this.api, coordinator);
  }
  private publish(patch: Partial<TwitchState>) { this.state = { ...this.state, ...patch }; this.coordinator.setTwitch(this.state); }
  private enqueue(action: () => Promise<void>) {
    if (this.stopped || this.backlog >= 100) return;
    this.backlog++;
    this.activity = this.activity.then(async () => { if (!this.stopped) await action(); }).catch(() => { if (!this.stopped) this.coordinator.notify('A Twitch action failed. Check local setup or the Twitch reward queue; no credentials are shown here.', 'warning', 'twitch'); }).finally(() => { this.backlog--; });
  }
  private async say(text: string) {
    if (!this.chatConnected || this.stopped) return;
    try {
      const response = z.object({ data: z.array(z.object({ is_sent: z.boolean() })).min(1) }).parse(await this.api.request('bot', 'POST', 'chat/messages', {}, {
        broadcaster_id: this.api.config.broadcasterId, sender_id: this.api.config.botId,
        message: Array.from(text, (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('').slice(0, 500),
      }));
      if (!response.data[0]!.is_sent) throw new Error('Chat message was not sent.');
    } catch { this.coordinator.notify('Twitch chat reply could not be sent.', 'warning', 'twitch'); }
  }
  async start() {
    this.publish({});
    try {
      const broadcaster = await this.api.validate('broadcaster'); await this.api.validate('bot');
      this.publish({ channel: broadcaster.login });
      try { await this.rewards.prepare(); await this.redemptions.recover(); }
      catch (error) {
        await this.rewards.pause(true).catch(() => {});
        this.rewards.id = null;
        this.publish({ reward: 'unavailable', message: error instanceof TwitchError && error.status === 403 ? 'Channel Points unavailable for this channel. Use !boss in chat.' : 'Reward setup or recovery failed. Resolve outstanding rewards in Twitch; !boss remains available.' });
      }
      this.unsubscribe = this.coordinator.subscribe((state) => this.observe(state));
      this.unsubscribeFights = this.coordinator.onFightFinished((fight, outcome) => { void this.highlights.finish(fight, outcome); });
      this.connect('bot', 'channel.chat.message', { broadcaster_user_id: this.api.config.broadcasterId, user_id: this.api.config.botId });
      if (this.rewards.id) this.connect('broadcaster', 'channel.channel_points_custom_reward_redemption.add', { broadcaster_user_id: this.api.config.broadcasterId, reward_id: this.rewards.id });
      this.timer = setInterval(() => this.enqueue(() => this.redemptions.recover()), 30000);
      this.validation = setInterval(() => { void this.validate().catch(() => this.fail()); }, 3600000);
    } catch { this.fail(); }
  }
  private async validate() { await this.api.validate('broadcaster'); await this.api.validate('bot'); }
  private fail() {
    this.chatConnected = false; for (const socket of this.sockets) socket.close();
    if (this.timer) clearInterval(this.timer); if (this.validation) clearInterval(this.validation);
    this.publish({ status: 'error', reward: 'unavailable', message: 'Twitch authentication failed. Run npm run auth for both accounts, then restart.' });
    void this.rewards.pause(true).catch(() => {});
  }
  private connect(role: 'bot' | 'broadcaster', type: string, condition: Record<string, string>) {
    const socket = new EventSub({
      subscribe: async (session) => { z.object({ data: z.array(z.object({ id: z.string() })).min(1) }).parse(await this.api.request(role, 'POST', 'eventsub/subscriptions', {}, { type, version: '1', condition, transport: { method: 'websocket', session_id: session } })); },
      notification: (input, event) => {
        const parsed = Subscription.safeParse(input);
        if (!parsed.success || parsed.data.type !== type || Object.entries(condition).some(([key, value]) => parsed.data.condition[key as keyof typeof parsed.data.condition] !== value)) return;
        this.enqueue(() => role === 'bot' ? this.commands.accept(event) : this.redemptions.accept(event));
      },
      status: (status, message) => {
        if (this.stopped) return;
        if (role === 'bot') { this.chatConnected = status === 'connected'; this.publish({ status, message: this.state.reward === 'unavailable' && status === 'connected' ? 'Chat connected. Channel Points unavailable; use !boss.' : message }); }
        else {
          this.publish({ reward: status === 'connected' ? this.state.reward : 'off' });
          this.enqueue(async () => {
            if (status === 'connected') { await this.redemptions.recover(); await this.rewards.pause(false); this.publish({ reward: 'active' }); }
            else { await this.rewards.pause(true); if (status === 'error') this.publish({ reward: 'unavailable', message }); }
          });
        }
      },
    }, this.transport.socket);
    this.sockets.push(socket); socket.start();
  }
  private observe(state: ForgeSnapshot) {
    const settlementChanged = this.redemptions.observe(state.jobs);
    for (const job of state.jobs) {
      if (job.source !== 'twitch' || this.jobStates.get(job.id) === job.status) continue;
      this.jobStates.set(job.id, job.status);
      if (job.status === 'queued') {
        const boss = state.queue.find((entry) => entry.jobId === job.id);
        if (boss) this.enqueue(async () => {
          this.coordinator.notify(`${boss.spec.meta.name} by @${job.creator} passed the server gate.`, 'success', 'twitch');
          await this.say(`${job.mode === 'replay' ? '[CACHED REPLAY] ' : ''}${boss.spec.meta.name} by @${job.creator} is queued! ${boss.spec.meta.reading.join(' ')} Gate: ${boss.gate.wins}/5 dodger wins.`);
        });
      } else if (job.status === 'failed' || job.status === 'rejected') this.enqueue(() => this.say(`@${job.creator} that boss could not be queued. Try another idea; any Channel Points refund is handled separately.`));
    }
    const ids = new Set(state.jobs.map((job) => job.id)); for (const id of this.jobStates.keys()) if (!ids.has(id)) this.jobStates.delete(id);
    if (settlementChanged) this.enqueue(() => this.redemptions.flush());
  }
  async close() {
    this.stopped = true; this.unsubscribe(); this.unsubscribeFights();
    if (this.timer) clearInterval(this.timer); if (this.validation) clearInterval(this.validation);
    for (const socket of this.sockets) socket.close(); this.highlights.close();
    await this.activity; await this.rewards.pause(true).catch(() => {}); await this.redemptions.cancelPending(); this.api.close();
  }
  async idle() { let pending: Promise<void>; do { pending = this.activity; await pending; } while (pending !== this.activity); }
}
