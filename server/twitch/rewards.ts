import { z } from 'zod';
import { TwitchApi, TwitchError } from './api';

const Reward = z.object({ id: z.string().min(1), title: z.string(), is_user_input_required: z.boolean(), should_redemptions_skip_request_queue: z.boolean() });
const Rewards = z.object({ data: z.array(Reward).max(50) });
const Redemption = z.object({ id: z.string(), status: z.enum(['UNFULFILLED', 'FULFILLED', 'CANCELED']) });
export class RewardsApi {
  id: string | null = null;
  constructor(private readonly api: TwitchApi, private readonly persist: (values: Record<string, string>) => Promise<void>) {}
  private query() { return { broadcaster_id: this.api.config.broadcasterId }; }
  async prepare() {
    const response = Rewards.parse(await this.api.request('broadcaster', 'GET', 'channel_points/custom_rewards', { ...this.query(), only_manageable_rewards: 'true' }));
    // Never adopt another application's similarly named reward, even with a configured ID.
    let reward = this.api.config.rewardId ? response.data.find((entry) => entry.id === this.api.config.rewardId) : response.data.find((entry) => entry.title === 'Forge a Boss');
    if (this.api.config.rewardId && !reward) throw new Error('Configured reward is missing or belongs to another application. Clear TWITCH_REWARD_ID to create our reward.');
    if (!reward) {
      reward = Rewards.parse(await this.api.request('broadcaster', 'POST', 'channel_points/custom_rewards', this.query(), {
        title: 'Forge a Boss', cost: this.api.config.rewardCost, prompt: 'Describe a boss in 5–1000 characters. Subject to approval and fairness checks; failures are refunded.',
        is_user_input_required: true, should_redemptions_skip_request_queue: false, is_enabled: false,
      })).data[0];
    }
    if (!reward) throw new Error('Twitch did not return a reward.');
    this.id = reward.id;
    await this.api.request('broadcaster', 'PATCH', 'channel_points/custom_rewards', { ...this.query(), id: this.id }, {
      is_user_input_required: true, should_redemptions_skip_request_queue: false, is_paused: true, is_enabled: true,
    });
    await this.persist({ TWITCH_REWARD_ID: this.id });
    return this.id;
  }
  async pause(paused: boolean) {
    if (this.id) await this.api.request('broadcaster', 'PATCH', 'channel_points/custom_rewards', { ...this.query(), id: this.id }, { is_paused: paused });
  }
  async settle(id: string, status: 'CANCELED' | 'FULFILLED') {
    if (!this.id) throw new Error('No app-owned reward.');
    const query = { ...this.query(), reward_id: this.id, id };
    try {
      const result = z.object({ data: z.array(Redemption).min(1) }).parse(await this.api.request('broadcaster', 'PATCH', 'channel_points/custom_rewards/redemptions', query, { status }));
      if (!result.data.some((entry) => entry.id === id && entry.status === status)) throw new Error('Redemption status was not confirmed.');
    } catch (error) {
      if (!(error instanceof TwitchError) || ![400, 404].includes(error.status)) throw error;
      const result = z.object({ data: z.array(Redemption) }).parse(await this.api.request('broadcaster', 'GET', 'channel_points/custom_rewards/redemptions', query));
      if (!result.data.some((entry) => entry.id === id && entry.status === status)) throw error;
    }
  }
  async unfulfilled() {
    if (!this.id) return [];
    const ids: string[] = []; let after = '';
    do {
      const result = z.object({ data: z.array(Redemption).max(50), pagination: z.object({ cursor: z.string().optional() }) }).parse(await this.api.request('broadcaster', 'GET', 'channel_points/custom_rewards/redemptions', {
        ...this.query(), reward_id: this.id, status: 'UNFULFILLED', first: '50', ...(after ? { after } : {}),
      }));
      ids.push(...result.data.map((entry) => entry.id));
      if (ids.length > 5000 || (result.pagination.cursor && result.pagination.cursor === after)) throw new Error('Too many outstanding redemptions. Resolve them in Twitch first.');
      after = result.pagination.cursor ?? '';
    } while (after);
    return ids;
  }
}
