import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { loadTwitchConfig, type TwitchConfig } from '../server/twitch/config';
import { authorizeUrl, SCOPES, TokenStore, type Fetch, type StoredToken, type TwitchRole } from '../server/twitch/auth';
import { EventSubConnection, type EventSubHandlers } from '../server/twitch/eventsub';
import { TwitchBridge } from '../server/twitch/bridge';
import type { Helix } from '../server/twitch/helix';
import { createForgeHttp } from '../server/http';
import { harness } from './forge-helpers';

const config: TwitchConfig = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:8787/auth/callback', command: '!boss', rewards: 'auto', rewardTitle: 'Forge a boss', rewardCost: 500 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Twitch config', () => {
  it('is optional, validates pairs, and pins the localhost callback', () => {
    expect(loadTwitchConfig({}, 8787)).toBeNull();
    expect(() => loadTwitchConfig({ TWITCH_CLIENT_ID: 'x' }, 8787)).toThrow(/both/);
    expect(() => loadTwitchConfig({ TWITCH_CLIENT_ID: 'x', TWITCH_CLIENT_SECRET: 'y', TWITCH_REDIRECT_URI: 'https://evil.example/auth/callback' }, 8787)).toThrow(/localhost/);
    const loaded = loadTwitchConfig({ TWITCH_CLIENT_ID: 'x', TWITCH_CLIENT_SECRET: 'y', TWITCH_COMMAND: '!Forge' }, 8787)!;
    expect(loaded.redirectUri).toBe('http://localhost:8787/auth/callback');
    expect(loaded.command).toBe('!forge');
  });
  it('requests the documented scopes with CSRF state', () => {
    const url = new URL(authorizeUrl(config, 'broadcaster', 'abc'));
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual([...SCOPES.broadcaster]);
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  });
});

describe('Twitch token store', () => {
  it('exchanges a code, checks app and scopes, persists, and refreshes before expiry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bf-twitch-')), file = join(dir, 'tokens.json');
    let now = 1_000_000;
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/token')) {
        const params = new URLSearchParams(String(init?.body));
        return json({ access_token: params.get('grant_type') === 'refresh_token' ? 'access-2' : 'access-1', refresh_token: 'refresh-x' });
      }
      return json({ client_id: 'cid', login: 'streamer', user_id: '42', scopes: [...SCOPES.broadcaster], expires_in: 3600 });
    }) as Fetch;
    const store = new TokenStore(config, file, fetchImpl, () => now);
    const token = await store.completeLogin('broadcaster', 'code-1');
    expect(token).toMatchObject({ userId: '42', login: 'streamer', accessToken: 'access-1' });
    expect(JSON.parse(await readFile(file, 'utf8')).tokens[0].refreshToken).toBe('refresh-x');
    expect((await store.fresh('broadcaster')).accessToken).toBe('access-1');
    now += 3600_000; // expired
    expect((await store.fresh('broadcaster')).accessToken).toBe('access-2');
    const reloaded = new TokenStore(config, file, fetchImpl, () => now); await reloaded.load();
    expect(reloaded.get('broadcaster')?.accessToken).toBe('access-2');
    await rm(dir, { recursive: true, force: true });
  });
  it('rejects tokens for another app or missing scopes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bf-twitch-'));
    const make = (validation: unknown) => new TokenStore(config, join(dir, 't.json'), (async (input: string | URL | Request) => String(input).endsWith('/token') ? json({ access_token: 'a', refresh_token: 'r' }) : json(validation)) as Fetch);
    await expect(make({ client_id: 'other', login: 's', user_id: '1', scopes: [...SCOPES.broadcaster], expires_in: 10 }).completeLogin('broadcaster', 'c')).rejects.toThrow(/different app/);
    await expect(make({ client_id: 'cid', login: 's', user_id: '1', scopes: ['user:read:chat'], expires_in: 10 }).completeLogin('broadcaster', 'c')).rejects.toThrow(/missing scopes/);
    await rm(dir, { recursive: true, force: true });
  });
});

