/**
 * Record key ↔ Jira key. Local stand-in for resolveKey/jiraKey that Ahmed is adding to
 * src/extract/issues.ts (PR phase-b-keys); same names, so swapping to that module is an import change.
 *
 * Records for planted tickets stay keyed PLANT-n, while Jira has them as SCRUM-208..213.
 * data/gh-to-jira.json {key, src: 'PLANT-n'} rows win when present; PLANT_JIRA is the fallback.
 */
import { existsSync, readFileSync } from 'node:fs';
import { ghKey } from '../extract/issues.js';

const PLANT_JIRA: Record<string, string> = {
  'PLANT-1': 'SCRUM-208',
  'PLANT-2': 'SCRUM-209',
  'PLANT-3': 'SCRUM-210',
  'PLANT-4': 'SCRUM-211',
  'PLANT-5': 'SCRUM-212',
  'PLANT-6': 'SCRUM-213',
};
const RECORDS_DIR = process.env.RECORDS_DIR ?? 'data/records';

let aliases: Record<string, string> | undefined;
function plantAliases(): Record<string, string> {
  if (aliases) return aliases;
  aliases = { ...PLANT_JIRA };
  if (existsSync('data/gh-to-jira.json')) {
    const rows: { key: string; src?: string }[] = JSON.parse(readFileSync('data/gh-to-jira.json', 'utf8'));
    for (const r of rows) if (r.src) aliases[r.src] = r.key;
  }
  return aliases;
}

const hasRecord = (key: string) => existsSync(`${RECORDS_DIR}/${key}.json`);

/** The key Jira knows a record by (PLANT-1 → SCRUM-208); every other key is already a Jira key. */
export function jiraKey(recordKey: string): string {
  return plantAliases()[recordKey] ?? recordKey;
}

/** Any ref (GH-2398, #2398, SCRUM-198, PLANT-1, SCRUM-208) → the key its record is stored under. */
export function resolveKey(ref: string): string {
  const gh = ref.match(/^(?:GH-|#)(\d+)$/)?.[1];
  if (gh) return ghKey(Number(gh));
  if (hasRecord(ref)) return ref;
  const all = plantAliases();
  const forward = all[ref];
  if (forward && hasRecord(forward)) return forward;
  const back = Object.keys(all).find((src) => all[src] === ref);
  return back && hasRecord(back) ? back : ref;
}
