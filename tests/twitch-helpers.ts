import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { TwitchConfigSchema, SCOPES, type TokenRole } from '../server/twitch/config';

// Fabricated transport values. No real credentials or channel IDs are used in tests.
export const twitchConfig = () => TwitchConfigSchema.parse({ clientId: 'testclient', clientSecret: 'testsecret', broadcasterId: '1', botId: '2',
  broadcasterAccess: 'broadcaster-test', broadcasterRefresh: 'broadcaster-refresh-test', botAccess: 'bot-test', botRefresh: 'bot-refresh-test' });
export const identity = (role: TokenRole) => ({ client_id: 'testclient', user_id: role === 'bot' ? '2' : '1', login: role === 'bot' ? 'test_bot' : 'test_channel', scopes: [...SCOPES[role]], expires_in: 3600 });
export const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
export class TestSocket extends EventEmitter {
  terminated = 0;
  terminate() { this.terminated++; }
  asSocket() { return this as unknown as WebSocket; }
  message(type: string, payload: unknown = {}, id = 'message-1') {
    this.emit('message', Buffer.from(JSON.stringify({ metadata: { message_id: id, message_type: type, message_timestamp: new Date().toISOString() }, payload })));
  }
  welcome(id = 'session-1') { this.message('session_welcome', { session: { id, keepalive_timeout_seconds: 30 } }); }
}
export async function microtasks() { for (let index = 0; index < 15; index++) await Promise.resolve(); }
