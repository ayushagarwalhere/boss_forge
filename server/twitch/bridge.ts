import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ForgeJob, ForgeSnapshot, TwitchStatus } from '../../engine/forge-protocol';
import { UserError } from '../forge/coordinator';
import { authorizeUrl, type StoredToken, type TokenStore, type TwitchRole } from './auth';
import type { TwitchConfig } from './config';
import { EventSubConnection, type EventSubHandlers } from './eventsub';
import type { Helix } from './helix';

/** The part of ForgeCoordinator the bridge needs (kept narrow for tests). */
export interface ForgeLike {
  submit(input: unknown, source: ForgeJob['source']): Promise<ForgeJob>;
  snapshot(): ForgeSnapshot;
  subscribe(listener: (state: ForgeSnapshot) => void): () => void;
  setTwitch(status: TwitchStatus | null): void;
}
type Connection = Pick<EventSubConnection, 'start' | 'stop'>;
type ConnectionFactory = (handlers: EventSubHandlers) => Connection;

const ChatEvent = z.object({ chatter_user_id: z.string(), chatter_user_login: z.string(), message_id: z.string(), message: z.object({ text: z.string() }), source_broadcaster_user_id: z.string().nullable().optional() });
const RedemptionEvent = z.object({ id: z.string(), user_login: z.string(), user_input: z.string(), reward: z.object({ id: z.string() }) });

type Origin = { login: string; replyTo?: string; redemption?: { id: string; rewardId: string }; lastStatus: ForgeJob['status'] };

export class TwitchBridge {
  private readonly states = new Map<string, { role: TwitchRole; expires: number }>();
  private readonly origins = new Map<string, Origin>();
  private readonly connections: Connection[] = [];
  private readonly outbox: { text: string; replyTo?: string }[] = [];
  private sending = false;
  private unsubscribe: (() => void) | null = null;
  private validateTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventSeq = 0;
  private rewardId: string | null = null;
  private status: TwitchStatus;

  constructor(
    private readonly config: TwitchConfig, private readonly tokens: TokenStore, private readonly helix: Helix,
    private readonly forge: ForgeLike, private readonly connect: ConnectionFactory = (handlers) => new EventSubConnection(handlers),
    private readonly sendDelayMs = 1100,
  ) {
    this.status = { configured: true, broadcaster: null, bot: null, chatConnected: false, command: config.command, rewards: config.rewards === 'off' ? 'off' : 'pending', rewardTitle: config.rewardTitle, rewardCost: config.rewardCost, detail: 'Connect the broadcaster account to start.' };
  }

  // ---- OAuth -------------------------------------------------------------
  loginUrl(role: TwitchRole): string {
    const state = randomBytes(24).toString('hex');
    this.states.set(state, { role, expires: Date.now() + 10 * 60_000 });
    for (const [key, value] of this.states) if (value.expires < Date.now()) this.states.delete(key);
    return authorizeUrl(this.config, role, state);
  }
  async completeLogin(code: string, state: string) {
    const pending = this.states.get(state); this.states.delete(state);
    if (!pending || pending.expires < Date.now()) throw new UserError('Twitch login expired or did not start here. Try again from the forge page.');
    await this.tokens.completeLogin(pending.role, code);
    await this.restart();
  }
  async disconnect(role: TwitchRole) { await this.tokens.remove(role); await this.restart(); }

  // ---- Lifecycle -----------------------------------------------------------
  async start() {
    this.lastEventSeq = this.forge.snapshot().events.at(-1)?.seq ?? 0;
    this.unsubscribe = this.forge.subscribe((state) => this.onForge(state));
    // Twitch requires validating user tokens every hour.
    this.validateTimer = setInterval(() => { void this.tokens.validateAll().then((revoked) => { if (revoked.length) void this.restart(); }); }, 60 * 60_000);
    await this.restart();
  }
  async stop() {
    this.unsubscribe?.(); this.unsubscribe = null;
    if (this.validateTimer) clearInterval(this.validateTimer);
    for (const connection of this.connections.splice(0)) connection.stop();
    // Refund anything still unresolved so viewers never lose points to a shutdown.
    for (const [jobId, origin] of this.origins) if (origin.redemption) await this.refund(jobId, origin).catch(() => {});
  }

  private publish(patch: Partial<TwitchStatus>) { this.status = { ...this.status, ...patch }; this.forge.setTwitch(this.status); }

