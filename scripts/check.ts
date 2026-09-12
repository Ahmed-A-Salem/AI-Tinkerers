/**
 * Phase E runner. <KEY> is a record key (SCRUM-198, PLANT-1) or a GitHub ref (GH-2398).
 *   npm run check -- <KEY>     check one ticket; writes data/verdicts/<KEY>.json
 *   npm run check -- --all     check the whole backlog, score against data/planted.json
 *   npm run check -- --pairs   retrieval only (no LLM): shortlist size and planted-pair recall
 *   npm run check -- --warm    fill data/mapping/<KEY>.json for every ticket on the current model
 *   npm run check -- --prune   delete data/verdicts/pairs/ entries the current prompt/model/backlog won't hit
 */
import 'dotenv/config';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { checkAll, checkTicket, getBacklog } from '../src/agent2.js';
import { pairCachePath, pairPrompt, verifyHash, withRetry } from '../src/compare/index.js';
import { readRecord } from '../src/extract/cache.js';
import { loadIssues } from '../src/extract/issues.js';
import { getProvider } from '../src/extract/llm.js';
import { getMappingForTicket, loadMappingIndex, readMappingCache } from '../src/mapping/index.js';
import { allPairs, candidates, jiraKey, loadBacklog, pairSignals, resolveKey, type Backlog } from '../src/retrieval/index.js';
import type { ConflictType, ConflictVerdict } from '../src/types.js';

const PAIRS_DIR = 'data/verdicts/pairs';

interface Planted {
  pair: [string, string];
  type: ConflictType;
  expected_code_path: string;
  also_acceptable?: string[];
  demo?: boolean;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

function loadPlanted(bl: Backlog) {
  const raw: Planted[] = JSON.parse(readFileSync('data/planted.json', 'utf8'));
  return raw.map((p) => ({
    ...p,
    a: resolveKey(p.pair[0]),
    b: resolveKey(p.pair[1]),
    also: (p.also_acceptable ?? []).map((r) => resolveKey(r)),
  }));
}
type ResolvedPlanted = ReturnType<typeof loadPlanted>[number];

const samePair = (v: ConflictVerdict, x: string, y: string) =>
  (v.pair[0] === x && v.pair[1] === y) || (v.pair[0] === y && v.pair[1] === x);
const normPath = (s: string) => s.replace(/\s*(→|->)\s*/g, ' → ').trim();

function acceptable(v: ConflictVerdict, p: ResolvedPlanted): boolean {
  if (samePair(v, p.a, p.b)) return true;
  const [x, y] = v.pair;
  return ([p.a, p.b].includes(x) && p.also.includes(y)) || ([p.a, p.b].includes(y) && p.also.includes(x));
}

async function warm() {
  const index = loadMappingIndex();
  const issues = loadIssues();
  const { name, model } = getProvider();
  // Entries mapped by another model are redone, so the whole cache ends up on one model.
  const stale = (key: string) => readMappingCache(key)?.model !== `${name}:${model}`;
  let done = 0;
  await pool(issues, 6, async (i) => {
    try {
      const m = await withRetry(() =>
        getMappingForTicket({ key: i.key, title: i.title, body: i.body ?? '' }, index, {
          record: readRecord(i.key),
          force: stale(i.key),
        }),
      );
      done++;
      if (!m.cached) console.log(`${done}/${issues.length} ${i.key} ${m.files.join(', ')}`);
    } catch (e) {
      console.log(`FAIL ${i.key}: ${e instanceof Error ? e.message : e}`);
    }
  });
  console.log(`warm done: ${done}/${issues.length}`);
}

async function pairs() {
  const bl = await loadBacklog({ mapMissing: false });
  const all = allPairs(bl);
  const sizes = [...bl.tickets.keys()].map((k) => candidates(k, bl).length);
  console.log(`${bl.tickets.size} tickets, ${all.length} unordered candidate pairs, mean shortlist ${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1)}`);
  for (const p of loadPlanted(bl)) {
    const listed = all.some((q) => (q.a === p.a && q.b === p.b) || (q.a === p.b && q.b === p.a));
    const sig = pairSignals(bl.tickets.get(p.a)!, bl.tickets.get(p.b)!, bl);
    console.log(`${listed ? 'IN ' : 'OUT'} ${p.a} ↔ ${p.b} (${p.type}) files: [${bl.tickets.get(p.a)?.files.join(', ')}] vs [${bl.tickets.get(p.b)?.files.join(', ')}]`);
    for (const s of sig) console.log(`      ${s.weight} ${s.detail}`);
  }
}

async function one(ref: string) {
  const key = resolveKey(ref);
  // checkTicket first: it may pull the ticket (or Agent 1 drafts) in from Jira.
  const result = await checkTicket(key);
  const bl = await getBacklog();
  const t = bl.tickets.get(key);
  console.log(`${key}${key !== ref ? ` (${ref})` : ''}${jiraKey(key) !== key ? ` = Jira ${jiraKey(key)}` : ''}: ${t?.title ?? '?'}`);
  console.log(`  files: ${t?.files.join(', ') || '-'}`);
  for (const c of candidates(key, bl)) console.log(`  candidate ${c.key} score ${c.score}: ${c.signals.map((s) => s.detail).join(' | ')}`);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    result.verdicts.length
      ? `Checked against ${result.candidates} related tickets, ${result.verdicts.length} conflict(s) found.`
      : `Checked against ${result.candidates} related tickets, no conflicts found.`,
  );
  for (const p of loadPlanted(bl).filter((p) => p.a === key || p.b === key)) {
    const v = result.verdicts.find((v) => samePair(v, jiraKey(p.a), jiraKey(p.b)));
    console.log(
      `planted ${p.a} ↔ ${p.b}: ${v ? 'FOUND' : 'MISSED'}` +
        (v ? `, type ${v.type === p.type ? 'ok' : `${v.type} (expected ${p.type})`}, code_path ${normPath(v.evidence.code_path) === normPath(p.expected_code_path) ? 'matches' : `"${v.evidence.code_path}" (expected "${p.expected_code_path}")`}` : ''),
    );
  }
}

