import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { SCOPES, type TokenRole, type TwitchConfig } from './config';

export class TwitchError extends Error {
  constructor(readonly status: number) { super(`Twitch request failed (${status}).`); }
}
export const TokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive() });
export const IdentitySchema = z.object({ client_id: z.string(), user_id: z.string(), login: z.string(), scopes: z.array(z.string()), expires_in: z.number() });
export type Identity = z.infer<typeof IdentitySchema>;
export async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new TwitchError(response.status);
  const body = await response.text();
  if (body.length > 1048576) throw new Error('Oversized Twitch response.');
  return JSON.parse(body) as unknown;
}
export function checkIdentity(input: unknown, clientId: string, role: TokenRole, expectedId?: string) {
  const identity = IdentitySchema.parse(input);
  if (identity.client_id !== clientId || (expectedId && identity.user_id !== expectedId) || SCOPES[role].some((scope) => !identity.scopes.includes(scope))) {
    throw new Error(`Wrong Twitch ${role} account, application, or scopes. Run npm run auth again.`);
  }
  return identity;
}
type Persist = (values: Record<string, string>) => Promise<void>;
export class TwitchApi {
  private readonly abort = new AbortController();
  private readonly refreshing = new Map<TokenRole, Promise<void>>();
  constructor(readonly config: TwitchConfig, private readonly persist: Persist, private readonly fetcher: typeof fetch = fetch) {}
  private signal() { return AbortSignal.any([this.abort.signal, AbortSignal.timeout(10000)]); }
  private access(role: TokenRole) { return role === 'bot' ? this.config.botAccess : this.config.broadcasterAccess; }
  private async identity(role: TokenRole, access = this.access(role)) {
    return checkIdentity(await responseJson(await this.fetcher('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${access}` }, signal: this.signal(), redirect: 'error',
    })), this.config.clientId, role, role === 'bot' ? this.config.botId : this.config.broadcasterId);
  }
  async validate(role: TokenRole) {
    try { return await this.identity(role); }
    catch (error) { if (!(error instanceof TwitchError) || error.status !== 401) throw error; await this.refresh(role); return this.identity(role); }
  }
  private async refresh(role: TokenRole) {
    const running = this.refreshing.get(role); if (running) return running;
    const task = (async () => {
      const token = TokenSchema.parse(await responseJson(await this.fetcher('https://id.twitch.tv/oauth2/token', {
        method: 'POST', body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
          grant_type: 'refresh_token', refresh_token: role === 'bot' ? this.config.botRefresh : this.config.broadcasterRefresh }),
        signal: this.signal(), redirect: 'error',
      })));
      await this.identity(role, token.access_token);
      const prefix = `TWITCH_${role.toUpperCase()}`;
      await this.persist({ [`${prefix}_ACCESS_TOKEN`]: token.access_token, [`${prefix}_REFRESH_TOKEN`]: token.refresh_token });
      if (role === 'bot') { this.config.botAccess = token.access_token; this.config.botRefresh = token.refresh_token; }
      else { this.config.broadcasterAccess = token.access_token; this.config.broadcasterRefresh = token.refresh_token; }
    })();
    this.refreshing.set(role, task);
    try { await task; } finally { this.refreshing.delete(role); }
  }
  async request(role: TokenRole, method: 'GET' | 'POST' | 'PATCH', path: string, query: Record<string, string> = {}, body?: unknown): Promise<unknown> {
    if (!/^[a-z_/]+$/.test(path)) throw new Error('Invalid Helix path.');
    const url = new URL(`https://api.twitch.tv/helix/${path}`); url.search = new URLSearchParams(query).toString();
    let refreshed = false, rateRetried = false;
    for (;;) {
      const access = this.access(role);
      const response = await this.fetcher(url, { method, headers: { Authorization: `Bearer ${access}`, 'Client-Id': this.config.clientId, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: this.signal(), redirect: 'error' });
      if (response.status === 401 && !refreshed) {
        await response.body?.cancel();
        // A parallel request may have already rotated this token.
        if (access === this.access(role)) await this.refresh(role);
        refreshed = true; continue;
      }
      if (response.status === 429 && !rateRetried) {
        const reset = Number(response.headers.get('Ratelimit-Reset')) * 1000 - Date.now();
        await response.body?.cancel();
        if (!Number.isFinite(reset) || reset > 30000) throw new TwitchError(429);
        await delay(Math.max(1000, reset + 100), undefined, { signal: this.abort.signal }); rateRetried = true; continue;
      }
      return responseJson(response);
    }
  }
  close() { this.abort.abort(); }
}
