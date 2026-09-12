/**
 * Phase F — check → propose → post to Jira, gated by mode.
 *
 *   npm run act -- <KEY>            propose: comment(s) tagged agent-proposed + label agent-conflict
 *   npm run act -- <KEY> --apply    apply pending links if the ticket carries label agent-approved
 *   npm run act -- <KEY> --dry      print the actions, write nothing
 *
 * Verdict source, first that works:
 *   1. src/agent2.ts checkTicket(key)   (Phase E; wired behind a try-import so it drops in later)
 *   2. data/verdicts/<KEY>.json          (Phase E output, or hand-written)
 *   3. data/verdicts/SAMPLE.json         (hand-written; verdicts whose pair contains <KEY>)
 * Either file may be a bare ConflictVerdict[] or { candidates: number, verdicts: ConflictVerdict[] }.
 *
 * MODE=accept (default) | auto. Ather's Phase H adds risk gating in src/modes/index.ts.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ConflictVerdict, Mode } from '../src/types.js';
import { getJiraClient } from '../src/jira/index.js';
import { apply, propose, describe, APPLIED_TAG, APPROVED_LABEL } from '../src/actions/index.js';
import { gate, isApproved } from '../src/modes/accept.js';

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

async function loadVerdicts(key: string): Promise<Verdicts> {
  // 1. Phase E, if it exists. A non-literal specifier keeps tsc from resolving it.
  const agent2 = '../src/agent2.js';
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

async function main() {
  const args = process.argv.slice(2);
  const key = args.find((a) => !a.startsWith('--'));
  if (!key) {
    console.error('usage: npm run act -- <KEY> [--apply] [--dry]');
    process.exit(2);
  }
  const applyFlag = args.includes('--apply');
  const dry = args.includes('--dry');
  const mode = (process.env.MODE ?? 'accept') as Mode;

  const { verdicts, candidates, source } = await loadVerdicts(key);
  const cand = candidates !== undefined ? `, ${candidates} candidates` : '';
  console.log(`${key}: ${verdicts.length} verdict(s) from ${source}${cand}; mode=${mode}`);

  const jira = await getJiraClient();
  const issue = await jira.getIssue(key);
  const approved = isApproved(issue.labels);
  console.log(`${key}: "${issue.summary.slice(0, 60)}" labels=[${issue.labels.join(', ')}] approved=${approved}`);

  const all = propose(key, verdicts, candidates);
  const { now, pending } = gate(all, mode, approved);

  // --apply performs only what the proposal run held back, plus a note so the ticket shows it.
  let todo = applyFlag ? all.filter((a) => a.kind === 'link') : now;
  if (applyFlag) {
    if (!approved) {
      console.log(`${key} has no ${APPROVED_LABEL} label; nothing applied. Pending:`);
      for (const a of pending) console.log(`  - ${describe(a)}`);
      return;
    }
    if (todo.length === 0) {
      console.log(`${key}: nothing pending to apply.`);
      return;
    }
    const note = todo.map((a) => describe(a)).join('; ');
    todo = [
      ...todo,
      { kind: 'comment', issueKey: key, body: `[${APPLIED_TAG}] Applied after approval: ${note}. -- Backlog Conflict Agent` },
    ];
  }

  console.log(`${dry ? 'would perform' : 'performing'} ${todo.length} action(s):`);
  for (const a of todo) console.log(`  - ${describe(a)}`);
  if (!applyFlag && pending.length) {
    console.log(`held for approval (${pending.length}); add label ${APPROVED_LABEL} then run with --apply:`);
    for (const a of pending) console.log(`  - ${describe(a)}`);
  }
  if (dry) return;

  const results = await apply(todo, jira);
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${describe(r.action)}${r.error ? ` -- ${r.error}` : ''}`);
  }
  console.log(`${results.length - failed.length}/${results.length} applied on ${issue.url}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
