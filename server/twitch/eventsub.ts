import WebSocket from 'ws';
import { z } from 'zod';

const Envelope = z.object({
  metadata: z.object({ message_id: z.string().min(1).max(256), message_type: z.string(), message_timestamp: z.iso.datetime() }),
  payload: z.record(z.string(), z.unknown()),
});
const Session = z.object({ id: z.string().min(1).max(1024), keepalive_timeout_seconds: z.number().min(10).max(600).nullable().optional(), reconnect_url: z.string().nullable().optional() });
export function reconnectUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'wss:' || url.hostname !== 'eventsub.wss.twitch.tv' || url.port || url.username || url.password || url.hash) throw new Error('Invalid EventSub reconnect URL.');
  return value;
}
type Options = {
  subscribe: (session: string) => Promise<void>;
  notification: (subscription: unknown, event: unknown) => void;
  status: (status: 'connecting' | 'connected' | 'error', message: string) => void;
};
type Connection = { ws: WebSocket; inherited: boolean; welcomed: boolean; timeout: ReturnType<typeof setTimeout> | null; seconds: number };
const ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
export class EventSub {
  private current: Connection | null = null;
  private pending: Connection | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private failures = 0;
  private readonly seen = new Map<string, number>();
  constructor(private readonly options: Options, private readonly socket = (url: string) => new WebSocket(url, { maxPayload: 131072, handshakeTimeout: 10000 })) {}
  start() { if (!this.stopped) return; this.stopped = false; this.open(ENDPOINT, false); }
  private open(url: string, inherited: boolean) {
    if (this.stopped) return;
    this.options.status('connecting', inherited ? 'Twitch is moving the connection.' : 'Connecting to Twitch EventSub.');
    const connection: Connection = { ws: this.socket(url), inherited, welcomed: false, timeout: null, seconds: 10 };
    if (inherited) this.pending = connection; else this.current = connection;
    this.watch(connection);
    connection.ws.on('message', (data) => { void this.receive(connection, data.toString()).catch(() => this.restart('Twitch subscription failed; reconnecting.')); });
    connection.ws.on('error', () => { if (this.owns(connection)) this.restart('Twitch connection failed; reconnecting.'); });
    connection.ws.on('close', () => { if (this.owns(connection)) this.restart('Twitch connection closed; reconnecting.'); });
  }
  private owns(connection: Connection) { return !this.stopped && (this.current === connection || this.pending === connection); }
  private watch(connection: Connection) {
    if (connection.timeout) clearTimeout(connection.timeout);
    connection.timeout = setTimeout(() => { if (this.owns(connection)) this.restart('Twitch keepalive timed out; reconnecting.'); }, (connection.seconds + 2) * 1000);
  }
  private async receive(connection: Connection, data: string) {
    if (!this.owns(connection) || data.length > 131072) return;
    const parsed = Envelope.safeParse(JSON.parse(data)); if (!parsed.success) return;
    const { metadata, payload } = parsed.data;
    const time = Date.parse(metadata.message_timestamp), now = Date.now();
    if (Math.abs(now - time) > 600000) return;
    this.watch(connection);
    if (metadata.message_type === 'session_welcome') {
      if (connection.welcomed) return;
      const session = Session.parse(payload.session); connection.welcomed = true;
      connection.seconds = session.keepalive_timeout_seconds ?? 30; this.watch(connection);
      if (!connection.inherited) await this.options.subscribe(session.id);
      if (!this.owns(connection)) return;
      if (connection.inherited) {
        const old = this.current; this.current = connection; this.pending = null;
        if (old) this.dispose(old);
      }
      this.failures = 0; this.options.status('connected', 'Twitch EventSub connected.'); return;
    }
    if (!connection.welcomed) return;
    if (metadata.message_type === 'session_reconnect') {
      if (this.pending || connection !== this.current) return;
      const session = Session.parse(payload.session);
      if (session.reconnect_url) this.open(reconnectUrl(session.reconnect_url), true);
      return;
    }
    if (metadata.message_type === 'revocation') { this.close(); this.options.status('error', 'Twitch revoked a subscription. Reauthorize and restart Boss Forge.'); return; }
    if (metadata.message_type !== 'notification') return;
    for (const [id, at] of this.seen) if (now - at > 600000) this.seen.delete(id);
    if (this.seen.has(metadata.message_id)) return;
    this.seen.set(metadata.message_id, now);
    if (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
    this.options.notification(payload.subscription, payload.event);
  }
  private dispose(connection: Connection) { if (connection.timeout) clearTimeout(connection.timeout); connection.ws.removeAllListeners(); connection.ws.on('error', () => {}); connection.ws.terminate(); }
  private restart(message: string) {
    if (this.stopped || this.retry) return;
    const current = this.current, pending = this.pending; this.current = null; this.pending = null;
    if (current) this.dispose(current); if (pending) this.dispose(pending);
    this.options.status('connecting', message);
    this.retry = setTimeout(() => { this.retry = null; this.open(ENDPOINT, false); }, Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)));
  }
  close() {
    this.stopped = true; if (this.retry) clearTimeout(this.retry); this.retry = null;
    const current = this.current, pending = this.pending; this.current = null; this.pending = null;
    if (current) this.dispose(current); if (pending) this.dispose(pending);
  }
}
