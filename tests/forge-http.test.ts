import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { createForgeHttp } from '../server/http';
import { ForgeSnapshotSchema } from '../engine/forge-protocol';
import { harness } from './forge-helpers';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => { if (cleanup) await cleanup(); cleanup = null; });
async function setup() {
  const { coordinator } = harness(); const app = createForgeHttp(coordinator, 0);
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP address.');
  const url = `http://127.0.0.1:${address.port}`;
  cleanup = async () => { await coordinator.close(); await app.close(); };
  const { token } = await (await fetch(`${url}/api/session`)).json() as { token: string };
  const post = (path: string, body: unknown) => fetch(`${url}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-token': token, origin: url }, body: JSON.stringify(body) });
  return { coordinator, app, url, token, post };
}
describe('local HTTP and read-only WebSocket hub', () => {
  it('requires local origin, a control token, and bounded JSON for mutation', async () => {
    const { url, post } = await setup();
    expect((await fetch(`${url}/api/state`, { headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
    expect((await fetch(`${url}/api/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await post('requests', { creator: 'viewer', text: 'a small fire boss', source: 'demo' })).status).toBe(400);
    expect((await post('requests', { creator: 'viewer', text: 'x'.repeat(9000) })).status).toBe(413);
  });

  it('accepts, approves, queues, claims, and finishes a request through real HTTP routes', async () => {
    const { url, coordinator, post } = await setup();
    const response = await post('requests', { creator: 'http_viewer', text: 'A heavy fire boss with spirals.' });
    expect(response.status).toBe(201); const job = await response.json() as { id: string };
    expect(coordinator.snapshot().jobs[0]?.status).toBe('pending');
    expect((await post('review', { id: job.id, approve: true })).status).toBe(200);
    await coordinator.idle();
    const claim = await post('claim', {}); expect(claim.status).toBe(200); const fight = await claim.json() as { id: string };
    expect((await post('claim', {})).status).toBe(409);
    expect((await post('finish', { id: fight.id, outcome: 'won' })).status).toBe(200);
    expect((await post('finish', { id: fight.id, outcome: 'won' })).status).toBe(200);
    expect(ForgeSnapshotSchema.safeParse(await (await fetch(`${url}/api/state`)).json()).success).toBe(true);
  });

  it('streams typed snapshots and rejects WebSocket mutation messages', async () => {
    const { url, post, coordinator } = await setup();
    const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: url });
    const first = await once(ws, 'message'); expect(ForgeSnapshotSchema.safeParse(JSON.parse(String(first[0]))).success).toBe(true);
    const updated = once(ws, 'message'); await post('requests', { creator: 'ws_viewer', text: 'A crystal sniper with long warnings.' });
    const [message] = await updated; expect(JSON.parse(String(message)).jobs[0].status).toBe('pending');
    const closed = once(ws, 'close'); ws.send(JSON.stringify({ approve: true }));
    expect((await closed)[0]).toBe(1008); expect(coordinator.snapshot().queue).toHaveLength(0);
  });
});
