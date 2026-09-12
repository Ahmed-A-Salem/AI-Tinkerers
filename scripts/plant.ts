/**
 * Phase D — planted conflicts + ground truth (brief §9).
 *
 *   npx tsx scripts/plant.ts            # sync data/planted-tickets.json into data/hono-issues.json
 *   npx tsx scripts/plant.ts --check    # verify data/planted.json; exits 1 on any failure
 *
 * data/planted.json is the ground truth Phase E is scored against. Each entry is
 * `pair: [A, B]`: for dependency_break, B removes a symbol that A's code path imports; for
 * ordering, B is only correct once A ships. A is a real hono issue (GH-<number>), B is a planted
 * ticket (PLANT-n). `edge` is the import edge that makes the conflict visible in the code graph.
 *
 * Keys follow the Phase B convention: GH-<number> until the Jira import, after which the real
 * key is looked up through data/gh-to-jira.json. Sync is idempotent: PLANT-n entries already in
 * hono-issues.json are replaced in place, missing ones are appended.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ConflictType, ImportGraph, SymbolEntry, SymbolIndex } from '../src/types';

const ISSUES = 'data/hono-issues.json';
const TICKETS = 'data/planted-tickets.json';
const PLANTED = 'data/planted.json';
const MAPPING = 'data/gh-to-jira.json';
const TARGET = 'target/hono';
const CHECK = process.argv.includes('--check');

interface PlantedConflict {
  pair: [string, string];
  type: ConflictType;
  /** "src/file.ts → symbol()", same format as ConflictVerdict.evidence.code_path. */
  expected_code_path: string;
  edge: { from: string; to: string };
  note: string;
  demo?: boolean;
  /** Real overlaps on the same code that should not count as false positives. */
  also_acceptable?: string[];
}

interface PlantedTicket {
  key: string;
  title: string;
  body: string;
  labels: { name: string }[];
  createdAt: string;
}

interface SourceIssue {
  key?: string;
  number?: number;
  title: string;
  body: string | null;
}

