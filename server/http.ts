import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { ForgeCoordinator, UserError } from './forge/coordinator';
import { PROJECT_ROOT } from './gate/files';

/** Twitch login hooks; absent when Twitch is not configured. */
export interface TwitchRoutes {
  loginUrl(role: 'broadcaster' | 'bot'): string;
  completeLogin(code: string, state: string): Promise<void>;
  disconnect(role: 'broadcaster' | 'bot'): Promise<void>;
}
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createForgeHttp(coordinator: ForgeCoordinator, port: number, production = false, twitch: TwitchRoutes | null = null) {
  const token = randomBytes(32).toString('hex');
  const origins = () => {
    const address = server.address(), actualPort = typeof address === 'object' && address ? address.port : port;
    return new Set([`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`]);
  };
  const allowedHost = (host: string | undefined) => host && origins().has(`http://${host}`);
  let frontend: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | null = null;
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const authorized = (req: IncomingMessage) => {
    const supplied = req.headers['x-forge-token'];
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  };
  const body = async (req: IncomingMessage): Promise<unknown> => {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new UserError('JSON content type required.', 415);
    if (Number(req.headers['content-length']) > 8192) { req.resume(); throw new UserError('Request exceeds 8 KiB.', 413); }
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) {
      const data = Buffer.from(chunk as Uint8Array); bytes += data.length;
      if (bytes > 8192) throw new UserError('Request exceeds 8 KiB.', 413);
      chunks.push(data);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UserError('Invalid JSON.'); }
  };
  const server = createServer((req, res) => { void (async () => {
    if (!allowedHost(req.headers.host) || (req.headers.origin && !origins().has(req.headers.origin))) { json(res, 403, { error: 'Local same-origin access only.' }); return; }
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`), path = url.pathname;
    if (req.method === 'GET' && (path === '/auth/twitch' || path === '/auth/callback')) {
      const page = (status: number, message: string) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Boss Forge · Twitch</title><body style="font:16px system-ui;background:#111411;color:#ecede4;padding:40px"><h1>Twitch connection</h1><p>${escapeHtml(message)}</p><p><a style="color:#cbf579" href="/forge/">Back to the forge</a></p></body>`);
      };
      if (!twitch) { page(404, 'Twitch is not configured. Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to .env.local and restart.'); return; }
      if (path === '/auth/twitch') {
        const role = url.searchParams.get('role') === 'bot' ? 'bot' : 'broadcaster';
        res.writeHead(302, { location: twitch.loginUrl(role), 'cache-control': 'no-store' }); res.end(); return;
      }
      const code = url.searchParams.get('code'), state = url.searchParams.get('state');
      if (!code || !state) { page(400, url.searchParams.get('error_description') || 'Twitch did not return an authorization code.'); return; }
      try { await twitch.completeLogin(code, state); res.writeHead(302, { location: '/forge/?twitch=connected' }); res.end(); }
      catch (error) { page(400, error instanceof Error ? error.message : 'Twitch login failed.'); }
      return;
    }
    if (path.startsWith('/api/')) {
      try {
        if (req.method === 'GET' && path === '/api/state') { json(res, 200, coordinator.snapshot()); return; }
        if (req.method === 'GET' && path === '/api/session') { json(res, 200, { token }); return; }
        if (req.method !== 'POST') { json(res, 404, { error: 'Unknown route.' }); return; }
        if (!authorized(req)) { json(res, 403, { error: 'Local control token required.' }); return; }
        if (path === '/api/requests') { json(res, 201, await coordinator.submit(await body(req), 'local')); return; }
        if (path === '/api/review') {
          const parsed = z.strictObject({ id: z.string().max(64), approve: z.boolean() }).safeParse(await body(req));
          if (!parsed.success) throw new UserError('Invalid review request.');
          await coordinator.review(parsed.data.id, parsed.data.approve); json(res, 200, { ok: true }); return;
        }
        if (path === '/api/twitch/disconnect') {
          const parsed = z.strictObject({ role: z.enum(['broadcaster', 'bot']) }).safeParse(await body(req));
          if (!parsed.success || !twitch) throw new UserError('Twitch is not configured.');
          await twitch.disconnect(parsed.data.role); json(res, 200, { ok: true }); return;
        }
        if (path === '/api/claim') { json(res, 200, coordinator.claimNext()); return; }
        if (path === '/api/finish') {
          const parsed = z.strictObject({ id: z.string().max(64), outcome: z.enum(['won', 'lost', 'skipped']) }).safeParse(await body(req));
          if (!parsed.success) throw new UserError('Invalid fight result.');
          await coordinator.finishFight(parsed.data.id, parsed.data.outcome); json(res, 200, { ok: true }); return;
        }
        json(res, 404, { error: 'Unknown route.' });
      } catch (error) { json(res, error instanceof UserError ? error.status : 500, { error: error instanceof UserError ? error.message : 'The local forge could not complete this action.' }); }
      return;
    }
    if (frontend) { frontend(req, res, () => { res.writeHead(404); res.end('Not found'); }); return; }
    if (production) {
      try {
        const root = resolve(PROJECT_ROOT, 'dist', 'web');
        const decoded = decodeURIComponent(path), file = resolve(root, `.${decoded.endsWith('/') ? `${decoded}index.html` : decoded}`);
        if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('Missing asset.');
        const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' }); res.end(await readFile(file));
      } catch { res.writeHead(404); res.end('Not found'); }
      return;
    }
    res.writeHead(503); res.end('Local preview is starting.');
  })().catch(() => { if (!res.headersSent) json(res, 500, { error: 'Local server error.' }); else res.end(); }); });
  server.requestTimeout = 10000; server.headersTimeout = 5000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url || '/', 'http://localhost').pathname !== '/ws') return;
    if (!allowedHost(req.headers.host) || (req.headers.origin && !origins().has(req.headers.origin)) || wss.clients.size >= 16) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify(coordinator.snapshot()));
      ws.on('error', () => ws.terminate());
      ws.on('message', () => ws.close(1008, 'Read-only event stream.'));
    });
  });
  const unsubscribe = coordinator.subscribe((state) => {
    const payload = JSON.stringify(state);
    for (const client of wss.clients) {
      if (client.bufferedAmount > 1024 * 1024) { client.terminate(); continue; }
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });
  return {
    server,
    setFrontend(middleware: typeof frontend) { frontend = middleware; },
    async close() { unsubscribe(); for (const client of wss.clients) client.terminate(); await new Promise<void>((resolveClose) => wss.close(() => resolveClose())); await new Promise<void>((resolveClose) => server.close(() => resolveClose())); },
  };
}
