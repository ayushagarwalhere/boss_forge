import { describe, it, expect, vi } from 'vitest';
import { createModerator } from '../server/moderation';
import { harness } from './forge-helpers';

const input = { creator: 'moderated_viewer', text: 'A gentle crystal boss with rings.' };
describe('request moderation', () => {
  it('sends only the text to the verified API endpoint and validates its response', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id:'moderation-test', model:'omni-moderation-latest', results:[{flagged:false}] })));
    const moderate = createModerator('api', 'fabricated-test-key', fetcher);
    expect(await moderate(input.text, new AbortController().signal)).toBe('api');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/moderations');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model:'omni-moderation-latest', input:input.text });
  });
  it.each([true, 'malformed', 'outage'])('admits no job, text, or agent work for a failed check: %s', async (failure) => {
    const moderate = createModerator('api', 'fabricated-test-key', async () => failure === 'outage' ? new Response('{}',{status:503}) : new Response(JSON.stringify(failure === 'malformed' ? {} : {id:'test',model:'test',results:[{flagged:true}]})));
    const {coordinator,services} = harness({moderate}, {autoApprove:true}); const prepare = vi.spyOn(services,'prepare');
    await expect(coordinator.submit(input)).rejects.toThrow(); expect(coordinator.snapshot().jobs).toHaveLength(0); expect(coordinator.snapshot().chat).toHaveLength(0); expect(prepare).not.toHaveBeenCalled(); await coordinator.close();
  });
  it('forces review in manual mode, including when AUTO_APPROVE is set', async () => {
    const {coordinator} = harness({moderate:createModerator('manual','')},{autoApprove:true});
    await coordinator.submit(input); expect(coordinator.snapshot().jobs[0]).toMatchObject({moderation:'manual',status:'pending'}); expect(coordinator.snapshot().queue).toHaveLength(0); await coordinator.close();
  });
  it('reserves capacity and cooldown while the API is pending', async () => {
    let release!: (value:'api')=>void;
    const {coordinator} = harness({moderate:()=>new Promise<'api'>((resolve)=>{release=resolve;})});
    const pending = coordinator.submit(input); await expect(coordinator.submit(input)).rejects.toMatchObject({status:429});
    release('api'); await pending; expect(coordinator.snapshot().jobs).toHaveLength(1); await coordinator.close();
  });
});
