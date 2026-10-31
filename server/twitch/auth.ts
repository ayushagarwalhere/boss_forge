import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SCOPES, type TokenRole } from './config';

export function redirectUri(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/auth/callback' || !url.port || Number(url.port) < 1024) {
    throw new Error('TWITCH_REDIRECT_URI must be http://localhost:PORT/auth/callback (or 127.0.0.1), with PORT >= 1024.');
  }
  return url;
}
export class OAuthAttempt {
  private readonly state = randomBytes(32).toString('hex');
  private used = false;
  private readonly expires: number;
  constructor(private readonly now = Date.now) { this.expires = now() + 600000; }
  url(clientId: string, redirect: string, role: TokenRole) {
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES[role].join(' '), state: this.state, force_verify: 'true' }).toString();
    return url.toString();
  }
  consume(query: URLSearchParams) {
    const state = query.get('state') ?? '';
    if (this.used || this.now() >= this.expires || query.getAll('state').length !== 1 || !/^[a-f0-9]{64}$/.test(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(this.state))) throw new Error('Invalid or expired OAuth state.');
    this.used = true;
    const code = query.get('code');
    if (query.has('error') || query.getAll('code').length !== 1 || !code || code.length > 2048) throw new Error('Twitch authorization was declined or invalid.');
    return code;
  }
}
