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
function ghToJira(): Map<number, string> {
  if (!existsSync(GH_TO_JIRA)) return new Map();
  const rows: { key: string; gh?: number; src?: string }[] = JSON.parse(readFileSync(GH_TO_JIRA, 'utf8'));
  return new Map(rows.filter((r) => r.gh !== undefined).map((r) => [r.gh!, r.key]));
}

/** Record key for a GitHub issue number: its Jira key once imported, GH-<n> before that. */
export function ghKey(n: number, map = ghToJira()): string {
  return map.get(n) ?? `GH-${n}`;
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
