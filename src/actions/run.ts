/**
 * The one Agent 2 run: check → propose → gate → apply, for a single ticket.
 *
 * Every entry point calls this and nothing else: the CLI (scripts/act.ts), the Trigger.dev task
 * (src/trigger/agent2.ts) and the plain HTTP server (scripts/serve.ts). They differ only in how
 * the { key, event } pair reaches them.
 *
 * Verdict source, first that works:
 *   1. src/agent2.ts checkTicket(key)    Phase E, behind a try-import so it drops in later
 *   2. data/verdicts/<KEY>.json           Phase E output, or hand-written
 *   3. data/verdicts/SAMPLE.json          hand-written; verdicts whose pair contains <KEY>
 * Either file may be a bare ConflictVerdict[] or { candidates: number, verdicts: ConflictVerdict[] }.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentAction, ConflictVerdict, Mode } from '../types.js';
import { getJiraClient } from '../jira/index.js';
import { apply, propose, describe, APPLIED_TAG, APPROVED_LABEL, type ApplyResult } from './index.js';
import { gate, isApproved } from '../modes/index.js';

/** What happened to the ticket. `approved` means a human added agent-approved. */
export type Agent2Event = 'created' | 'updated' | 'approved';

export interface RunOptions {
  key: string;
  event?: Agent2Event;
  /** Force apply (links) instead of propose. Defaults to `event === 'approved'`. */
  apply?: boolean;
  /** Compute and report the actions, write nothing to Jira. */
  dry?: boolean;
  /** Defaults to MODE env, then 'accept'. */
  mode?: Mode;
  log?: (line: string) => void;
}

export interface RunResult {
  key: string;
  event: Agent2Event;
  mode: Mode;
  source: string;
  verdicts: number;
  candidates?: number;
  approved: boolean;
  dry: boolean;
  /** Actions performed (or, when dry, the ones that would have been). */
  performed: ApplyResult[];
  /** Actions still waiting for approval. */
  pending: AgentAction[];
  /** Set when nothing was done and why. */
  skipped?: string;
  url: string;
}

interface Verdicts {
  verdicts: ConflictVerdict[];
  candidates?: number;
  source: string;
}

function normalise(raw: unknown, source: string): Verdicts {
  if (Array.isArray(raw)) return { verdicts: raw as ConflictVerdict[], source };
  const o = raw as { verdicts?: ConflictVerdict[]; candidates?: number };
  return { verdicts: o.verdicts ?? [], candidates: o.candidates, source };
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function loadVerdicts(key: string): Promise<Verdicts> {
  // 1. Phase E, if it exists. A non-literal specifier keeps tsc from resolving it.
  const agent2 = '../agent2.js';
  try {
    const mod = (await import(agent2)) as { checkTicket?: (k: string) => Promise<unknown> };
    if (typeof mod.checkTicket === 'function') return normalise(await mod.checkTicket(key), 'checkTicket');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  // 2. per-ticket verdict file.
  const own = await readJson(`data/verdicts/${key}.json`);
  if (own !== undefined) return normalise(own, `data/verdicts/${key}.json`);
  // 3. hand-written sample, filtered to this ticket.
  const sample = await readJson('data/verdicts/SAMPLE.json');
  if (sample === undefined) {
    throw new Error(`no verdicts for ${key}: no checkTicket, no data/verdicts/${key}.json, no SAMPLE.json`);
  }
  const s = normalise(sample, 'data/verdicts/SAMPLE.json');
  return { ...s, verdicts: s.verdicts.filter((v) => v.pair.includes(key)) };
}

export async function runAgent2(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const event: Agent2Event = opts.event ?? (opts.apply ? 'approved' : 'updated');
  const applyFlag = opts.apply ?? event === 'approved';
  const dry = opts.dry ?? false;
  const mode: Mode = opts.mode ?? ((process.env.MODE as Mode | undefined) ?? 'accept');
  const { key } = opts;

  const { verdicts, candidates, source } = await loadVerdicts(key);
  const cand = candidates !== undefined ? `, ${candidates} candidates` : '';
  log(`${key}: ${verdicts.length} verdict(s) from ${source}${cand}; event=${event} mode=${mode}`);

  const jira = await getJiraClient();
  const issue = await jira.getIssue(key);
  const approved = isApproved(issue.labels);
  log(`${key}: "${issue.summary.slice(0, 60)}" labels=[${issue.labels.join(', ')}] approved=${approved}`);

  const all = propose(key, verdicts.length ? verdicts : [], candidates);
  // Confidence belongs to one verdict (risk mode gates on it), so gate each verdict's actions on their own.
  const { now, pending } = verdicts.length
    ? verdicts
        .map((v) => gate(propose(key, [v], candidates), mode, approved, v.confidence))
        .reduce((acc, g) => ({ now: [...acc.now, ...g.now], pending: [...acc.pending, ...g.pending] }))
    : gate(all, mode, approved, 1);
  const base: Omit<RunResult, 'performed' | 'pending'> = {
    key, event, mode, source, verdicts: verdicts.length, candidates, approved, dry, url: issue.url,
  };

  // --apply performs only what the proposal run held back, plus a note so the ticket shows it.
  let todo = applyFlag ? all.filter((a) => a.kind === 'link') : now;
  if (applyFlag) {
    if (!approved) {
      log(`${key} has no ${APPROVED_LABEL} label; nothing applied.`);
      return { ...base, performed: [], pending, skipped: `no ${APPROVED_LABEL} label` };
    }
    if (todo.length === 0) {
      log(`${key}: nothing pending to apply.`);
      return { ...base, performed: [], pending: [], skipped: 'nothing pending' };
    }
    const note = todo.map((a) => describe(a)).join('; ');
    todo = [
      ...todo,
      { kind: 'comment', issueKey: key, body: `[${APPLIED_TAG}] Applied after approval: ${note}. -- Backlog Conflict Agent` },
    ];
  }

  log(`${dry ? 'would perform' : 'performing'} ${todo.length} action(s):`);
  for (const a of todo) log(`  - ${describe(a)}`);
  if (!applyFlag && pending.length) {
    log(`held for approval (${pending.length}); add label ${APPROVED_LABEL} then run with --apply:`);
    for (const a of pending) log(`  - ${describe(a)}`);
  }
  if (dry) return { ...base, performed: todo.map((action) => ({ action, ok: true })), pending: applyFlag ? [] : pending };

  const performed = await apply(todo, jira);
  for (const r of performed) log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${describe(r.action)}${r.error ? ` -- ${r.error}` : ''}`);
  log(`${performed.filter((r) => r.ok).length}/${performed.length} applied on ${issue.url}`);
  return { ...base, performed, pending: applyFlag ? [] : pending };
}
