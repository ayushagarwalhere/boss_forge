import { z } from 'zod';
import { UserError } from './forge/coordinator';

const Result = z.object({ id: z.string().min(1), model: z.string().min(1), results: z.array(z.object({ flagged: z.boolean() })).length(1) });
/** No silent offline fallback after an API failure. Manual review is an explicit mode. */
export function createModerator(mode: 'api' | 'manual', key: string, fetcher: typeof fetch = fetch) {
  if (mode === 'api' && !key) throw new Error('API moderation needs MODERATION_API_KEY or OPENAI_API_KEY.');
  return async (text: string, signal: AbortSignal): Promise<'api' | 'manual'> => {
    if (mode === 'manual') return 'manual';
    try {
      const response = await fetcher('https://api.openai.com/v1/moderations', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), redirect: 'error',
      });
      if (!response.ok) throw new Error('Moderation request failed.');
      const body = await response.text(); if (body.length > 65536) throw new Error('Oversized moderation result.');
      if (Result.parse(JSON.parse(body)).results[0]!.flagged) throw new UserError('That description was blocked by moderation. Please try a different boss idea.', 403);
      return 'api';
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError('Moderation is unavailable. No request was admitted; please try again later.', 503);
    }
  };
}
