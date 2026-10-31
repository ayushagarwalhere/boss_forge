import { describe, expect, it } from 'vitest';
import { createForgeHttp } from '../server/http';
import { harness } from './forge-helpers';

const sample = { fightId: null, boss: 'Ember Anvil', creator: 'house_forge', state: 'playing', bossHp: 0.42, phase: 2, phases: 2, hearts: 2, seconds: 61, bullets: 120 };

describe('fight telemetry for the OBS overlay', () => {
  it('validates, timestamps, and publishes arena stats', () => {
    const { coordinator } = harness({}, { now: () => 1234 });
    const seen: unknown[] = []; coordinator.subscribe((state) => seen.push(state.telemetry));
    coordinator.setTelemetry(sample);
    expect(coordinator.snapshot().telemetry).toEqual({ ...sample, at: 1234 });
    expect(seen).toHaveLength(1);
    expect(() => coordinator.setTelemetry({ ...sample, bossHp: 2 })).toThrow(/Invalid/);
    expect(() => coordinator.setTelemetry({ ...sample, extra: 'x' })).toThrow(/Invalid/);
    expect(() => coordinator.setTelemetry({ ...sample, boss: 'x'.repeat(61) })).toThrow(/Invalid/);
  });

  it('accepts telemetry only with the local control token', async () => {
    const { coordinator } = harness();
    const app = createForgeHttp(coordinator, 0);
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const send = (headers: Record<string, string>) => fetch(`${url}/api/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(sample) });
    expect((await send({})).status).toBe(403);
    const { token } = await (await fetch(`${url}/api/session`)).json() as { token: string };
    expect((await send({ 'x-forge-token': token })).status).toBe(200);
    expect(coordinator.snapshot().telemetry?.bossHp).toBe(0.42);
    await coordinator.close(); await app.close();
  });
});