class FakeSocket extends EventEmitter {
  closed = false;
  send(text: string) { this.emit('message', Buffer.from(text)); }
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  terminate() { this.close(); }
}
const welcome = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ metadata: { message_id: `w-${id}`, message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: 10, ...extra } } });

describe('EventSub WebSocket client', () => {
  it('subscribes on welcome, dedupes notifications, and migrates on session_reconnect without resubscribing', async () => {
    const sockets: { url: string; socket: FakeSocket }[] = [];
    const handlers = { onSession: vi.fn(async () => {}), onEvent: vi.fn(), onStatus: vi.fn() } satisfies EventSubHandlers;
    const connection = new EventSubConnection(handlers, 'wss://test/ws', (url) => { const socket = new FakeSocket(); sockets.push({ url, socket }); return socket as unknown as WebSocket; });
    connection.start();
    sockets[0]!.socket.send(welcome('s1'));
    await flush();
    expect(handlers.onSession).toHaveBeenCalledWith('s1');
    const note = JSON.stringify({ metadata: { message_id: 'n1', message_type: 'notification', subscription_type: 'channel.chat.message' }, payload: { event: { hi: 1 } } });
    sockets[0]!.socket.send(note); sockets[0]!.socket.send(note);
    expect(handlers.onEvent).toHaveBeenCalledTimes(1);
    sockets[0]!.socket.send(JSON.stringify({ metadata: { message_id: 'r1', message_type: 'session_reconnect' }, payload: { session: { id: 's1', reconnect_url: 'wss://test/reconnect' } } }));
    expect(sockets[1]!.url).toBe('wss://test/reconnect');
    sockets[1]!.socket.send(welcome('s1'));
    expect(sockets[0]!.socket.closed).toBe(true);
    expect(handlers.onSession).toHaveBeenCalledTimes(1);
    connection.stop();
  });
  it('reconnects and resubscribes after silence beyond the keepalive window', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const handlers = { onSession: vi.fn(async () => {}), onEvent: vi.fn(), onStatus: vi.fn() } satisfies EventSubHandlers;
    const connection = new EventSubConnection(handlers, 'wss://test/ws', () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; });
    connection.start(); sockets[0]!.send(welcome('s1'));
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1]!.send(welcome('s2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onSession).toHaveBeenLastCalledWith('s2');
    connection.stop();
  });
});

function fakeTokens(roles: Partial<Record<TwitchRole, StoredToken>>) {
  const store = { ...roles };
  return {
    get: (role: TwitchRole) => store[role] ?? null,
    chatRole: () => (store.bot ? 'bot' : store.broadcaster ? 'broadcaster' : null),
    fresh: async (role: TwitchRole) => store[role]!,
    completeLogin: vi.fn(), remove: vi.fn(async (role: TwitchRole) => { delete store[role]; }), validateAll: async () => [],
  } as unknown as TokenStore;
}
const token = (role: TwitchRole, userId: string, login: string): StoredToken => ({ role, userId, login, accessToken: 't', refreshToken: 'r', scopes: [...SCOPES[role]], expiresAt: Date.now() + 3_600_000 });
function fakeHelix(type = 'affiliate') {
  return {
    user: vi.fn(async () => ({ id: '42', login: 'streamer', display_name: 'Streamer', broadcaster_type: type })),
    manageableRewards: vi.fn(async () => []), createReward: vi.fn(async () => ({ id: 'reward-1', title: 'Forge a boss', cost: 500 })),
    subscribe: vi.fn(async () => {}), sendChat: vi.fn(async () => {}), resolveRedemption: vi.fn(async () => {}),
  };
}
function setupBridge(helix = fakeHelix(), roles: Partial<Record<TwitchRole, StoredToken>> = { broadcaster: token('broadcaster', '42', 'streamer') }, options = {}) {
  const { coordinator } = harness({}, { autoApprove: true, cooldownMs: 0, ...options });
  const handlers: EventSubHandlers[] = [];
  const bridge = new TwitchBridge(config, fakeTokens(roles), helix as unknown as Helix, coordinator, (h) => { handlers.push(h); return { start() {}, stop() {} }; }, 0);
  return { coordinator, bridge, helix, handlers };
}
const chat = (login: string, text: string, id = 'm1') => ({ chatter_user_id: `id-${login}`, chatter_user_login: login, message_id: id, message: { text } });
const said = (helix: ReturnType<typeof fakeHelix>) => helix.sendChat.mock.calls.map((call) => (call as unknown[])[3] as string);

