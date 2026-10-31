import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'dotenv';
import { OAuthAttempt, redirectUri } from '../server/twitch/auth';
import { checkIdentity, TwitchApi } from '../server/twitch/api';
import { twitchConfig as loadTwitch } from '../server/twitch/config';
import { saveEnvironment } from '../server/twitch/environment';
import { identity, json, twitchConfig } from './twitch-helpers';

describe('Twitch OAuth and token ownership', () => {
  it('uses expiring, one-use state and separate broadcaster and bot scopes', () => {
    let now = 100; const attempt = new OAuthAttempt(() => now);
    const url = new URL(attempt.url('testclient', 'http://localhost:8787/auth/callback', 'bot'));
    expect(url.searchParams.get('scope')).toBe('user:read:chat user:write:chat');
    const query = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'test-code' });
    expect(() => attempt.consume(new URLSearchParams({ state: 'wrong', code: 'test-code' }))).toThrow();
    expect(attempt.consume(query)).toBe('test-code'); expect(() => attempt.consume(query)).toThrow();
    const expired = new OAuthAttempt(() => now), expiredUrl = new URL(expired.url('testclient', 'http://localhost:8787/auth/callback', 'broadcaster'));
    expect(expiredUrl.searchParams.get('scope')).toContain('channel:manage:redemptions');
    now += 600001; expect(() => expired.consume(new URLSearchParams({ state: expiredUrl.searchParams.get('state')!, code: 'test-code' }))).toThrow();
  });
  it('rejects remote callbacks and incorrect users, applications and scopes', () => {
    expect(redirectUri('http://localhost:8787/auth/callback').hostname).toBe('localhost');
    for (const url of ['https://remote.example/auth/callback', 'http://localhost:8787/auth/callback?x=1', 'http://user@localhost:8787/auth/callback']) expect(() => redirectUri(url)).toThrow();
    expect(() => checkIdentity(identity('bot'), 'testclient', 'bot', '1')).toThrow();
    expect(() => checkIdentity(identity('bot'), 'wrongclient', 'bot', '2')).toThrow();
    expect(() => checkIdentity({ ...identity('bot'), scopes: [] }, 'testclient', 'bot', '2')).toThrow();
    expect(loadTwitch({ TWITCH_ENABLED: 'true' }, true)).toBeNull();
    expect(() => loadTwitch({ TWITCH_ENABLED: 'true' }, false)).toThrow('configuration');
  });
  it('coalesces parallel 401 refreshes, checks the new owner, and persists both rotated tokens', async () => {
    const persist = vi.fn(async () => {});
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/token')) return json({ access_token: 'rotated-test', refresh_token: 'rotated-refresh-test', expires_in: 3600 });
      if (url.endsWith('/validate')) return json(identity('bot'));
      return new Headers(init?.headers).get('Authorization') === 'Bearer bot-test' ? json({}, 401) : json({ data: [] });
    });
    const api = new TwitchApi(twitchConfig(), persist, fetcher);
    await Promise.all([api.request('bot', 'GET', 'users'), api.request('bot', 'GET', 'users')]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith({ TWITCH_BOT_ACCESS_TOKEN: 'rotated-test', TWITCH_BOT_REFRESH_TOKEN: 'rotated-refresh-test' });
    api.close();
  });
  it('does not adopt a refreshed token for another account or retry ambiguous POST failures', async () => {
    const persist = vi.fn(async () => {});
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/token')) return json({ access_token: 'wrong-test', refresh_token: 'wrong-refresh-test', expires_in: 3600 });
      if (String(input).endsWith('/validate')) return json(identity('broadcaster'));
      return json({}, 401);
    });
    const api = new TwitchApi(twitchConfig(), persist, fetcher);
    await expect(api.request('bot', 'GET', 'users')).rejects.toThrow('Wrong Twitch bot'); expect(persist).not.toHaveBeenCalled(); api.close();
    const unavailable = vi.fn<typeof fetch>(async () => { throw new Error('Simulated disconnected transport'); });
    const api2 = new TwitchApi(twitchConfig(), persist, unavailable);
    await expect(api2.request('bot', 'POST', 'chat/messages', {}, {})).rejects.toThrow(); expect(unavailable).toHaveBeenCalledTimes(1); api2.close();
  });
  it('respects rate-limit reset once and rejects unbounded retries', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 429, { 'Ratelimit-Reset': String(Date.now() / 1000 + 2) })).mockResolvedValueOnce(json({ data: [] }));
      const api = new TwitchApi(twitchConfig(), async () => {}, fetcher);
      const request = api.request('bot', 'GET', 'users');
      await vi.advanceTimersByTimeAsync(2200); await request; expect(fetcher).toHaveBeenCalledTimes(2); api.close();
      const later = new TwitchApi(twitchConfig(), async () => {}, async () => json({}, 429, { 'Ratelimit-Reset': String(Date.now() / 1000 + 120) }));
      await expect(later.request('bot', 'GET', 'users')).rejects.toMatchObject({ status: 429 }); later.close();
    } finally { vi.useRealTimers(); }
  });
  it('serializes local updates, preserves other settings and escapes token punctuation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boss-forge-auth-'));
    try {
      const path = join(directory, '.env.local'); await writeFile(path, '# local settings\nOPENAI_API_KEY=unrelated-test\n');
      await Promise.all([saveEnvironment({ TWITCH_BOT_REFRESH_TOKEN: 'test$%\\"value' }, path), saveEnvironment({ TWITCH_REWARD_ID: 'reward-test' }, path)]);
      const values = parse(await readFile(path));
      expect(values.OPENAI_API_KEY).toBe('unrelated-test'); expect(values.TWITCH_REWARD_ID).toBe('reward-test');
      expect(values.TWITCH_BOT_REFRESH_TOKEN).toBe('test$%\\"value');
      await expect(saveEnvironment({ TWITCH_REWARD_ID: 'invalid\nline' }, path)).rejects.toThrow();
    } finally { if (dirname(directory) === tmpdir() && directory.startsWith(join(tmpdir(), 'boss-forge-auth-'))) await rm(directory, { recursive: true, force: true }); }
  });
});
