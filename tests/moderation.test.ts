import { describe, expect, it, vi } from 'vitest';
import { createModerator, localModeration } from '../server/forge/moderation';
import { harness } from './forge-helpers';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('viewer-text moderation', () => {
  it('local filter blocks links, spam, and channel blocklist words but allows normal briefs', () => {
    expect(localModeration('A disco ball that fires spirals and taunts in rhymes').allowed).toBe(true);
    expect(localModeration('free bosses at https://scam.example now').reason).toMatch(/links/);
    expect(localModeration('visit bossgen.gg for more').reason).toMatch(/links/);
    expect(localModeration('aaaaaaaaaaaaaaaaaaaaaa').reason).toMatch(/spam/);
    expect(localModeration('boss boss boss boss boss boss').reason).toMatch(/spam/);
    expect(localModeration('!!! ??? 123').reason).toMatch(/words/);
    expect(localModeration('a boss named Grumbo', ['grumbo']).reason).toMatch(/blocked word/);
    expect(localModeration('a grumbolina boss', ['grumbo']).allowed).toBe(true);
  });

  it('uses the OpenAI moderation API when a key exists and fails closed if it is down', async () => {
    const fetchImpl = vi.fn(async () => ok({ results: [{ flagged: true, categories: { harassment: true, 'harassment/threatening': true, violence: false } }] }));
    const moderate = createModerator({ apiKey: 'sk-test', fetchImpl: fetchImpl as unknown as typeof fetch });
    const verdict = await moderate('a boss that insults a specific viewer');
    expect(verdict).toMatchObject({ allowed: false, by: 'api' });
    expect(verdict.reason).toBe('flagged by moderation (harassment)');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/moderations');
    expect(JSON.parse(String(init.body))).toEqual({ model: 'omni-moderation-latest', input: 'a boss that insults a specific viewer' });

    const clean = createModerator({ apiKey: 'sk-test', fetchImpl: (async () => ok({ results: [{ flagged: false, categories: {} }] })) as unknown as typeof fetch });
    expect(await clean('a polite laser cube')).toEqual({ allowed: true, reason: null, by: 'api' });
    const down = createModerator({ apiKey: 'sk-test', fetchImpl: (async () => new Response('', { status: 503 })) as unknown as typeof fetch });
    expect((await down('a polite laser cube')).allowed).toBe(false);
    const noKey = vi.fn();
    expect(await createModerator({ fetchImpl: noKey as unknown as typeof fetch })('a polite laser cube')).toMatchObject({ allowed: true, by: 'local' });
    expect(noKey).not.toHaveBeenCalled();
  });

  it('blocks flagged viewer requests before they become jobs, while trusted demo fixtures skip it', async () => {
    const moderate = vi.fn(async (text: string) => (text.includes('bad') ? { allowed: false, reason: 'flagged by moderation (hate)' } : { allowed: true, reason: null }));
    const { coordinator } = harness({ moderate }, { cooldownMs: 0 });
    await expect(coordinator.submit({ creator: 'viewer', text: 'a bad hateful boss' }, 'twitch')).rejects.toMatchObject({ status: 422, message: 'Request blocked: flagged by moderation (hate).' });
    expect(coordinator.snapshot().jobs).toHaveLength(0);
    expect(coordinator.snapshot().events.at(-1)?.message).toContain('blocked by moderation');
    expect(coordinator.snapshot().events.at(-1)?.message).not.toContain('hateful');
    await coordinator.submit({ creator: 'viewer', text: 'a friendly fire boss' }, 'twitch');
    await coordinator.submit({ creator: 'sim', text: 'a bad but trusted demo fixture' }, 'demo');
    expect(moderate).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot().jobs).toHaveLength(2);
    await coordinator.close();
  });
});
