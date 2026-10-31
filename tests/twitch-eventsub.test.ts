import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventSub, reconnectUrl } from '../server/twitch/eventsub';
import { microtasks, TestSocket } from './twitch-helpers';

afterEach(() => vi.useRealTimers());
function setup() {
  const sockets: TestSocket[] = [], urls: string[] = [];
  const subscribe = vi.fn(async () => {}), notification = vi.fn(), status = vi.fn();
  const eventsub = new EventSub({ subscribe, notification, status }, (url) => { urls.push(url); const socket = new TestSocket(); sockets.push(socket); return socket.asSocket(); });
  eventsub.start(); return { eventsub, sockets, urls, subscribe, notification, status };
}
describe('EventSub transport', () => {
  it('subscribes after welcome, deduplicates notifications and hands reconnects over without resubscribing', async () => {
    const { eventsub, sockets, urls, subscribe, notification } = setup();
    try {
      const old = sockets[0]!; old.welcome(); await microtasks(); expect(subscribe).toHaveBeenCalledExactlyOnceWith('session-1');
      const event = { subscription: { type: 'test' }, event: { user: 'viewer' } };
      old.message('notification', event, 'same-event'); old.message('notification', event, 'same-event'); expect(notification).toHaveBeenCalledTimes(1);
      const url = 'wss://eventsub.wss.twitch.tv/ws?reconnect=test';
      old.message('session_reconnect', { session: { id: 'session-1', reconnect_url: url } });
      expect(urls[1]).toBe(url); expect(old.terminated).toBe(0);
      sockets[1]!.welcome('session-2'); await microtasks();
      expect(old.terminated).toBe(1); expect(subscribe).toHaveBeenCalledTimes(1);
      sockets[1]!.message('notification', event, 'same-event'); expect(notification).toHaveBeenCalledTimes(1);
    } finally { eventsub.close(); }
  });
  it('reconnects and recreates subscriptions after a keepalive gap', async () => {
    vi.useFakeTimers(); const { eventsub, sockets, subscribe } = setup();
    try {
      sockets[0]!.welcome(); await microtasks();
      await vi.advanceTimersByTimeAsync(33001);
      expect(sockets[0]!.terminated).toBe(1); expect(sockets).toHaveLength(2);
      sockets[1]!.welcome('new-session'); await microtasks(); expect(subscribe).toHaveBeenCalledTimes(2);
    } finally { eventsub.close(); }
  });
  it('stops on revocation and rejects unexpected reconnect destinations', async () => {
    const { eventsub, sockets, status } = setup();
    sockets[0]!.welcome(); await microtasks(); sockets[0]!.message('revocation', {}); await microtasks();
    expect(sockets[0]!.terminated).toBe(1); expect(status).toHaveBeenLastCalledWith('error', expect.stringContaining('revoked'));
    for (const url of ['ws://eventsub.wss.twitch.tv/ws', 'wss://remote.example/ws', 'wss://user@eventsub.wss.twitch.tv/ws']) expect(() => reconnectUrl(url)).toThrow();
    eventsub.close();
  });
  it('ignores malformed and stale notifications', async () => {
    const { eventsub, sockets, notification } = setup();
    try {
      sockets[0]!.welcome(); await microtasks();
      sockets[0]!.emit('message', Buffer.from(JSON.stringify({ metadata: { message_id: 'stale', message_type: 'notification', message_timestamp: '2020-01-01T00:00:00.000Z' }, payload: { event: {} } })));
      sockets[0]!.emit('message', Buffer.from('{}')); expect(notification).not.toHaveBeenCalled();
    } finally { eventsub.close(); }
  });
});
