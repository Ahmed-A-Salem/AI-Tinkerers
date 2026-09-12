/** data/records/<KEY>.json — one TicketRecord per ticket. Phase B writes, C/E read. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TicketRecord } from '../types.js';
import type { RecordsByKey } from '../jira/client.js';

export const RECORDS_DIR = process.env.RECORDS_DIR ?? 'data/records';

const recordPath = (key: string) => join(RECORDS_DIR, `${key}.json`);

export function hasRecord(key: string): boolean {
  return existsSync(recordPath(key));
}

export function readRecord(key: string): TicketRecord | undefined {
  return hasRecord(key) ? (JSON.parse(readFileSync(recordPath(key), 'utf8')) as TicketRecord) : undefined;
}

export function writeRecord(record: TicketRecord): void {
  mkdirSync(RECORDS_DIR, { recursive: true });
  writeFileSync(recordPath(record.key), JSON.stringify(record, null, 2) + '\n');
}

export function loadAllRecords(): RecordsByKey {
  if (!existsSync(RECORDS_DIR)) return {};
  const out: RecordsByKey = {};
  for (const f of readdirSync(RECORDS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(readFileSync(join(RECORDS_DIR, f), 'utf8')) as TicketRecord;
    out[r.key] = r;
  }
  return out;
}