  private async restart() {
    for (const connection of this.connections.splice(0)) connection.stop();
    const broadcaster = this.tokens.get('broadcaster'), bot = this.tokens.get('bot');
    this.publish({ broadcaster: broadcaster?.login ?? null, bot: bot?.login ?? null, chatConnected: false });
    if (!broadcaster) { this.publish({ detail: 'Connect the broadcaster account to start.' }); return; }
    try {
      await this.setupReward(broadcaster);
      const reader = bot ?? broadcaster;
      // One EventSub session per token user: chat as the reader, redemptions as the broadcaster.
      this.listen(reader.role, async (session) => {
        await this.helix.subscribe(reader.role, 'channel.chat.message', '1', { broadcaster_user_id: broadcaster.userId, user_id: reader.userId }, session);
        if (this.rewardId && reader.role === 'broadcaster') await this.subscribeRedemptions(broadcaster, session);
      });
      if (this.rewardId && reader.role === 'bot') this.listen('broadcaster', (session) => this.subscribeRedemptions(broadcaster, session));
    } catch (error) {
      this.publish({ detail: error instanceof Error ? error.message : 'Twitch setup failed.' });
    }
  }

  private listen(role: TwitchRole, onSession: (session: string) => Promise<void>) {
    const connection = this.connect({
      onSession,
      onEvent: (type, event) => { void this.onEvent(type, event); },
      onStatus: (connected, detail) => { if (role === this.tokens.chatRole()) this.publish({ chatConnected: connected, detail }); else if (!connected) this.publish({ detail }); },
    });
    this.connections.push(connection); connection.start();
  }

