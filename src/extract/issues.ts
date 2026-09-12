/**
 * Ticket source for the extractor. Today that is data/hono-issues.json (gh issue list output,
 * plus PLANT-* bodies appended by Phase D). Once A4 is live the same shape comes from Jira.
 *
 * Key convention (shared with Phases C/E — change it here, nowhere else):
 *   1. issue.key when the entry carries one (PLANT-1..6)
 *   2. the Jira key from data/gh-to-jira.json when A4 has imported this issue
 *   3. GH-<number> otherwise
 */
import { existsSync, readFileSync } from 'node:fs';

export interface SourceIssue {
  key?: string;
  number?: number;
  title: string;
  body: string | null;
  labels?: { name: string }[] | string[];
  createdAt?: string;
  url?: string;
}

export type KeyedIssue = SourceIssue & { key: string };

const ISSUES = process.env.ISSUES_FILE ?? 'data/hono-issues.json';
const GH_TO_JIRA = 'data/gh-to-jira.json';

/** Rows are `{ key, gh }` for GitHub-sourced issues or `{ key, src: 'PLANT-n' }` for planted ones. */
interface MappingRow {
  key: string;
  gh?: number;
  src?: string;
}

interface Mapping {
  /** GitHub issue number → Jira key */
  byGh: Map<number, string>;
  /** planted source key (PLANT-n) → Jira key */
  bySrc: Map<string, string>;
  /** Jira key → record key (SCRUM-x → itself for GitHub issues, SCRUM-208 → PLANT-1 for planted) */
  byJira: Map<string, string>;
}

let mappingCache: Mapping | undefined;

/** data/gh-to-jira.json, read once per process. Empty maps when the import has not run yet. */
function mapping(): Mapping {
  if (mappingCache) return mappingCache;
  const rows: MappingRow[] = existsSync(GH_TO_JIRA) ? JSON.parse(readFileSync(GH_TO_JIRA, 'utf8')) : [];
  const m: Mapping = { byGh: new Map(), bySrc: new Map(), byJira: new Map() };
  for (const r of rows) {
    if (r.gh !== undefined) {
      m.byGh.set(r.gh, r.key);
      m.byJira.set(r.key, r.key);
    } else if (r.src) {
      m.bySrc.set(r.src, r.key);
      m.byJira.set(r.key, r.src);
    }
  }
  mappingCache = m;
  return m;
}

function ghToJira(): Map<number, string> {
  return mapping().byGh;
}

/** Record key for a GitHub issue number: its Jira key once imported, GH-<n> before that. */
export function ghKey(n: number, map = ghToJira()): string {
  return map.get(n) ?? `GH-${n}`;
}

/**
 * Any way of naming a ticket → the canonical record key (the file name under data/records).
 *   "#3210", "gh#3210", "GH-3210", "https://github.com/.../issues/3210" → SCRUM-<x> (or GH-3210 before import)
 *   "PLANT-3"                                                          → PLANT-3 (planted tickets keep their key)
 *   "SCRUM-210"                                                        → PLANT-3 if it is a planted import, else itself
 * Unknown shapes are returned trimmed and unchanged.
 */
export function resolveKey(ref: string): string {
  const s = ref.trim();
  const gh = /^(?:#|gh#|GH-|.*\/issues\/)(\d+)$/i.exec(s);
  if (gh?.[1]) return ghKey(Number(gh[1]));
  if (/^PLANT-\d+$/i.test(s)) return s.toUpperCase();
  return mapping().byJira.get(s) ?? s;
}

/**
 * Record key → the Jira key to act on: PLANT-1 → SCRUM-208 once imported (PLANT-1 until then),
 * SCRUM-x → itself, GH-n → its Jira key if imported. What write-back and linking must use.
 */
export function jiraKey(recordKey: string): string {
  const s = recordKey.trim();
  if (/^PLANT-\d+$/i.test(s)) return mapping().bySrc.get(s.toUpperCase()) ?? s.toUpperCase();
  const gh = /^GH-(\d+)$/i.exec(s);
  if (gh?.[1]) return ghKey(Number(gh[1]));
  return s;
}

export function issueKey(i: SourceIssue, map = ghToJira()): string {
  if (i.key) return i.key;
  if (i.number !== undefined) return ghKey(i.number, map);
  throw new Error(`issue has neither key nor number: ${i.title}`);
}

export function loadIssues(): KeyedIssue[] {
  const raw: SourceIssue[] = JSON.parse(readFileSync(ISSUES, 'utf8'));
  const map = ghToJira();
  return raw.map((i) => ({ ...i, key: issueKey(i, map) }));
}

export function labelNames(i: SourceIssue): string[] {
  return (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}