interface MappingRow {
  key: string;
  gh?: number;
  src?: string;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function sync() {
  const tickets = readJson<PlantedTicket[]>(TICKETS);
  const issues = readJson<(SourceIssue | PlantedTicket)[]>(ISSUES);
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const replaced = new Set<string>();
  const out = issues.map((i) => {
    const t = 'key' in i && i.key ? byKey.get(i.key) : undefined;
    if (!t) return i;
    replaced.add(t.key);
    return t;
  });
  const appended = tickets.filter((t) => !replaced.has(t.key));
  out.push(...appended);
  // Same compact one-line layout as the gh export, so the diff stays readable in review.
  writeFileSync(ISSUES, JSON.stringify(out) + '\n');
  console.log(`${ISSUES}: ${replaced.size} planted replaced, ${appended.length} appended, ${out.length} total`);
}

function resolveIssue(key: string, issues: SourceIssue[], mapping: MappingRow[]): SourceIssue | undefined {
  const gh = /^GH-(\d+)$/.exec(key);
  if (gh) return issues.find((i) => i.number === Number(gh[1]));
  const direct = issues.find((i) => i.key === key);
  if (direct) return direct;
  const row = mapping.find((r) => r.key === key);
  if (row?.gh !== undefined) return issues.find((i) => i.number === row.gh);
  if (row?.src) return issues.find((i) => i.key === row.src);
  return undefined;
}

function check() {
  const planted = readJson<PlantedConflict[]>(PLANTED);
  const tickets = readJson<PlantedTicket[]>(TICKETS);
  const issues = readJson<SourceIssue[]>(ISSUES);
  const symbols = readJson<SymbolIndex>('data/symbols.json');
  const imports = readJson<ImportGraph>('data/imports.json');
  const collisions = readJson<Record<string, SymbolEntry[]>>('data/symbol-collisions.json');
  const mapping = existsSync(MAPPING) ? readJson<MappingRow[]>(MAPPING) : [];
  const haveSource = existsSync(TARGET);

  const failures: string[] = [];
  const fail = (where: string, msg: string) => failures.push(`${where}: ${msg}`);

  const count = (t: ConflictType) => planted.filter((p) => p.type === t).length;
  if (planted.length !== 6) fail(PLANTED, `expected 6 entries, got ${planted.length}`);
  if (count('dependency_break') !== 4) fail(PLANTED, `expected 4 dependency_break, got ${count('dependency_break')}`);
  if (count('ordering') !== 2) fail(PLANTED, `expected 2 ordering, got ${count('ordering')}`);
  if (planted.filter((p) => p.demo).length !== 1) fail(PLANTED, 'expected exactly one demo pair');
  const plantKeys = planted.map((p) => p.pair[1]).sort();
  const expectedKeys = tickets.map((t) => t.key).sort();
  if (JSON.stringify(plantKeys) !== JSON.stringify(expectedKeys)) {
    fail(PLANTED, `B sides ${plantKeys.join(',')} do not match ${TICKETS} keys ${expectedKeys.join(',')}`);
  }

  planted.forEach((p, n) => {
    const where = `#${n + 1} ${p.pair.join(' ↔ ')}`;
    const [keyA, keyB] = p.pair;

    // Both tickets exist, and the planted one is synced into the backlog file.
    const a = resolveIssue(keyA, issues, mapping);
    const b = resolveIssue(keyB, issues, mapping);
    if (!a) fail(where, `${keyA} not found in ${ISSUES}`);
    if (!b) fail(where, `${keyB} not found in ${ISSUES} (run npx tsx scripts/plant.ts)`);
    const ticket = tickets.find((t) => t.key === keyB);
    if (!ticket) fail(where, `${keyB} not in ${TICKETS}`);
    else if (b && (b.title !== ticket.title || b.body !== ticket.body)) fail(where, `${keyB} in ${ISSUES} is stale (run sync)`);
    for (const k of p.also_acceptable ?? []) if (!resolveIssue(k, issues, mapping)) fail(where, `also_acceptable ${k} not found`);

    // Code path names a real file and symbol from the index.
    const m = /^(\S+)\s+→\s+([\w$]+)(?:\(\))?$/.exec(p.expected_code_path);
    if (!m) return fail(where, `expected_code_path "${p.expected_code_path}" is not "file → symbol()"`);
    const [, file, symbol] = m as unknown as [string, string, string];
    const entries = [symbols[symbol], ...(collisions[symbol] ?? [])].filter((e): e is SymbolEntry => !!e);
    const entry = entries.find((e) => e.file === file);
    if (!entry) fail(where, `symbol ${symbol} is not declared in ${file} per data/symbols.json`);

    // The import edge exists and connects to the symbol's file.
    const { from, to } = p.edge;
    if (!imports[from]?.includes(to)) fail(where, `edge ${from} → ${to} not in data/imports.json`);
    if (p.type === 'dependency_break') {
      if (to !== file) fail(where, `edge target ${to} is not the symbol's file ${file}`);
      if (entry && !entry.exported) fail(where, `${symbol} is not exported, so nothing can import it`);
    } else if (file !== from && file !== to) {
      fail(where, `symbol file ${file} is not an endpoint of edge ${from} → ${to}`);
    }

    // The importing file really uses the symbol (not just some other export of the same module).
    if (haveSource && !readFileSync(`${TARGET}/${from}`, 'utf8').includes(symbol)) {
      fail(where, `${TARGET}/${from} never mentions ${symbol}`);
    }

    // Retrieval can find it: the planted ticket names the symbol or the file, and never cites the
    // other ticket or states a dependency (that would make the conflict trivial).
    const textB = `${ticket?.title ?? ''}\n${ticket?.body ?? ''}`;
    if (!textB.includes(symbol) && !textB.includes(file)) fail(where, `${keyB} mentions neither ${symbol} nor ${file}`);
    if (/#\d{3,}|depends on|blocked by/i.test(textB)) fail(where, `${keyB} references another issue or states a dependency`);
  });

  for (const p of planted) {
    const tag = [p.demo ? 'demo' : '', p.also_acceptable?.length ? `also: ${p.also_acceptable.join(',')}` : '']
      .filter(Boolean)
      .join('; ');
    console.log(`${p.type.padEnd(16)} ${p.pair[0].padEnd(8)} ↔ ${p.pair[1].padEnd(8)} ${p.expected_code_path}${tag ? `  [${tag}]` : ''}`);
  }
  if (!haveSource) console.log(`(${TARGET} absent: source usage check skipped)`);

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    `\nplanted.json OK: ${planted.length} conflicts (${count('dependency_break')} dependency_break, ${count('ordering')} ordering), ` +
      `all files, symbols and import edges verified${haveSource ? ' against target/hono' : ''}`,
  );
}

if (CHECK) check();
else sync();
