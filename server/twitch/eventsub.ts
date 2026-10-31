import WebSocket from 'ws';
import { z } from 'zod';

// Behavior follows https://dev.twitch.tv/docs/eventsub/handling-websocket-events/:
// subscribe within 10 s of session_welcome; treat silence past keepalive_timeout_seconds as a
// dead link; on session_reconnect open reconnect_url and keep the old socket until its welcome
// (subscriptions carry over); never send anything but pongs; a dropped session loses its
// subscriptions, so a fresh connection resubscribes.
export const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

const Envelope = z.object({
  metadata: z.object({ message_id: z.string(), message_type: z.string(), subscription_type: z.string().optional() }),
  payload: z.object({
    session: z.object({ id: z.string(), keepalive_timeout_seconds: z.number().nullable().optional(), reconnect_url: z.string().nullable().optional() }).optional(),
    subscription: z.object({ type: z.string(), status: z.string().optional() }).optional(),
    event: z.unknown().optional(),
  }),
});

export interface EventSubHandlers {
  /** New session (first connect or after a drop): create subscriptions within 10 seconds. */
  onSession(sessionId: string): Promise<void>;
  onEvent(type: string, event: unknown): void;
  onStatus(connected: boolean, detail: string): void;
}
type SocketFactory = (url: string) => WebSocket;

export class EventSubConnection {
  private socket: WebSocket | null = null;
  private keepalive: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private keepaliveMs = 30_000;
  private backoff = 1000;
  private stopped = false;
  private readonly seen: string[] = [];
  private readonly seenSet = new Set<string>();

  constructor(private readonly handlers: EventSubHandlers, private readonly url = EVENTSUB_URL, private readonly socketFactory: SocketFactory = (target) => new WebSocket(target)) {}

  start() { this.stopped = false; this.open(this.url, false); }

  stop() {
    this.stopped = true;
    if (this.keepalive) clearTimeout(this.keepalive);
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close(1000); this.socket = null;
  }

  private armKeepalive() {
    if (this.keepalive) clearTimeout(this.keepalive);
    this.keepalive = setTimeout(() => { this.handlers.onStatus(false, 'Twitch EventSub went quiet; reconnecting.'); this.socket?.terminate(); }, this.keepaliveMs + 5000);
  }

  private open(url: string, migrating: boolean) {
    const socket = this.socketFactory(url);
    const previous = this.socket;
    if (!migrating) this.socket = socket;
    socket.on('message', (raw) => {
      let message: z.infer<typeof Envelope>;
      try { message = Envelope.parse(JSON.parse(String(raw))); } catch { return; }
      const { message_id: id, message_type: type } = message.metadata;
      if (type === 'session_welcome' && message.payload.session) {
        this.keepaliveMs = (message.payload.session.keepalive_timeout_seconds ?? 30) * 1000;
        this.backoff = 1000;
        if (migrating) {
          // Reconnect: subscriptions moved with the session; retire the old socket now.
          this.socket = socket; previous?.removeAllListeners('close'); previous?.close(1000);
          this.armKeepalive(); this.handlers.onStatus(true, 'Twitch EventSub reconnected.');
          return;
        }
        this.armKeepalive();
        this.handlers.onSession(message.payload.session.id)
          .then(() => this.handlers.onStatus(true, 'Listening to Twitch chat.'))
          .catch((error: unknown) => { this.handlers.onStatus(false, error instanceof Error ? error.message : 'Twitch subscription failed.'); socket.close(1000); });
        return;
      }
      if (socket !== this.socket) return;
      this.armKeepalive();
      if (type === 'session_reconnect' && message.payload.session?.reconnect_url) {
        const target = message.payload.session.reconnect_url;
        if (target.startsWith('wss://')) this.open(target, true);
        return;
      }
      if (type === 'revocation') {
        this.handlers.onStatus(false, `Twitch revoked ${message.payload.subscription?.type ?? 'a subscription'} (${message.payload.subscription?.status ?? 'unknown'}). Reconnect the account.`);
        return;
      }
      if (type === 'notification' && message.metadata.subscription_type) {
        if (this.seenSet.has(id)) return; // Twitch may redeliver a notification; handle it once.
        this.seenSet.add(id); this.seen.push(id);
        if (this.seen.length > 500) this.seenSet.delete(this.seen.shift()!);
        this.handlers.onEvent(message.metadata.subscription_type, message.payload.event);
      }
    });
    socket.on('error', () => { /* close follows */ });
    socket.on('close', () => {
      if (socket !== this.socket || this.stopped) return;
      if (this.keepalive) clearTimeout(this.keepalive);
      this.handlers.onStatus(false, 'Twitch EventSub disconnected; retrying.');
      this.socket = null;
      this.retry = setTimeout(() => this.open(this.url, false), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    });
  }
}
