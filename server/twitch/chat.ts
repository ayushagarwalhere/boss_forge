import { z } from 'zod';
import type { ForgeCoordinator } from '../forge/coordinator';
import { UserError } from '../forge/coordinator';
import type { ChatCommand } from '../showtime/showtime';

export type ShowtimeChat = (command: ChatCommand) => Promise<string | null>;

export const ChatEvent = z.object({ broadcaster_user_id: z.string(), chatter_user_id: z.string(), chatter_user_login: z.string().regex(/^[a-z0-9_]{1,25}$/),
  message_id: z.string().min(1).max(256), message: z.object({ text: z.string().max(2000) }),
  badges: z.array(z.object({ set_id: z.string() })).max(100),
  channel_points_custom_reward_id: z.string().nullable().optional(), source_broadcaster_user_id: z.string().nullable().optional() });
export class ChatCommands {
  private readonly seen = new Map<string, number>();
  private readonly replies = new Map<string, number>();
  private queueAt = -Infinity;
  private readonly publicAt = new Map<string, number>();
  constructor(private readonly coordinator: ForgeCoordinator, private readonly broadcasterId: string, private readonly botId: string,
    private readonly say: (message: string) => Promise<void>, private readonly now = Date.now, private readonly showtime: ShowtimeChat | null = null) {}
  /** Show commands. Votes/rematch calls are silent (no reply), so they skip the per-user reply limiter;
   * leaderboard replies use a 10-second channel cooldown per command. */
  private async showtimeCommand(command: string, argument: string, login: string, privileged: boolean, now: number) {
    if (!this.showtime) return;
    if (['top', 'record'].includes(command)) {
      if (now - (this.publicAt.get(command) ?? -Infinity) < 10000) return;
      this.publicAt.set(command, now);
    } else if (command === 'mybosses') {
      for (const [id, at] of this.replies) if (now - at > 10000) this.replies.delete(id);
      if (this.replies.has(login)) return; this.replies.set(login, now);
    }
    try {
      const reply = await this.showtime({ login, privileged, command, argument, source: 'twitch' });
      if (reply) await this.say(reply);
    } catch (error) { if (error instanceof UserError && privileged) await this.say(`@${login} ${error.message}`); }
  }
  async accept(input: unknown) {
    const parsed = ChatEvent.safeParse(input); if (!parsed.success) return;
    const event = parsed.data, now = this.now();
    if (event.broadcaster_user_id !== this.broadcasterId || event.chatter_user_id === this.botId || event.channel_points_custom_reward_id || (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== this.broadcasterId)) return;
    for (const [id, at] of this.seen) if (now - at > 600000) this.seen.delete(id);
    if (this.seen.has(event.message_id)) return;
    this.seen.set(event.message_id, now); if (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
    const match = /^!(boss|queue|approve|reject|skip|vote|rematch|top|record|mybosses|startvote)(?:\s+([\s\S]*))?$/i.exec(event.message.text.trim()); if (!match) return;
    const command = match[1]!.toLowerCase(), argument = match[2]?.trim() ?? '';
    const privileged = event.chatter_user_id === this.broadcasterId || event.badges.some((badge) => badge.set_id === 'moderator');
    if (['approve', 'reject', 'skip', 'startvote'].includes(command) && !privileged) return;
    if (['vote', 'rematch', 'top', 'record', 'mybosses', 'startvote'].includes(command)) { await this.showtimeCommand(command, argument, event.chatter_user_login, privileged, now); return; }
    for (const [id, at] of this.replies) if (now - at > 10000) this.replies.delete(id);
    if (this.replies.has(event.chatter_user_id) || this.replies.size >= 1000) return;
    this.replies.set(event.chatter_user_id, now);
    try {
      if (command === 'boss') {
        const job = await this.coordinator.submit({ creator: event.chatter_user_login, text: argument }, 'twitch');
        await this.say(`@${job.creator} request ${job.id} received${job.status === 'pending' ? '; awaiting moderator approval' : '; waiting for the forge'}.`);
      } else if (command === 'queue') {
        if (now - this.queueAt < 10000) return; this.queueAt = now;
        const queue = this.coordinator.snapshot().queue;
        await this.say(queue.length ? `Boss queue: ${queue.map((boss, i) => `${i + 1}. ${boss.spec.meta.name} by @${boss.spec.meta.creator}`).join(' | ')}` : 'Boss queue is empty. A verified house boss is ready; request one with !boss <description>.');
      } else if (command === 'skip') {
        const fight = this.coordinator.snapshot().activeFight;
        if (!fight) throw new UserError('No fight is active.');
        await this.coordinator.finishFight(fight.id, 'skipped'); await this.say('The active fight was skipped by a moderator.');
      } else {
        if (!/^forge-[a-z0-9-]{1,58}$/.test(argument)) throw new UserError(`Use !${command} <request-id> from the request receipt.`);
        await this.coordinator.review(argument, command === 'approve');
        await this.say(`Request ${argument} ${command === 'approve' ? 'approved' : 'rejected'} by a moderator.`);
      }
    } catch (error) { await this.say(`@${event.chatter_user_login} ${error instanceof UserError ? error.message : 'The local forge could not complete that action.'}`); }
  }
}
