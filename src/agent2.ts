/**
 * Phase E — Agent 2 entry points (brief §5.3).
 *
 *   checkTicket(key) → { candidates, verdicts }   one changed ticket against the backlog
 *   checkAll()       → every shortlisted pair in the backlog, compared once
 *
 * Both write data/verdicts/<KEY>.json as { key, candidates, checked, verdicts }, which scripts/act.ts
 * (Phase F) reads. `candidates` is the shortlist size for the "Checked against N related tickets" comment.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { compare, withRetry } from './compare/index.js';
import { buildVocab, extractRecord } from './extract/index.js';
import { getJiraClient, type JiraIssue } from './jira/index.js';
import { getFilesForTicket } from './mapping/index.js';
import {
  allPairs,
  buildTicket,
  candidates,
  jiraKey,
  loadBacklog,
  resolveKey,
  type Backlog,
  type Candidate,
  type Ticket,
} from './retrieval/index.js';
import type { ConflictVerdict, TicketRecord } from './types.js';

export interface CheckResult {
  candidates: number;
  verdicts: ConflictVerdict[];
}

const CONCURRENCY = Number(process.env.COMPARE_CONCURRENCY ?? 6);
const VERDICTS_DIR = 'data/verdicts';
const LIVE_DIR = 'data/verdicts/live';

let backlog: Promise<Backlog> | undefined;
export function getBacklog(): Promise<Backlog> {
  return (backlog ??= loadBacklog());
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/** Same verdict with pair[0] === key. */
function orient(v: ConflictVerdict, key: string): ConflictVerdict {
  if (v.pair[0] === key) return v;
  const { ticket_a_line, ticket_b_line, code_path } = v.evidence;
  return { ...v, pair: [v.pair[1], v.pair[0]], evidence: { ticket_a_line: ticket_b_line, ticket_b_line: ticket_a_line, code_path } };
}

/** Record keys → Jira keys (PLANT-1 → SCRUM-208). Output layer only: prompts and caches keep record keys. */
function toJira(v: ConflictVerdict): ConflictVerdict {
  return { ...v, pair: [jiraKey(v.pair[0]), jiraKey(v.pair[1])] };
}

/**
 * Writes data/verdicts/<Jira key>.json, plus data/verdicts/<record key>.json when the two differ.
 * `key` is the record key; `verdicts` is record-keyed on input and Jira-keyed in the file and the result.
 */
function writeResult(key: string, shortlist: Candidate[], verdicts: ConflictVerdict[]): CheckResult {
  const jira = jiraKey(key);
  const result = {
    candidates: shortlist.length,
    verdicts: verdicts.sort((p, q) => q.confidence - p.confidence).map(toJira),
  };
  const body = { key: jira, candidates: result.candidates, checked: shortlist.map((c) => jiraKey(c.key)), verdicts: result.verdicts };
  mkdirSync(VERDICTS_DIR, { recursive: true });
  for (const name of new Set([jira, key])) {
    if (name === 'SAMPLE') throw new Error('refusing to overwrite data/verdicts/SAMPLE.json');
    writeFileSync(`${VERDICTS_DIR}/${name}.json`, JSON.stringify(body, null, 2) + '\n');
  }
  return result;
}

/**
 * A Jira ticket with no data/records entry (an Agent 1 draft): extract its record and map its files now.
 * The record is cached in data/verdicts/live/<KEY>.json by a hash of its text, so re-runs replay the same
 * prompts. It joins the in-memory backlog without touching the df tables, so no existing pair hash moves.
 */
async function liveTicket(issue: JiraIssue, bl: Backlog): Promise<Ticket> {
  const existing = bl.tickets.get(issue.key);
  if (existing) return existing;
  const text = { key: issue.key, title: issue.summary, body: issue.description ?? '' };
  const hash = createHash('sha1').update(`${text.title}\n${text.body}`).digest('hex');
  const path = `${LIVE_DIR}/${issue.key}.json`;
  let record: TicketRecord | undefined;
  if (existsSync(path)) {
    const hit = JSON.parse(readFileSync(path, 'utf8')) as { hash: string; record: TicketRecord };
    if (hit.hash === hash) record = hit.record;
  }
  if (!record) {
    record = await withRetry(() => extractRecord(text, buildVocab()));
    mkdirSync(LIVE_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify({ hash, record }, null, 2) + '\n');
  }
  const files = await withRetry(() => getFilesForTicket(text, bl.index, { record }));
  const ticket = buildTicket(issue.key, text.title, text.body, record, files, bl);
  bl.tickets.set(issue.key, ticket);
  return ticket;
}

/** Agent 1 drafts (label agent-draft) that have no record yet join the backlog so other tickets see them. */
async function addDrafts(bl: Backlog): Promise<void> {
  if (process.env.INCLUDE_DRAFTS === '0' || draftsLoaded) return;
  draftsLoaded = true;
  try {
    const jira = await getJiraClient();
    const project = process.env.JIRA_PROJECT_KEY;
    const drafts = await jira.searchIssues(`${project ? `project = ${project} AND ` : ''}labels = agent-draft`, 50);
    for (const d of drafts) if (!bl.tickets.has(resolveKey(d.key))) await liveTicket(d, bl);
  } catch (e) {
    console.warn(`agent2: drafts not loaded from Jira (${e instanceof Error ? e.message : e})`);
  }
}
let draftsLoaded = false;

/** Accepts record keys, Jira keys (SCRUM-208 for PLANT-1) and GH refs. Verdict pairs name Jira keys. */
export async function checkTicket(ref: string): Promise<CheckResult> {
  const bl = await getBacklog();
  await addDrafts(bl);
  const key = resolveKey(ref);
  let ticket = bl.tickets.get(key);
  if (!ticket) {
    // Not in data/records: fetch it from Jira (a fresh draft, or a ticket created after Phase B ran).
    const issue = await (await getJiraClient()).getIssue(key).catch((e: unknown) => {
      throw new Error(`no ticket record for ${ref}${key !== ref ? ` (${key})` : ''}, and Jira lookup failed: ${e instanceof Error ? e.message : e}`);
    });
    ticket = await liveTicket(issue, bl);
  }
  const shortlist = candidates(key, bl);
  const verdicts: ConflictVerdict[] = [];
  await pool(shortlist, CONCURRENCY, async (c) => {
    const v = await compare(ticket, bl.tickets.get(c.key)!, bl);
    if (v) verdicts.push(v);
  });
  return writeResult(key, shortlist, verdicts);
}

export interface CheckAllResult {
  tickets: number;
  pairs: number;
  /** Record-keyed (PLANT-n), so they score directly against data/planted.json. Files on disk are Jira-keyed. */
  verdicts: ConflictVerdict[];
}

export async function checkAll(onProgress?: (done: number, total: number) => void): Promise<CheckAllResult> {
  const bl = await getBacklog();
  const pairs = allPairs(bl);
  const verdicts: ConflictVerdict[] = [];
  let done = 0;
  await pool(pairs, CONCURRENCY, async (p) => {
    const v = await compare(bl.tickets.get(p.a)!, bl.tickets.get(p.b)!, bl);
    if (v) verdicts.push(v);
    onProgress?.(++done, pairs.length);
  });
  for (const key of bl.tickets.keys()) {
    writeResult(key, candidates(key, bl), verdicts.filter((v) => v.pair.includes(key)).map((v) => orient(v, key)));
  }
  return { tickets: bl.tickets.size, pairs: pairs.length, verdicts };
}
