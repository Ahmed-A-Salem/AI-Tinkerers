/**
 * Phase E — candidate retrieval (brief §5.3). No LLM here: pairs are shortlisted from the code
 * index and the ticket records, and only the shortlist goes to src/compare.
 *
 * Signals between two tickets, strongest first:
 *   removed_used   one ticket removes symbol S, and a file on the other ticket's side imports S's file
 *                  and actually references S (the brief's dependency-break detector)
 *   removed_named  one ticket removes S and the other ticket names S
 *   shared_symbol  both tickets name the same (not ubiquitous) symbol
 *   import_edge    a file of one ticket imports a file of the other (hub files excluded)
 *   shared_file    both map to the same file (hub files excluded; mapping precision is loose)
 *   shared_dir     both map into the same feature directory
 * Components are not used: at this granularity ("hono", "middleware") they match half the backlog.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { loadAllRecords } from '../extract/cache.js';
import { loadIssues } from '../extract/issues.js';
import { getFilesForTicket, loadMappingIndex, readMappingCache, type MappingIndex } from '../mapping/index.js';
import type { ImportGraph, TicketRecord } from '../types.js';

const TARGET = process.env.TARGET_DIR ?? 'target/hono';
/** One structural link alone (a single import edge) is not enough to spend an LLM call on. */
const MIN_SCORE = 5;
const MAX_CANDIDATES = 12;

/** Files nearly everything imports or maps to; alone they say nothing about two tickets. */
const HUBS = new Set([
  'src/index.ts',
  'src/types.ts',
  'src/context.ts',
  'src/hono.ts',
  'src/hono-base.ts',
  'src/request.ts',
  'src/router.ts',
  'src/compose.ts',
  'src/http-exception.ts',
  'src/utils/types.ts',
  'src/utils/html.ts',
  'src/jsx/base.ts',
  'src/jsx/constants.ts',
]);
/** Directories too broad to mean "same feature". */
const GENERIC_DIRS = new Set(['src', 'src/utils', 'src/helper', 'src/middleware', 'src/adapter', 'src/jsx', 'src/router']);
/** A symbol or file named/mapped by more tickets than this is background noise for shared_* signals. */
const MAX_DF = 8;

export interface Ticket {
  key: string;
  title: string;
  body: string;
  record: TicketRecord;
  /** Mapped files (Phase C) ∪ record.files_touched. */
  files: string[];
  /** files plus same-directory files they import (index.ts re-export hop). */
  reach: string[];
  /** record.removes that exist in the index, without "()". */
  removes: string[];
  /** Index symbols the ticket names in prose or inline code, plus removes. */
  named: string[];
  /** Identifiers the ticket names that are not top-level symbols in the index. */
  unknown: string[];
}

export interface Backlog {
  index: MappingIndex;
  imports: ImportGraph;
  tickets: Map<string, Ticket>;
  symbolDf: Map<string, number>;
  fileDf: Map<string, number>;
}

export type SignalKind = 'removed_used' | 'removed_named' | 'shared_symbol' | 'import_edge' | 'shared_file' | 'shared_dir';

export interface Signal {
  kind: SignalKind;
  weight: number;
  detail: string;
  /** For removed_*: which ticket removes the symbol, the symbol, where it lives, who uses it. */
  remover?: string;
  symbol?: string;
  file?: string;
  user?: string;
}

export interface Candidate {
  key: string;
  score: number;
  signals: Signal[];
}

const WEIGHT: Record<SignalKind, number> = {
  removed_used: 6,
  removed_named: 6,
  shared_symbol: 3,
  import_edge: 3,
  shared_file: 2,
  shared_dir: 1,
};

const sourceCache = new Map<string, string>();
export function source(file: string): string {
  let s = sourceCache.get(file);
  if (s === undefined) {
    const p = `${TARGET}/${file}`;
    s = existsSync(p) ? readFileSync(p, 'utf8') : '';
    sourceCache.set(file, s);
  }
  return s;
}

