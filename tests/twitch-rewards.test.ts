import { describe, expect, it, vi } from 'vitest';
import { TwitchApi } from '../server/twitch/api';
import { RewardsApi } from '../server/twitch/rewards';
import { Highlights } from '../server/twitch/highlights';
import { harness } from './forge-helpers';
import { json, twitchConfig } from './twitch-helpers';

const reward = { id: 'owned-reward', title: 'Forge a Boss', is_user_input_required: true, should_redemptions_skip_request_queue: false };
describe('app-owned rewards and highlights', () => {
  it('discovers only manageable rewards and repairs input/queue settings before enabling intake', async () => {
    const calls: { url: URL; method: string; body: unknown }[] = [], persist = vi.fn(async () => {});
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)); calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      return json({ data: [reward] });
    };
    const api = new TwitchApi(twitchConfig(), persist, fetcher), rewards = new RewardsApi(api, persist);
    expect(await rewards.prepare()).toBe('owned-reward');
    expect(calls[0]?.url.searchParams.get('only_manageable_rewards')).toBe('true');
    expect(calls[1]?.body).toMatchObject({ is_user_input_required: true, should_redemptions_skip_request_queue: false, is_paused: true });
    expect(persist).toHaveBeenCalledWith({ TWITCH_REWARD_ID: 'owned-reward' }); api.close();
  });
  it('will not adopt a configured reward outside the app-owned results', async () => {
    const config = twitchConfig(); config.rewardId = 'foreign-reward';
    const fetcher = vi.fn<typeof fetch>(async () => json({ data: [reward] }));
    const api = new TwitchApi(config, async () => {}, fetcher), rewards = new RewardsApi(api, async () => {});
    await expect(rewards.prepare()).rejects.toThrow('another application'); expect(fetcher).toHaveBeenCalledTimes(1); expect(rewards.id).toBeNull(); api.close();
  });
  it('creates a disabled, input-required reward when none exists and persists its ID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: [] })).mockResolvedValueOnce(json({ data: [reward] })).mockResolvedValueOnce(json({ data: [reward] }));
    const persist = vi.fn(async () => {}), api = new TwitchApi(twitchConfig(), persist, fetcher), rewards = new RewardsApi(api, persist);
    await rewards.prepare();
    const creation = fetcher.mock.calls[1]![1]!;
    expect(creation.method).toBe('POST'); expect(JSON.parse(String(creation.body))).toMatchObject({ is_enabled: false, is_user_input_required: true, should_redemptions_skip_request_queue: false }); api.close();
  });
  it('handles offline clip and marker failures and does not request either for skipped fights', async () => {
    const { coordinator } = harness(), fetcher = vi.fn<typeof fetch>(async () => json({}, 404));
    const api = new TwitchApi(twitchConfig(), async () => {}, fetcher), highlights = new Highlights(api, coordinator), fight = coordinator.claimNext();
    await highlights.finish(fight, 'skipped'); expect(fetcher).not.toHaveBeenCalled();
    await highlights.finish(fight, 'lost'); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot().toasts).toHaveLength(2); expect(coordinator.snapshot().toasts.every((toast) => toast.kind === 'warning')).toBe(true);
    highlights.close(); api.close(); await coordinator.close();
  });
  it('waits for a clip to exist before claiming success', async () => {
    let polls = 0; const { coordinator } = harness();
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/markers')) return json({ data: [{ id: 'marker-test', position_seconds: 12 }] });
      if (init?.method === 'POST') return json({ data: [{ id: 'clip-test' }] });
      return json({ data: ++polls === 2 ? [{ id: 'clip-test', url: 'https://clips.twitch.tv/clip-test' }] : [] });
    };
    const api = new TwitchApi(twitchConfig(), async () => {}, fetcher), highlights = new Highlights(api, coordinator, async () => {});
    await highlights.finish(coordinator.claimNext(), 'won');
    expect(polls).toBe(2); expect(coordinator.snapshot().toasts.some((toast) => toast.message.startsWith('Clip confirmed:'))).toBe(true);
    highlights.close(); api.close(); await coordinator.close();
  });
});
