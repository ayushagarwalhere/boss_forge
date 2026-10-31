import { z } from 'zod';

// Viewer briefs are untrusted. Moderation runs before a request enters the forge, so a
// blocked brief never reaches Codex, the overlay, or chat, and a redemption is refunded.
// API docs: https://platform.openai.com/docs/guides/moderation (omni-moderation-latest).
export interface ModerationResult { allowed: boolean; reason: string | null; by: 'local' | 'api' }
export type Moderator = (text: string) => Promise<ModerationResult>;

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|gg|io|tv|xyz|ru|me|ly|co)\b/i;
const MODERATION_URL = 'https://api.openai.com/v1/moderations';
const ApiResponse = z.object({ results: z.array(z.object({ flagged: z.boolean(), categories: z.record(z.string(), z.boolean()) })).min(1) });

/** Cheap checks that always run, including in the no-key replay demo. */
export function localModeration(text: string, blocklist: readonly string[] = []): ModerationResult {
  if (LINK.test(text)) return { allowed: false, reason: 'links are not allowed in boss briefs', by: 'local' };
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return { allowed: false, reason: 'describe the boss in words', by: 'local' };
  if (/(.)\1{11,}/u.test(text) || new Set(text.toLowerCase().split(/\s+/)).size === 1 && text.split(/\s+/).length > 4) {
    return { allowed: false, reason: 'that looks like spam', by: 'local' };
  }
  const lower = text.toLowerCase();
  const hit = blocklist.find((word) => word && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower));
  if (hit) return { allowed: false, reason: 'that brief uses a blocked word on this channel', by: 'local' };
  return { allowed: true, reason: null, by: 'local' };
}

export function createModerator(options: { apiKey?: string; blocklist?: readonly string[]; fetchImpl?: typeof fetch; timeoutMs?: number }): Moderator {
  const { apiKey, blocklist = [], fetchImpl = fetch, timeoutMs = 8000 } = options;
  return async (text) => {
    const local = localModeration(text, blocklist);
    if (!local.allowed || !apiKey) return local;
    try {
      const response = await fetchImpl(MODERATION_URL, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = ApiResponse.parse(await response.json()).results[0]!;
      if (!result.flagged) return { allowed: true, reason: null, by: 'api' };
      const categories = Object.entries(result.categories).filter(([, flagged]) => flagged).map(([name]) => name.split('/')[0]);
      return { allowed: false, reason: `flagged by moderation (${[...new Set(categories)].join(', ') || 'policy'})`, by: 'api' };
    } catch {
      // Fail closed: if moderation is configured but unreachable, don't let unchecked text through.
      return { allowed: false, reason: 'moderation is unavailable right now; try again shortly', by: 'api' };
    }
  };
}