async function all() {
  const bl = await getBacklog();
  const started = Date.now();
  const res = await checkAll((done, total) => {
    if (done % 25 === 0 || done === total) console.log(`  compared ${done}/${total} pairs (${Math.round((Date.now() - started) / 1000)}s)`);
  });
  const planted = loadPlanted(bl);
  let typed = 0;
  const caught = planted.filter((p) => {
    const v = res.verdicts.find((v) => samePair(v, p.a, p.b));
    console.log(
      `${v ? 'CAUGHT' : 'missed'} ${p.a} ↔ ${p.b} (${p.type})` +
        (v ? ` → ${v.type} ${v.confidence} "${v.evidence.code_path}"` : ''),
    );
    if (v?.type === p.type) typed++;
    return Boolean(v);
  });
  const fps = res.verdicts.filter((v) => !planted.some((p) => acceptable(v, p)));
  const overlaps = res.verdicts.filter((v) => planted.some((p) => acceptable(v, p) && !samePair(v, p.a, p.b)));
  for (const v of overlaps) console.log(`also-acceptable ${v.pair.join(' ↔ ')} ${v.type} ${v.confidence}`);
  for (const v of fps) console.log(`FP ${v.pair.join(' ↔ ')} ${v.type} ${v.confidence} "${v.evidence.code_path}" | ${v.evidence.ticket_a_line} | ${v.evidence.ticket_b_line}`);
  console.log(`\n${res.pairs} candidate pairs compared; ${typed}/${caught.length} caught with the planted type.`);
  console.log(
    `Caught ${caught.length} of ${planted.length} planted conflicts with ${fps.length} false positive${fps.length === 1 ? '' : 's'} across ${res.tickets} tickets.`,
  );
}

/** Delete pair-cache files that the current prompt, model and backlog would not hit. */
async function prune() {
  const bl = await loadBacklog({ mapMissing: false });
  const keep = new Map<string, string>();
  for (const p of allPairs(bl)) {
    const a = bl.tickets.get(p.a)!;
    const b = bl.tickets.get(p.b)!;
    const path = pairCachePath(p.a, p.b);
    keep.set(path, pairPrompt(a, b, pairSignals(a, b, bl), bl).hash);
    const vh = verifyHash(a, b, bl);
    if (vh) keep.set(path.replace(/\.json$/, '.verify.json'), vh);
  }
  let kept = 0;
  const removed: string[] = [];
  for (const f of existsSync(PAIRS_DIR) ? readdirSync(PAIRS_DIR) : []) {
    const path = `${PAIRS_DIR}/${f}`;
    const { hash, pair } = JSON.parse(readFileSync(path, 'utf8')) as { hash?: string; pair?: string[] };
    // Pairs with a live Jira draft (no data/records entry) can't be re-derived offline; keep them.
    const live = (pair ?? []).some((k) => !bl.tickets.has(k));
    if (keep.get(path) === hash || live) kept++;
    else {
      rmSync(path);
      removed.push(f);
    }
  }
  const missing = [...keep.keys()].filter((p) => !existsSync(p)).length;
  console.log(`pairs cache: kept ${kept}, removed ${removed.length} stale, ${missing} shortlisted pairs not cached`);
  for (const f of removed) console.log(`  removed ${f}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--warm')) return warm();
  if (args.includes('--prune')) return prune();
  if (args.includes('--pairs')) return pairs();
  if (args.includes('--all')) return all();
  const ref = args.find((a) => !a.startsWith('--'));
  if (!ref) throw new Error('usage: npm run check -- <KEY> | --all | --pairs | --warm');
  return one(ref);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
