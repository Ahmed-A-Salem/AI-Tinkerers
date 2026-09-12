/**
 * Phase C runner. <KEY> is a record key (SCRUM-37, PLANT-2) or a GitHub issue (GH-2762, #2762, 2762).
 *   npm run map -- <KEY>          predicted files for one ticket (cached in data/mapping/<KEY>.json)
 *   npm run map -- <KEY> --force  ignore the cache and re-run the LLM
 *   npm run map -- <KEY> --dry    prompt size + deterministic parts only, no LLM call
 *   npm run map -- --eval         run the eval cases in data/mapping-eval.md, print hits + decision
 *                                 (--force works here too)
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { readRecord } from '../src/extract/cache.js';
import { ghKey, loadIssues } from '../src/extract/issues.js';
import {
  buildPrompt,
  collisionFiles,
  getMappingForTicket,
  loadMappingIndex,
  mentionedPaths,
  namedCollisionSymbols,
  type MappingTicket,
} from '../src/mapping/index.js';

const EVAL_FILE = 'data/mapping-eval.md';
const index = loadMappingIndex();
const issues = loadIssues();

/** GH-n / #n / n resolve through gh-to-jira.json to the record key; anything else is a key already. */
function findTicket(ref: string): MappingTicket {
  const gh = ref.match(/^(?:GH-|#)?(\d+)$/)?.[1];
  const key = gh ? ghKey(Number(gh)) : ref;
  const issue = issues.find((i) => i.key === key);
  if (!issue) throw new Error(`no issue with key ${key}${gh ? ` (from ${ref})` : ''}`);
  return { key: issue.key, title: issue.title, body: issue.body ?? '' };
}

function dry(ticket: MappingTicket) {
  const { system, user } = buildPrompt(ticket, index);
  const text = `${ticket.title}\n${ticket.body}`;
  const symbols = namedCollisionSymbols(text, index, readRecord(ticket.key)?.removes);
  console.log(`${ticket.key}  ${ticket.title}`);
  console.log(`  prompt       ${system.length + user.length} chars, ${index.files.length} files in tree`);
  console.log(`  linked paths ${mentionedPaths(text, index).join(', ') || '-'}`);
  console.log(`  collisions   ${symbols.join(', ') || '-'} → ${collisionFiles(symbols, index).join(', ') || '-'}`);
}

/** Rows of the eval table: | # | Issue | Title | Expected file(s) | ... — expected alternatives split on " or ". */
function evalCases(): { issue: string; expected: string[] }[] {
  return readFileSync(EVAL_FILE, 'utf8')
    .split('\n')
    .map((line) => line.split('|').map((c) => c.trim()))
    .filter((cells) => /^\d+$/.test(cells[1] ?? '') && /^#?\d+$|^[A-Z]+-\d+$/.test(cells[2] ?? ''))
    .map((cells) => ({
      issue: cells[2] ?? '',
      expected: (cells[4] ?? '').split(' or ').map((s) => s.replace(/`/g, '').trim()),
    }));
}

async function runEval(force: boolean) {
  const cases = evalCases();
  let hits = 0;
  for (const [i, c] of cases.entries()) {
    const ticket = findTicket(c.issue);
    const m = await getMappingForTicket(ticket, index, { force, record: readRecord(ticket.key) });
    const hit = c.expected.some((e) => m.source[e] === 'llm' || m.source[e] === 'collision');
    if (hit) hits++;
    const cells = m.files.map((f) => `\`${f}\` (${m.source[f]})`).join('<br>') || '-';
    console.log(`| ${i + 1} | ${c.issue} → ${ticket.key} | ${hit ? 'HIT' : 'miss'} | ${cells} |`);
  }
  const decision = hits >= 3 ? 'COMMIT' : 'FALLBACK';
  console.log(`\n${hits}/${cases.length} include the expected file → ${decision}`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  if (args.includes('--eval')) return runEval(force);
  const ref = args.find((a) => !a.startsWith('--'));
  if (!ref) throw new Error('usage: npm run map -- <KEY> [--force | --dry] | --eval [--force]');
  const ticket = findTicket(ref);
  if (args.includes('--dry')) return dry(ticket);
  const m = await getMappingForTicket(ticket, index, { force, record: readRecord(ticket.key) });
  console.log(`${ticket.key}  ${ticket.title}  (${m.cached ? 'cached' : m.model})`);
  for (const f of m.files) console.log(`  ${f}  [${m.source[f]}]`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
