import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { TwitchConfig } from './config';

// Verified against https://dev.twitch.tv/docs/authentication/ (authorization code grant,
// refresh, hourly /validate) and https://dev.twitch.tv/docs/authentication/scopes/.
export type TwitchRole = 'broadcaster' | 'bot';
export const SCOPES: Record<TwitchRole, readonly string[]> = {
  // Broadcaster: read/send chat, let a separate bot account chat here, own the channel-point reward.
  broadcaster: ['user:read:chat', 'user:write:chat', 'channel:bot', 'channel:read:redemptions', 'channel:manage:redemptions'],
  // Optional bot account that reads and replies in the broadcaster's chat.
  bot: ['user:read:chat', 'user:write:chat', 'user:bot'],
};
const ID = 'https://id.twitch.tv/oauth2';
export type Fetch = typeof fetch;

const TokenResponse = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().optional(), scope: z.array(z.string()).optional() });
const Validation = z.object({ client_id: z.string(), login: z.string(), user_id: z.string(), scopes: z.array(z.string()).nullable().optional(), expires_in: z.number() });
const Stored = z.strictObject({
  role: z.enum(['broadcaster', 'bot']), userId: z.string(), login: z.string(),
  accessToken: z.string(), refreshToken: z.string(), scopes: z.array(z.string()), expiresAt: z.number(),
});
export type StoredToken = z.infer<typeof Stored>;
const StoreFile = z.strictObject({ version: z.literal(1), tokens: z.array(Stored).max(2) });

export class TwitchAuthError extends Error {}

export function authorizeUrl(config: TwitchConfig, role: TwitchRole, state: string): string {
  const url = new URL(`${ID}/authorize`);
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, scope: SCOPES[role].join(' '), state, force_verify: 'true' }).toString();
  return url.toString();
}

async function tokenRequest(fetchImpl: Fetch, params: Record<string, string>) {
  const response = await fetchImpl(`${ID}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  if (!response.ok) throw new TwitchAuthError(`Twitch token request failed (${response.status}).`);
  return TokenResponse.parse(await response.json());
}

export async function validateToken(fetchImpl: Fetch, accessToken: string) {
  const response = await fetchImpl(`${ID}/validate`, { headers: { authorization: `OAuth ${accessToken}` } });
  if (response.status === 401) return null;
  if (!response.ok) throw new TwitchAuthError(`Twitch token validation failed (${response.status}).`);
  return Validation.parse(await response.json());
}

/** Persists user tokens in the ignored .artifacts folder; never in git or the browser. */
export class TokenStore {
  private tokens = new Map<TwitchRole, StoredToken>();
  private refreshing = new Map<TwitchRole, Promise<StoredToken>>();
  constructor(private readonly config: TwitchConfig, private readonly file: string, private readonly fetchImpl: Fetch = fetch, private readonly now: () => number = Date.now) {}

  async load() {
    try {
      const parsed = StoreFile.parse(JSON.parse(await readFile(this.file, 'utf8')));
      for (const token of parsed.tokens) this.tokens.set(token.role, token);
    } catch { this.tokens.clear(); }
  }
  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify({ version: 1, tokens: [...this.tokens.values()] }, null, 2), { mode: 0o600 });
    await chmod(this.file, 0o600).catch(() => {});
  }
  get(role: TwitchRole): StoredToken | null { return this.tokens.get(role) ?? null; }
  /** The account that reads and sends chat: the bot if connected, else the broadcaster. */
  chatRole(): TwitchRole | null { return this.tokens.has('bot') ? 'bot' : this.tokens.has('broadcaster') ? 'broadcaster' : null; }

  async completeLogin(role: TwitchRole, code: string): Promise<StoredToken> {
    const raw = await tokenRequest(this.fetchImpl, { client_id: this.config.clientId, client_secret: this.config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: this.config.redirectUri });
    const info = await validateToken(this.fetchImpl, raw.access_token);
    if (!info || info.client_id !== this.config.clientId) throw new TwitchAuthError('Twitch returned a token for a different app.');
    const missing = SCOPES[role].filter((scope) => !(info.scopes ?? []).includes(scope));
    if (missing.length) throw new TwitchAuthError(`Twitch login is missing scopes: ${missing.join(', ')}.`);
    const other = role === 'bot' ? this.tokens.get('broadcaster') : this.tokens.get('bot');
    if (other && other.userId === info.user_id) throw new TwitchAuthError('Use a different Twitch account for the bot, or skip the bot and let the broadcaster account reply.');
    const token: StoredToken = { role, userId: info.user_id, login: info.login, accessToken: raw.access_token, refreshToken: raw.refresh_token, scopes: info.scopes ?? [], expiresAt: this.now() + info.expires_in * 1000 };
    this.tokens.set(role, token); await this.save(); return token;
  }

  async remove(role: TwitchRole) { this.tokens.delete(role); await this.save(); }

  /** Access token that is valid for at least five more minutes. */
  async fresh(role: TwitchRole, force = false): Promise<StoredToken> {
    const token = this.tokens.get(role);
    if (!token) throw new TwitchAuthError(`Twitch ${role} account is not connected.`);
    if (!force && token.expiresAt - this.now() > 5 * 60_000) return token;
    const pending = this.refreshing.get(role);
    if (pending) return pending;
    const task = (async () => {
      try {
        const raw = await tokenRequest(this.fetchImpl, { client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'refresh_token', refresh_token: token.refreshToken });
        const info = await validateToken(this.fetchImpl, raw.access_token);
        if (!info) throw new TwitchAuthError('Refreshed Twitch token was rejected.');
        const next: StoredToken = { ...token, accessToken: raw.access_token, refreshToken: raw.refresh_token, scopes: info.scopes ?? token.scopes, expiresAt: this.now() + info.expires_in * 1000 };
        this.tokens.set(role, next); await this.save(); return next;
      } catch (error) {
        if (error instanceof TwitchAuthError) { this.tokens.delete(role); await this.save(); }
        throw new TwitchAuthError(`Twitch ${role} session expired. Reconnect it from the forge page.`);
      } finally { this.refreshing.delete(role); }
    })();
    this.refreshing.set(role, task);
    return task;
  }

  /** Twitch requires apps to validate tokens hourly; a revoked token is dropped. */
  async validateAll(): Promise<TwitchRole[]> {
    const revoked: TwitchRole[] = [];
    for (const [role, token] of [...this.tokens]) {
      const info = await validateToken(this.fetchImpl, token.accessToken).catch(() => undefined);
      if (info === null) {
        try { await this.fresh(role, true); } catch { revoked.push(role); }
      }
    }
    return revoked;
  }

  async clear() { this.tokens.clear(); await rm(this.file, { force: true }); }
}
