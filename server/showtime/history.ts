import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { FightRecordSchema, type FightRecord, type Hall } from '../../engine/forge-protocol';

const HistoryFile = z.strictObject({ version: z.literal(1), records: z.array(FightRecordSchema).max(1000) });
const MAX_RECORDS = 500;
const HOUSE_CREATOR = 'house_forge';

/** Persistent fight log behind the Hall of Fame. Local file, bounded, written atomically. */
export class FightHistory {
  private records: FightRecord[] = [];
  private writing = Promise.resolve();
  constructor(private readonly file: string | null) {}

  async load() {
    if (!this.file) return;
    try { this.records = HistoryFile.parse(JSON.parse(await readFile(this.file, 'utf8'))).records.slice(-MAX_RECORDS); }
    catch { this.records = []; } // missing or corrupt history starts fresh; it is display data only
  }

  all(): readonly FightRecord[] { return this.records; }

  add(record: FightRecord): Promise<void> {
    this.records.push(FightRecordSchema.parse(record));
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    if (!this.file) return Promise.resolve();
    const file = this.file, payload = JSON.stringify({ version: 1, records: this.records }, null, 1);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, payload); await rename(temporary, file);
    }).catch(() => {});
    return this.writing;
  }

  hall(): Hall { return summarize(this.records); }

  /** Stats for one viewer's bosses, for !mybosses. */
  creator(login: string) {
    const mine = this.records.filter((record) => record.creator === login);
    return { fights: mine.length, defeats: mine.filter((record) => record.outcome === 'lost').length, best: mine.reduce((best, record) => Math.max(best, record.generation), 0) };
  }

  async flush() { await this.writing; }
}

export function summarize(records: readonly FightRecord[]): Hall {
  let streak = 0;
  for (let index = records.length - 1; index >= 0; index--) {
    const won = records[index]!.outcome === 'won';
    if (streak === 0) streak = won ? 1 : -1;
    else if ((streak > 0) === won) streak += won ? 1 : -1;
    else break;
  }
  const creators = new Map<string, { creator: string; fights: number; streamerDefeats: number; rematches: number; score: number }>();
  const bosses = new Map<string, { boss: string; creator: string; defeats: number; fights: number }>();
  for (const record of records) {
    if (record.creator !== HOUSE_CREATOR && record.mode !== 'house') {
      const entry = creators.get(record.creator) ?? { creator: record.creator, fights: 0, streamerDefeats: 0, rematches: 0, score: 0 };
      entry.fights++; if (record.outcome === 'lost') entry.streamerDefeats++; if (record.generation > 1) entry.rematches++;
      entry.score = entry.fights + entry.streamerDefeats * 3 + entry.rematches * 2;
      creators.set(record.creator, entry);
    }
    const key = `${record.boss}\u0000${record.creator}`;
    const boss = bosses.get(key) ?? { boss: record.boss, creator: record.creator, defeats: 0, fights: 0 };
    boss.fights++; if (record.outcome === 'lost') boss.defeats++;
    bosses.set(key, boss);
  }
  return {
    wins: records.filter((record) => record.outcome === 'won').length,
    losses: records.filter((record) => record.outcome === 'lost').length,
    streak,
    creators: [...creators.values()].sort((a, b) => b.score - a.score || b.streamerDefeats - a.streamerDefeats || a.creator.localeCompare(b.creator)).slice(0, 5),
    feared: [...bosses.values()].filter((boss) => boss.defeats > 0).sort((a, b) => b.defeats - a.defeats || a.fights - b.fights).slice(0, 3),
    recent: records.slice(-5).reverse(),
  };
}