  private subscribeRedemptions(broadcaster: StoredToken, session: string) {
    return this.helix.subscribe('broadcaster', 'channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: broadcaster.userId, reward_id: this.rewardId! }, session);
  }

  private async setupReward(broadcaster: StoredToken) {
    this.rewardId = null;
    if (this.config.rewards === 'off') { this.publish({ rewards: 'off' }); return; }
    const user = await this.helix.user('broadcaster', broadcaster.userId);
    if (user.broadcaster_type !== 'affiliate' && user.broadcaster_type !== 'partner') {
      this.publish({ rewards: 'unavailable' }); return; // Channel points need Affiliate/Partner; chat command still works.
    }
    try {
      const existing = (await this.helix.manageableRewards(broadcaster.userId)).find((reward) => reward.title === this.config.rewardTitle);
      this.rewardId = (existing ?? await this.helix.createReward(broadcaster.userId)).id;
      this.publish({ rewards: 'ready' });
    } catch (error) {
      this.publish({ rewards: 'error', detail: error instanceof Error ? error.message : 'Could not create the channel-point reward.' });
    }
  }

  // ---- Incoming Twitch events --------------------------------------------
  private async onEvent(type: string, raw: unknown) {
    if (type === 'channel.chat.message') {
      const parsed = ChatEvent.safeParse(raw); if (!parsed.success) return;
      await this.onChat(parsed.data);
    } else if (type === 'channel.channel_points_custom_reward_redemption.add') {
      const parsed = RedemptionEvent.safeParse(raw); if (!parsed.success || parsed.data.reward.id !== this.rewardId) return;
      await this.onRedemption(parsed.data);
    }
  }

  private async onChat(event: z.infer<typeof ChatEvent>) {
    const sender = this.tokens.get(this.tokens.chatRole() ?? 'broadcaster');
    if (!sender || event.chatter_user_id === sender.userId) return; // ignore our own replies
    if (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== this.tokens.get('broadcaster')?.userId) return; // shared-chat guests
    const text = event.message.text.trim(), [word = '', ...rest] = text.split(/\s+/), command = word.toLowerCase();
    const login = event.chatter_user_login.toLowerCase();
    if (command === this.config.command) {
      const description = rest.join(' ').trim();
      if (description.length < 5) { this.say(`@${login} describe your boss: ${this.config.command} a disco ball that fires spirals and taunts in rhymes`, event.message_id); return; }
      try {
        const job = await this.forge.submit({ creator: login, text: description }, 'twitch');
        this.origins.set(job.id, { login, replyTo: event.message_id, lastStatus: job.status });
        this.say(job.status === 'pending' ? `@${login} got it! Your boss is waiting for the streamer's OK, then Codex builds it.` : `@${login} got it! Codex is forging your boss now.`, event.message_id);
      } catch (error) {
        this.say(`@${login} ${error instanceof UserError ? error.message : 'the forge could not take that request.'}`, event.message_id);
      }
    } else if (command === '!queue') {
      const state = this.forge.snapshot();
      const names = state.queue.map((boss, index) => `${index + 1}. ${boss.spec.meta.name} (@${boss.spec.meta.creator})`);
      this.say(names.length ? `Up next: ${names.join(' · ')}` : `The queue is empty. Type ${this.config.command} <idea> to forge a boss.`, event.message_id);
    } else if (command === '!fight') {
      const fight = this.forge.snapshot().activeFight;
      this.say(fight ? `Now fighting ${fight.boss.spec.meta.name} by @${fight.boss.spec.meta.creator}.` : 'No fight right now.', event.message_id);
    }
  }

  private async onRedemption(event: z.infer<typeof RedemptionEvent>) {
    const login = event.user_login.toLowerCase(), redemption = { id: event.id, rewardId: event.reward.id };
    try {
      const job = await this.forge.submit({ creator: login, text: event.user_input }, 'twitch');
      this.origins.set(job.id, { login, redemption, lastStatus: job.status });
      this.say(`@${login} redeemed ${this.config.rewardTitle}! ${job.status === 'pending' ? 'Waiting for the streamer to approve it.' : 'Codex is on it.'}`);
    } catch (error) {
      await this.helix.resolveRedemption(this.tokens.get('broadcaster')!.userId, redemption.rewardId, redemption.id, 'CANCELED').catch(() => {});
      this.say(`@${login} your points were refunded: ${error instanceof UserError ? error.message : 'the forge could not take that request.'}`);
    }
  }

  // ---- Forge updates -> chat / refunds ----------------------------------
  private onForge(state: ForgeSnapshot) {
    for (const event of state.events) {
      if (event.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = event.seq;
      if (event.phase === 'fight') this.say(`⚔️ ${event.message}`);
    }
    for (const job of state.jobs) {
      const origin = this.origins.get(job.id);
      if (!origin || origin.lastStatus === job.status) continue;
      origin.lastStatus = job.status;
      if (job.status === 'building' && job.attempt <= 1) this.say(`@${origin.login} 🔨 Codex is forging your boss…`);
      if (job.status === 'queued') {
        const position = state.queue.findIndex((boss) => boss.jobId === job.id) + 1;
        const boss = state.queue.find((entry) => entry.jobId === job.id);
        this.say(`@${origin.login} ✅ ${boss?.spec.meta.name ?? 'Your boss'} passed the fairness gate (bot won ${job.gate?.wins ?? '?'}/5). Queue spot #${position || '?'}.`, origin.replyTo);
        if (origin.redemption) void this.fulfil(job.id, origin);
      }
      if (job.status === 'failed' || job.status === 'rejected') {
        const reason = job.status === 'rejected' ? 'the streamer passed on it' : 'it could not pass the fairness gate';
        this.say(`@${origin.login} ❌ your boss was not queued: ${reason}.${origin.redemption ? ' Points refunded.' : ''}`, origin.replyTo);
        if (origin.redemption) void this.refund(job.id, origin); else this.origins.delete(job.id);
      }
      if (job.status === 'finished') this.origins.delete(job.id);
    }
  }

  private async fulfil(jobId: string, origin: Origin) {
    const broadcaster = this.tokens.get('broadcaster');
    if (!broadcaster || !origin.redemption) return;
    await this.helix.resolveRedemption(broadcaster.userId, origin.redemption.rewardId, origin.redemption.id, 'FULFILLED').catch(() => {});
    delete origin.redemption;
  }
  private async refund(jobId: string, origin: Origin) {
    const broadcaster = this.tokens.get('broadcaster');
    this.origins.delete(jobId);
    if (!broadcaster || !origin.redemption) return;
    await this.helix.resolveRedemption(broadcaster.userId, origin.redemption.rewardId, origin.redemption.id, 'CANCELED');
  }

  // ---- Outgoing chat (rate limited) ---------------------------------------
  private say(text: string, replyTo?: string) {
    if (!this.tokens.get('broadcaster')) return;
    this.outbox.push(replyTo ? { text, replyTo } : { text });
    if (this.outbox.length > 20) this.outbox.shift();
    void this.flush();
  }
  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.outbox.length) {
        const next = this.outbox.shift()!, role = this.tokens.chatRole(), broadcaster = this.tokens.get('broadcaster');
        if (!role || !broadcaster) break;
        const sender = this.tokens.get(role)!;
        await this.helix.sendChat(role, broadcaster.userId, sender.userId, next.text, next.replyTo).catch((error: unknown) => {
          this.publish({ detail: error instanceof Error ? error.message : 'Chat reply failed.' });
        });
        if (this.outbox.length) await new Promise((resolve) => setTimeout(resolve, this.sendDelayMs));
      }
    } finally { this.sending = false; }
  }
}