describe('Twitch bridge', () => {
  it('subscribes to chat and the managed reward, then forges a !boss request and reports back', async () => {
    const { coordinator, bridge, helix, handlers } = setupBridge();
    await bridge.start();
    expect(helix.createReward).toHaveBeenCalled();
    await handlers[0]!.onSession('sess');
    expect(helix.subscribe).toHaveBeenCalledWith('broadcaster', 'channel.chat.message', '1', { broadcaster_user_id: '42', user_id: '42' }, 'sess');
    expect(helix.subscribe).toHaveBeenCalledWith('broadcaster', 'channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: '42', reward_id: 'reward-1' }, 'sess');
    handlers[0]!.onEvent('channel.chat.message', chat('viewer_one', '!boss a toaster that fires spirals'));
    await coordinator.idle(); await flush(); await flush();
    expect(coordinator.snapshot().jobs[0]).toMatchObject({ creator: 'viewer_one', source: 'twitch', status: 'queued' });
    expect(said(helix).some((text) => text.includes('@viewer_one got it'))).toBe(true);
    expect(said(helix).some((text) => text.includes('passed the fairness gate'))).toBe(true);
    expect(coordinator.snapshot().twitch).toMatchObject({ broadcaster: 'streamer', rewards: 'ready' });
    await bridge.stop();
  });

  it('ignores its own messages and short requests get usage help', async () => {
    const { coordinator, bridge, helix, handlers } = setupBridge();
    await bridge.start();
    handlers[0]!.onEvent('channel.chat.message', { ...chat('streamer', '!boss this is from the bot account'), chatter_user_id: '42' });
    handlers[0]!.onEvent('channel.chat.message', chat('viewer', '!boss hi'));
    await flush(); await flush();
    expect(coordinator.snapshot().jobs).toHaveLength(0);
    expect(said(helix)[0]).toContain('describe your boss');
    await bridge.stop();
  });

  it('fulfils a redemption when its boss is queued and refunds when it fails', async () => {
    const { coordinator, bridge, helix, handlers } = setupBridge();
    await bridge.start();
    handlers[0]!.onEvent('channel.channel_points_custom_reward_redemption.add', { id: 'red-1', user_login: 'fan', user_input: 'a polite laser cube', reward: { id: 'reward-1' } });
    await coordinator.idle(); await flush(); await flush();
    expect(helix.resolveRedemption).toHaveBeenCalledWith('42', 'reward-1', 'red-1', 'FULFILLED');

    const failing = setupBridge(fakeHelix(), undefined);
    const services = harness({ verify: async (_, job) => { const { verification } = await import('./forge-helpers'); return verification(job, false); } }, { autoApprove: true, cooldownMs: 0 });
    const bridge2 = new TwitchBridge(config, fakeTokens({ broadcaster: token('broadcaster', '42', 'streamer') }), failing.helix as unknown as Helix, services.coordinator, (h) => { failing.handlers.push(h); return { start() {}, stop() {} }; }, 0);
    await bridge2.start();
    failing.handlers.at(-1)!.onEvent('channel.channel_points_custom_reward_redemption.add', { id: 'red-2', user_login: 'fan', user_input: 'an impossible wall of bullets', reward: { id: 'reward-1' } });
    await services.coordinator.idle(); await flush(); await flush();
    expect(failing.helix.resolveRedemption).toHaveBeenCalledWith('42', 'reward-1', 'red-2', 'CANCELED');
    expect(said(failing.helix).some((text) => text.includes('Points refunded'))).toBe(true);
    await bridge.stop(); await bridge2.stop();
  });

  it('refunds immediately when the forge refuses a redemption, and skips rewards for non-affiliates', async () => {
    const { bridge, helix, handlers } = setupBridge(fakeHelix(), undefined, { cooldownMs: 60_000 });
    await bridge.start();
    const redeem = (id: string) => handlers[0]!.onEvent('channel.channel_points_custom_reward_redemption.add', { id, user_login: 'fan', user_input: 'a spinning crystal boss', reward: { id: 'reward-1' } });
    redeem('a'); await flush(); redeem('b'); await flush(); await flush();
    expect(helix.resolveRedemption).toHaveBeenCalledWith('42', 'reward-1', 'b', 'CANCELED');
    await bridge.stop();

    const plain = setupBridge(fakeHelix(''));
    await plain.bridge.start();
    expect(plain.helix.createReward).not.toHaveBeenCalled();
    expect(plain.coordinator.snapshot().twitch?.rewards).toBe('unavailable');
    await plain.handlers[0]!.onSession('s');
    expect(plain.helix.subscribe).toHaveBeenCalledTimes(1);
    await plain.bridge.stop();
  });

  it('reads and replies as a separate bot while redemptions stay on the broadcaster session', async () => {
    const { bridge, helix, handlers } = setupBridge(fakeHelix(), { broadcaster: token('broadcaster', '42', 'streamer'), bot: token('bot', '77', 'forgebot') });
    await bridge.start();
    expect(handlers).toHaveLength(2);
    await handlers[0]!.onSession('bot-session'); await handlers[1]!.onSession('owner-session');
    expect(helix.subscribe).toHaveBeenCalledWith('bot', 'channel.chat.message', '1', { broadcaster_user_id: '42', user_id: '77' }, 'bot-session');
    expect(helix.subscribe).toHaveBeenCalledWith('broadcaster', 'channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: '42', reward_id: 'reward-1' }, 'owner-session');
    handlers[0]!.onEvent('channel.chat.message', chat('viewer', '!fight'));
    await flush(); await flush();
    expect(helix.sendChat.mock.calls[0]).toEqual(['bot', '42', '77', 'No fight right now.', 'm1']);
    await bridge.stop();
  });
});

describe('Twitch HTTP routes', () => {
  it('redirects to Twitch, completes the callback, and explains when Twitch is off', async () => {
    const { coordinator } = harness();
    const routes = { loginUrl: vi.fn(() => 'https://id.twitch.tv/oauth2/authorize?x=1'), completeLogin: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) };
    const app = createForgeHttp(coordinator, 0, false, routes);
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const { port } = app.server.address() as { port: number }, url = `http://127.0.0.1:${port}`;
    const login = await fetch(`${url}/auth/twitch?role=bot`, { redirect: 'manual' });
    expect(login.status).toBe(302); expect(routes.loginUrl).toHaveBeenCalledWith('bot');
    const callback = await fetch(`${url}/auth/callback?code=c&state=s`, { redirect: 'manual' });
    expect(callback.headers.get('location')).toBe('/forge/?twitch=connected'); expect(routes.completeLogin).toHaveBeenCalledWith('c', 's');
    const denied = await fetch(`${url}/auth/callback?error=access_denied&error_description=%3Cb%3Enope`);
    expect(await denied.text()).toContain('&#60;b&#62;nope');
    await coordinator.close(); await app.close();

    const off = harness(), offApp = createForgeHttp(off.coordinator, 0);
    await new Promise<void>((resolve) => offApp.server.listen(0, '127.0.0.1', resolve));
    const offPort = (offApp.server.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${offPort}/auth/twitch`)).status).toBe(404);
    await off.coordinator.close(); await offApp.close();
  });
});
