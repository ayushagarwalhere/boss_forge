import { z } from 'zod';
import type { Fetch, TokenStore, TwitchRole } from './auth';
import type { TwitchConfig } from './config';

// Endpoints verified against https://dev.twitch.tv/docs/api/reference/ (2026-10-31):
// Send Chat Message, Get Users, Get/Create Custom Reward, Update Redemption Status,
// Create EventSub Subscription (websocket transport requires a user access token).
const API = 'https://api.twitch.tv/helix';

export class HelixError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const Reward = z.object({ id: z.string(), title: z.string(), cost: z.number(), is_enabled: z.boolean().optional() });
export type Reward = z.infer<typeof Reward>;
const UserInfo = z.object({ id: z.string(), login: z.string(), display_name: z.string(), broadcaster_type: z.string() });

export class Helix {
  constructor(private readonly config: TwitchConfig, private readonly tokens: TokenStore, private readonly fetchImpl: Fetch = fetch) {}

  private async request(role: TwitchRole, method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<unknown> {
    const url = `${API}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.tokens.fresh(role, attempt > 0);
      const response = await this.fetchImpl(url, {
        method,
        headers: { 'client-id': this.config.clientId, authorization: `Bearer ${token.accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 && attempt === 0) continue; // refresh once, then retry
      if (response.status === 204) return null;
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : `HTTP ${response.status}`;
        throw new HelixError(`Twitch ${method} ${path} failed: ${message}`, response.status);
      }
      return data;
    }
    throw new HelixError(`Twitch ${method} ${path} was unauthorized.`, 401);
  }

  async user(role: TwitchRole, id: string) {
    const data = z.object({ data: z.array(UserInfo) }).parse(await this.request(role, 'GET', '/users', { id }));
    const user = data.data[0];
    if (!user) throw new HelixError('Twitch user not found.', 404);
    return user;
  }

  async sendChat(role: TwitchRole, broadcasterId: string, senderId: string, message: string, replyTo?: string) {
    const data = z.object({ data: z.array(z.object({ is_sent: z.boolean(), drop_reason: z.object({ message: z.string() }).nullable().optional() })) })
      .parse(await this.request(role, 'POST', '/chat/messages', {}, { broadcaster_id: broadcasterId, sender_id: senderId, message: message.slice(0, 500), ...(replyTo ? { reply_parent_message_id: replyTo } : {}) }));
    const result = data.data[0];
    if (result && !result.is_sent) throw new HelixError(`Twitch dropped the chat message: ${result.drop_reason?.message ?? 'unknown reason'}`, 200);
  }

  async subscribe(role: TwitchRole, type: string, version: string, condition: Record<string, string>, sessionId: string) {
    await this.request(role, 'POST', '/eventsub/subscriptions', {}, { type, version, condition, transport: { method: 'websocket', session_id: sessionId } });
  }

  async manageableRewards(broadcasterId: string): Promise<Reward[]> {
    return z.object({ data: z.array(Reward) }).parse(await this.request('broadcaster', 'GET', '/channel_points/custom_rewards', { broadcaster_id: broadcasterId, only_manageable_rewards: 'true' })).data;
  }

  async createReward(broadcasterId: string): Promise<Reward> {
    const data = z.object({ data: z.array(Reward) }).parse(await this.request('broadcaster', 'POST', '/channel_points/custom_rewards', { broadcaster_id: broadcasterId }, {
      title: this.config.rewardTitle, cost: this.config.rewardCost, is_user_input_required: true,
      prompt: 'Describe a bullet-hell boss: attacks, movement, personality. Codex builds it; a bot checks it is fair. Refunded if it fails.',
      background_color: '#9146FF', should_redemptions_skip_request_queue: false,
    }));
    const reward = data.data[0];
    if (!reward) throw new HelixError('Twitch did not return the new reward.', 500);
    return reward;
  }

  /** CANCELED refunds the viewer's points; only valid while the redemption is UNFULFILLED. */
  async resolveRedemption(broadcasterId: string, rewardId: string, redemptionId: string, status: 'FULFILLED' | 'CANCELED') {
    await this.request('broadcaster', 'PATCH', '/channel_points/custom_rewards/redemptions', { broadcaster_id: broadcasterId, reward_id: rewardId, id: redemptionId }, { status });
  }
}
