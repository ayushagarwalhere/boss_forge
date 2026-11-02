import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Codex, type Thread, type ThreadEvent } from '@openai/codex-sdk';
import { CodexAgent, runtimeCodexOptions, runtimeThreadOptions } from '../server/forge/codex-agent';
import type { ForgeJob } from '../engine/forge-protocol';

const job: ForgeJob = { id: 'forge-test', creator: 'test_viewer', text: 'A slow fire boss.', source: 'local', mode: 'codex', moderation: 'manual', rematch: null, status: 'building', attempt: 1, threadId: null, createdAt: 0, message: '', gate: null };
let root: string | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('boss-forge-sdk-')) throw new Error('Unsafe SDK test cleanup.');
    await rm(root, { recursive: true, force: true }); root = null;
  }
});
describe('verified Codex SDK adapter', () => {
  it('uses the restricted offline profile without inheriting credentials or bypassing permissions', () => {
    const options = runtimeCodexOptions('/workspace/job', '/workspace/home', '/runtime/node', 'test-api-key');
    expect(options.env?.OPENAI_API_KEY).toBeUndefined(); expect(options.env?.TWITCH_CLIENT_SECRET).toBeUndefined();
    expect(options.config?.default_permissions).toBe('boss-forge');
    expect(options.configOverrides?.[0]).toContain('":root" = "deny"');
    expect(options.configOverrides?.[0]).toContain('"/workspace/job" = "write"');
    expect(options.configOverrides?.[0]).toContain('gate.mjs');
    expect(JSON.stringify(options.config)).toContain('"enabled":false');
    if (process.platform === 'win32') {
      expect(JSON.stringify(options.config)).toContain('"prefer_mxc":true');
      expect(JSON.stringify(options.config)).toContain('"sandbox":"elevated"');
    }
    expect(runtimeThreadOptions('/workspace/job')).toEqual({ workingDirectory: '/workspace/job', skipGitRepoCheck: true, approvalPolicy: 'never', webSearchMode: 'disabled' });
    expect(runtimeThreadOptions('/workspace/job', 'configured-model').model).toBe('configured-model');
  });

  it('consumes typed SDK events, reuses the thread, and emits no raw commands, reasoning, or secret-bearing output', async () => {
    root = await mkdtemp(join(tmpdir(), 'boss-forge-sdk-')); const directory = join(root, 'forge', job.id); await mkdir(directory, { recursive: true });
    const items: ThreadEvent[] = [
      { type: 'thread.started', thread_id: 'thread-123' }, { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'reason', type: 'reasoning', text: 'private-reasoning-marker' } },
      { type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'npm run gate -- secret-command-marker', aggregated_output: 'secret-output-marker', status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'patch', type: 'file_change', changes: [{ path: 'boss.json', kind: 'add' }], status: 'completed' } },
      { type: 'item.completed', item: { id: 'final', type: 'agent_message', text: JSON.stringify({ status: 'ready', summary: 'Done.', files: ['boss.json'] }) } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
    ];
    const runStreamed = vi.fn(async () => ({ events: (async function* () { yield* items; })() }));
    const start = vi.spyOn(Codex.prototype, 'startThread').mockReturnValue({ id: 'thread-123', runStreamed } as unknown as Thread);
    const emitted: string[] = [], threads: string[] = [];
    const session = new CodexAgent('test-api-key', undefined, root).createSession();
    const context = { job, workspace: { id: job.id, directory }, feedback: null, signal: new AbortController().signal,
      emit: (_: string, message: string) => emitted.push(message), onThread: (id: string) => threads.push(id) };
    expect((await session.run(context)).status).toBe('ready');
    await session.run({ ...context, job: { ...job, attempt: 2 }, feedback: 'safeSpace failed.' });
    expect(start).toHaveBeenCalledTimes(1); expect(runStreamed).toHaveBeenCalledTimes(2); expect(threads).toContain('thread-123');
    expect(JSON.stringify(emitted)).not.toContain('secret-'); expect(JSON.stringify(emitted)).not.toContain('private-reasoning');
    expect(JSON.stringify(runStreamed.mock.calls)).toContain('outputSchema'); expect(JSON.stringify(runStreamed.mock.calls)).toContain('safeSpace');
  });
});