const esc = (s: string) => s.replace(/[$]/g, '\\$');
export const wordRe = (name: string, flags = '') => new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`, flags);

export function symbolFiles(name: string, index: MappingIndex): string[] {
  const c = index.collisions[name];
  if (c) return [...new Set(c.map((e) => e.file))];
  const s = index.symbols[name];
  return s ? [s.file] : [];
}

/** Numbered source lines in `file` that mention `name` (max `limit`). */
export function linesMentioning(file: string, name: string, limit = 3): string[] {
  const re = wordRe(name);
  const out: string[] = [];
  source(file)
    .split('\n')
    .forEach((line, i) => {
      if (out.length < limit && re.test(line)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  return out;
}

const normSymbol = (s: string) => s.trim().replace(/\(\)$/, '').replace(/^.*\./, '');

function identifiers(text: string): Set<string> {
  const prose = text.replace(/```[\s\S]*?```/g, ' ');
  const ids = new Set<string>();
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) for (const id of (m[1] ?? '').matchAll(/[A-Za-z_$][\w$]*/g)) ids.add(id[0]);
  for (const m of prose.matchAll(/([A-Za-z_$][\w$]*)\(/g)) ids.add(m[1] ?? '');
  for (const m of prose.matchAll(/(?<![\w$])[a-z]+[A-Z][\w$]*/g)) ids.add(m[0]);
  ids.delete('');
  return ids;
}

export function buildTicket(key: string, title: string, body: string, record: TicketRecord, mapped: string[], b: Pick<Backlog, 'index' | 'imports'>): Ticket {
  const known = new Set(b.index.files);
  const isSymbol = (n: string) => Boolean(b.index.symbols[n] || b.index.collisions[n]);
  const files = [...new Set([...mapped, ...record.files_touched.filter((f) => known.has(f))])];
  const reach = new Set(files);
  for (const f of files) for (const t of b.imports[f] ?? []) if (posix.dirname(t) === posix.dirname(f) && !HUBS.has(t)) reach.add(t);
  const removes = [...new Set(record.removes.map(normSymbol))].filter(isSymbol);
  const ids = identifiers(`${title}\n${body}`);
  const named = [...new Set([...[...ids].filter((n) => n.length >= 4 && isSymbol(n)), ...removes])];
  const unknown = [...ids].filter((n) => n.length >= 5 && /[a-z][A-Z]|^[a-z]+$/.test(n) && !isSymbol(n) && /[A-Z]/.test(n)).slice(0, 10);
  return { key, title, body, record, files, reach: [...reach], removes, named, unknown };
}

export { jiraKey, resolveKey } from './keys.js';

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

/**
 * Load every ticket that has a record, with its mapped files. Tickets missing from the mapping cache
 * are mapped now (one LLM call each) unless `mapMissing` is false, in which case they get no files.
 */
export async function loadBacklog(opts: { mapMissing?: boolean } = {}): Promise<Backlog> {
  const index = loadMappingIndex();
  const imports: ImportGraph = JSON.parse(readFileSync('data/imports.json', 'utf8'));
  const records = loadAllRecords();
  const issues = new Map(loadIssues().map((i) => [i.key, i]));
  const base = { index, imports };

  const keys = Object.keys(records);
  const mapped = new Map<string, string[]>();
  const missing: string[] = [];
  for (const k of keys) {
    const hit = readMappingCache(k);
    if (hit) mapped.set(k, hit.files);
    else missing.push(k);
  }
  const mapMissing = opts.mapMissing ?? process.env.MAP_MISSING !== '0';
  if (missing.length && mapMissing) {
    const { withRetry } = await import('../compare/index.js');
    await pool(missing, 4, async (k) => {
      const i = issues.get(k);
      const ticket = { key: k, title: i?.title ?? '', body: i?.body ?? '' };
      mapped.set(k, await withRetry(() => getFilesForTicket(ticket, index, { record: records[k] })));
    });
  }

  const tickets = new Map<string, Ticket>();
  for (const k of keys) {
    const i = issues.get(k);
    tickets.set(k, buildTicket(k, i?.title ?? '', i?.body ?? '', records[k]!, mapped.get(k) ?? [], base));
  }
  const symbolDf = new Map<string, number>();
  const fileDf = new Map<string, number>();
  for (const t of tickets.values()) {
    for (const s of t.named) symbolDf.set(s, (symbolDf.get(s) ?? 0) + 1);
    for (const f of t.files) fileDf.set(f, (fileDf.get(f) ?? 0) + 1);
  }
  return { ...base, tickets, symbolDf, fileDf };
}

const isHub = (f: string, b: Backlog) => HUBS.has(f) || (b.fileDf.get(f) ?? 0) > MAX_DF * 2;

/** Removing something used in this many files ("Hono") is an extraction artefact, not a break signal. */
const MAX_SYMBOL_USERS = 12;
const usageCache = new Map<string, number>();
function usageCount(sym: string, bl: Backlog): number {
  let n = usageCache.get(sym);
  if (n === undefined) {
    const re = wordRe(sym);
    n = bl.index.files.filter((f) => re.test(source(f))).length;
    usageCache.set(sym, n);
  }
  return n;
}

/** Why two tickets might conflict, from the index alone. */
export function pairSignals(a: Ticket, b: Ticket, bl: Backlog): Signal[] {
  const out = new Map<string, Signal>();
  const add = (s: Omit<Signal, 'weight'>) => {
    if (!out.has(s.detail)) out.set(s.detail, { ...s, weight: WEIGHT[s.kind] });
  };

  for (const [x, y] of [[a, b], [b, a]] as const) {
    for (const sym of x.removes) {
      if (usageCount(sym, bl) > MAX_SYMBOL_USERS) continue;
      for (const home of symbolFiles(sym, bl.index)) {
        for (const f of y.reach) {
          // A hub importing the symbol (hono-base.ts → getPath) is true of half the backlog; skip it.
          if (f !== home && !isHub(f, bl) && (bl.imports[f] ?? []).includes(home) && wordRe(sym).test(source(f))) {
            add({ kind: 'removed_used', detail: `${x.key} removes ${sym}() from ${home}; ${f} (${y.key}) uses it`, remover: x.key, symbol: sym, file: home, user: f });
          }
        }
      }
      if (y.named.includes(sym) && !y.removes.includes(sym) && (bl.symbolDf.get(sym) ?? 0) <= MAX_DF) {
        add({ kind: 'removed_named', detail: `${x.key} removes ${sym}(); ${y.key} names it`, remover: x.key, symbol: sym, file: symbolFiles(sym, bl.index)[0] });
      }
    }
  }

  for (const sym of a.named) {
    if (b.named.includes(sym) && (bl.symbolDf.get(sym) ?? 0) <= MAX_DF && !a.removes.includes(sym) && !b.removes.includes(sym)) {
      add({ kind: 'shared_symbol', detail: `both name ${sym}()`, symbol: sym, file: symbolFiles(sym, bl.index)[0] });
    }
  }

  const af = a.files.filter((f) => !isHub(f, bl));
  const bf = b.files.filter((f) => !isHub(f, bl));
  for (const fa of af) {
    for (const fb of bf) {
      if (fa === fb) add({ kind: 'shared_file', detail: `both map to ${fa}`, file: fa });
      else if ((bl.imports[fa] ?? []).includes(fb)) add({ kind: 'import_edge', detail: `${fa} (${a.key}) imports ${fb} (${b.key})`, file: fb, user: fa });
      else if ((bl.imports[fb] ?? []).includes(fa)) add({ kind: 'import_edge', detail: `${fb} (${b.key}) imports ${fa} (${a.key})`, file: fa, user: fb });
    }
  }
  const dirs = (fs: string[]) => new Set(fs.map((f) => posix.dirname(f)).filter((d) => !GENERIC_DIRS.has(d)));
  const bd = dirs(bf);
  for (const d of dirs(af)) if (bd.has(d)) add({ kind: 'shared_dir', detail: `both map into ${d}/` });

  return [...out.values()].sort((p, q) => q.weight - p.weight);
}

/**
 * Score = sum of weights of the distinct signal kinds present, so ten import edges inside one feature
 * directory count once. Two tickets in the same area are not enough: a pair needs a symbol-level link
 * (a removed symbol or a shared named symbol), because both conflict types are about a specific API.
 */
export function scorePair(a: Ticket, b: Ticket, bl: Backlog): Candidate {
  const signals = pairSignals(a, b, bl);
  const kinds = new Set(signals.map((s) => s.kind));
  const score = [...kinds].reduce((n, k) => n + WEIGHT[k], 0);
  return { key: b.key, score, signals };
}

const hasSymbolLink = (c: Candidate) => c.signals.some((s) => s.kind === 'removed_used' || s.kind === 'removed_named' || s.kind === 'shared_symbol');

/** Shortlist for one ticket: every other ticket scoring ≥ MIN_SCORE with a symbol-level link, best first, capped. */
export function candidates(key: string, bl: Backlog): Candidate[] {
  const t = bl.tickets.get(key);
  if (!t) throw new Error(`no record for ${key}`);
  const out: Candidate[] = [];
  for (const o of bl.tickets.values()) {
    if (o.key === key) continue;
    const c = scorePair(t, o, bl);
    if (c.score >= MIN_SCORE && hasSymbolLink(c)) out.push(c);
  }
  return out.sort((p, q) => q.score - p.score).slice(0, MAX_CANDIDATES);
}

/** Every unordered pair that some ticket shortlists. */
export function allPairs(bl: Backlog): { a: string; b: string; candidate: Candidate }[] {
  const seen = new Map<string, { a: string; b: string; candidate: Candidate }>();
  for (const key of bl.tickets.keys()) {
    for (const c of candidates(key, bl)) {
      const [a, b] = sortPair(key, c.key);
      const id = `${a}|${b}`;
      if (!seen.has(id)) seen.set(id, { a, b, candidate: c });
    }
  }
  return [...seen.values()];
}

export function sortPair(x: string, y: string): [string, string] {
  return x.localeCompare(y, 'en', { numeric: true }) <= 0 ? [x, y] : [y, x];
}

export function listIndexedFiles(): string[] {
  return existsSync(`${TARGET}/src`) ? readdirSync(`${TARGET}/src`) : [];
}
