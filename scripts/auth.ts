import { createServer } from 'node:http';
import { config as dotenv } from 'dotenv';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../server/gate/files';
import { OAuthAttempt, redirectUri } from '../server/twitch/auth';
import { checkIdentity, responseJson, TokenSchema } from '../server/twitch/api';
import { saveEnvironment } from '../server/twitch/environment';

dotenv({ path: join(PROJECT_ROOT, '.env.local'), quiet: true });
const role = process.argv[2] ?? 'broadcaster';
if (role !== 'broadcaster' && role !== 'bot') throw new Error('Usage: npm run auth -- broadcaster|bot');
const clientId = process.env.TWITCH_CLIENT_ID, clientSecret = process.env.TWITCH_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env.local first.');
const redirect = redirectUri(process.env.TWITCH_REDIRECT_URI || 'http://localhost:8787/auth/callback');
const attempt = new OAuthAttempt();
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (request.method !== 'GET' || request.headers.host !== redirect.host) { response.writeHead(400).end('Invalid callback host.'); return; }
  const url = new URL(request.url ?? '/', redirect);
  if (url.pathname !== '/auth/callback') { response.writeHead(404).end('Use the Twitch authorization link printed in your terminal.'); return; }
  let code: string;
  try { code = attempt.consume(url.searchParams); }
  catch { response.writeHead(400).end('Authorization declined, expired, or state mismatch. Restart npm run auth.'); return; }
  void (async () => {
    try {
      const token = TokenSchema.parse(await responseJson(await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirect.toString() }),
        signal: AbortSignal.timeout(10000), redirect: 'error',
      })));
      const prefix = `TWITCH_${role.toUpperCase()}`;
      const identity = checkIdentity(await responseJson(await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${token.access_token}` }, signal: AbortSignal.timeout(10000), redirect: 'error',
      })), clientId, role, process.env[`${prefix}_ID`] || undefined);
      await saveEnvironment({ [`${prefix}_ACCESS_TOKEN`]: token.access_token, [`${prefix}_REFRESH_TOKEN`]: token.refresh_token, [`${prefix}_ID`]: identity.user_id });
      response.end(`Authorized ${role} @${identity.login}. Tokens saved locally. You may close this tab.`);
      console.log(`Authorized ${role} @${identity.login}. Credentials saved to ignored .env.local.`);
    } catch { response.writeHead(400).end('Authorization failed. Check account, client settings and scopes, then restart npm run auth.'); process.exitCode = 1; }
    finally { clearTimeout(timer); server.close(); }
  })();
});
server.requestTimeout = 15000;
const timer = setTimeout(() => { console.log('Authorization expired. Run npm run auth again.'); server.close(); }, 600000);
server.once('error', () => { clearTimeout(timer); console.error('Cannot start auth helper. Stop Boss Forge or choose another registered callback port.'); process.exitCode = 1; });
process.once('SIGINT', () => { clearTimeout(timer); server.close(); });
server.listen(Number(redirect.port), '127.0.0.1', () => {
  console.log(`Authorize the ${role} account. Register this exact callback in your Twitch developer application: ${redirect}\n${attempt.url(clientId, redirect.toString(), role)}`);
});
