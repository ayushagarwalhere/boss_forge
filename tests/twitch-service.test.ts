import { describe, expect, it, vi } from 'vitest';
import { TwitchService } from '../server/twitch/service';
import { ForgeSnapshotSchema } from '../engine/forge-protocol';
import { harness } from './forge-helpers';
import { identity, json, microtasks, TestSocket, twitchConfig } from './twitch-helpers';

describe('Twitch adapter integration', () => {
  it('uses each token owner, preserves local approval, fulfills only after a gate pass and pauses on disconnect', async () => {
    const { coordinator } = harness();
    const sockets: TestSocket[] = [], calls: { path: string; method: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET', auth = new Headers(init?.headers).get('Authorization');
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ path: url.pathname, method, auth, body });
      if (url.pathname.endsWith('/validate')) return json(identity(auth === 'OAuth bot-test' ? 'bot' : 'broadcaster'));
      if (url.pathname.endsWith('/subscriptions')) return json({ data: [{ id: 'subscription-test' }] }, 202);
      if (url.pathname.endsWith('/messages')) return json({ data: [{ is_sent: true }] });
      if (url.pathname.endsWith('/redemptions')) return json({ data: method === 'PATCH' ? [{ id: 'redemption-test', status: body.status }] : [], pagination: {} });
      return json({ data: [{ id: 'reward-test', title: 'Forge a Boss', is_user_input_required: true, should_redemptions_skip_request_queue: false }] });
    };
    const service = new TwitchService(coordinator, twitchConfig(), { fetcher, persist: async () => {}, socket: () => { const socket = new TestSocket(); sockets.push(socket); return socket.asSocket(); } });
    try {
      await service.start(); expect(sockets).toHaveLength(2);
      sockets[0]!.welcome('chat-session'); sockets[1]!.welcome('reward-session'); await microtasks(); await service.idle();
      const subscriptions = calls.filter((call) => call.path.endsWith('/subscriptions'));
      expect(subscriptions.map((call) => call.auth)).toEqual(['Bearer bot-test', 'Bearer broadcaster-test']);
      expect(subscriptions[0]?.body).toMatchObject({ type: 'channel.chat.message', condition: { broadcaster_user_id: '1', user_id: '2' }, transport: { session_id: 'chat-session' } });
      expect(coordinator.snapshot().twitch).toMatchObject({ status: 'connected', channel: 'test_channel', reward: 'active' });
      sockets[1]!.message('notification', { subscription: { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: '1', reward_id: 'reward-test' } },
        event: { id: 'redemption-test', broadcaster_user_id: '1', user_login: 'viewer_test', user_input: 'A fire boss with wide rings', status: 'unfulfilled', reward: { id: 'reward-test' } } });
      await microtasks(); await service.idle();
      expect(coordinator.snapshot().jobs[0]).toMatchObject({ source: 'twitch', status: 'pending' });
      expect(calls.filter((call) => call.path.endsWith('/redemptions') && call.method === 'PATCH')).toHaveLength(0);
      sockets[0]!.message('notification', { subscription: { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '1', user_id: '2' } },
        event: { broadcaster_user_id: '1', chatter_user_id: '1', chatter_user_login: 'test_channel', message_id: 'approve-message', badges: [], message: { text: `!approve ${coordinator.snapshot().jobs[0]!.id}` } } });
      await microtasks(); await service.idle(); await coordinator.idle(); await service.idle();
      expect(coordinator.snapshot().queue[0]?.spec.meta.creator).toBe('viewer_test');
      expect(calls.filter((call) => call.path.endsWith('/redemptions') && call.method === 'PATCH').map((call) => call.body.status)).toEqual(['FULFILLED']);
      expect(ForgeSnapshotSchema.safeParse(coordinator.snapshot()).success).toBe(true);
      const snapshot = JSON.stringify(coordinator.snapshot());
      for (const secret of ['bot-test', 'broadcaster-test', 'testsecret', 'refresh-test']) expect(snapshot).not.toContain(secret);
      sockets[1]!.emit('close'); await service.idle();
      expect(calls.filter((call) => call.path.endsWith('/custom_rewards') && call.method === 'PATCH').at(-1)?.body.is_paused).toBe(true);
    } finally { await service.close(); await coordinator.close(); }
  });
  it('keeps chat usable when Channel Points are unavailable', async () => {
    const { coordinator } = harness(), sockets: TestSocket[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/validate')) return json(identity(new Headers(init?.headers).get('Authorization') === 'OAuth bot-test' ? 'bot' : 'broadcaster'));
      if (url.includes('/custom_rewards')) return json({}, 403);
      return json({ data: [{ id: 'subscription-test' }] }, 202);
    };
    const service = new TwitchService(coordinator, twitchConfig(), { fetcher, persist: vi.fn(async () => {}), socket: () => { const socket = new TestSocket(); sockets.push(socket); return socket.asSocket(); } });
    try {
      await service.start(); expect(sockets).toHaveLength(1); sockets[0]!.welcome(); await microtasks(); await service.idle();
      expect(coordinator.snapshot().twitch).toMatchObject({ status: 'connected', reward: 'unavailable' });
      expect(coordinator.snapshot().twitch.message).toContain('!boss');
    } finally { await service.close(); await coordinator.close(); }
  });
});
