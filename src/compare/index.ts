/**
 * Phase E — pairwise comparison (brief §5.3). One LLM call per shortlisted pair. The model sees both
 * tickets' text and records plus the slice of the code graph that links them (retrieval signals and
 * the real source lines that use the symbols involved), and returns a verdict or "none".
 *
 * Pairs are compared in sorted key order so checkTicket and --all share one cache:
 * data/verdicts/pairs/<A>__<B>.json, keyed by a hash of the prompt and model.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { completeJson, getProvider } from '../extract/llm.js';
import type { ConflictType, ConflictVerdict } from '../types.js';
import {
  linesMentioning,
  pairSignals,
  sortPair,
  source as sourceOf,
  symbolFiles,
  wordRe,
  type Backlog,
  type Signal,
  type Ticket,
} from '../retrieval/index.js';

const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 0.75);
const MAX_BODY_CHARS = 3000;
const PAIR_CACHE = 'data/verdicts/pairs';

export async function withRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (i >= tries - 1 || (status !== 429 && !(status && status >= 500))) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i + Math.random() * 1000));
    }
  }
}

interface ModelVerdict {
  conflict: boolean;
  type: 'dependency_break' | 'ordering' | 'none';
  confidence: number;
  ticket_a_line: string;
  ticket_b_line: string;
  file: string;
  symbol: string;
  reason: string;
}

const VERDICT_SCHEMA = {
  name: 'conflict_verdict',
  schema: {
    type: 'object',
    properties: {
      conflict: { type: 'boolean' },
      type: { type: 'string', enum: ['dependency_break', 'ordering', 'none'] },
      confidence: { type: 'number' },
      ticket_a_line: { type: 'string' },
      ticket_b_line: { type: 'string' },
      file: { type: 'string' },
      symbol: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['conflict', 'type', 'confidence', 'ticket_a_line', 'ticket_b_line', 'file', 'symbol', 'reason'],
    additionalProperties: false,
  },
};

const SYSTEM = `You review pairs of backlog tickets for the hono web framework (github.com/honojs/hono) and decide whether they conflict. Only two kinds of conflict count:

1. dependency_break: one ticket relies on a symbol, option or behaviour that exists in the code today, and the other ticket removes it, makes it private, renames it, or changes it so the first ticket can no longer work as written.
2. ordering: one ticket is only correct if the other ships first. It uses or assumes an API, option or behaviour that does not exist in the code today, the other ticket is what would add it, and neither ticket says it depends on the other.

These are NOT conflicts: two tickets touching the same file or feature; related or overlapping feature requests; a bug report and a fix for the same bug; duplicates; tickets that can ship in any order; vague similarity; a ticket that merely mentions the symbol as a comparison or example. The relying ticket must actually need the symbol to keep existing (its requested behaviour calls it, extends it, or is built on it). It is not enough that a file the ticket would edit happens to use the symbol somewhere else: a ticket about one option or code path of a module does not rely on a helper that the module uses for a different option. Most pairs you see are not conflicts. Answer conflict=true only when you can point at the concrete symbol and the concrete sentence in each ticket.

Use the code facts you are given (import edges, source lines) to check claims about what exists today.

Return JSON:
- conflict, type ("none" when conflict is false), confidence 0..1.
- ticket_a_line / ticket_b_line: one sentence copied verbatim from that ticket's own title, body or asserted facts (never from the code graph or predicted files) that shows the clash. Empty strings when no conflict.
- file: the src/... file where the contested symbol lives; symbol: exactly one identifier, without "()". Empty when no conflict.
- reason: one sentence.`;

function trimBody(body: string): string {
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n[truncated]` : body;
}

function ticketBlock(label: string, t: Ticket): string {
  const r = t.record;
  const facts = [
    r.behaviors_asserted.length ? `asserts: ${r.behaviors_asserted.map((s) => `"${s}"`).join('; ')}` : '',
    r.removes.length ? `removes: ${r.removes.join(', ')}` : '',
    r.depends_on.length ? `depends_on: ${r.depends_on.join(', ')}` : '',
    Object.keys(r.values_specified).length ? `values: ${JSON.stringify(r.values_specified)}` : '',
    `files (predicted): ${t.files.join(', ') || '-'}`,
  ].filter(Boolean);
  return `## Ticket ${label} — ${t.key}: ${t.title}\n${trimBody(t.body)}\n\nExtracted facts:\n${facts.map((f) => `- ${f}`).join('\n')}`;
}

/** The slice of the code graph that links the two tickets. */
export function codeSlice(a: Ticket, b: Ticket, signals: Signal[], bl: Backlog): string {
  const lines: string[] = [];
  lines.push('Links found in the code index:');
  const shown = new Map<string, number>();
  for (const s of signals) {
    const n = shown.get(s.kind) ?? 0;
    shown.set(s.kind, n + 1);
    if (n < 4) lines.push(`- ${s.detail}`);
  }
  if (!signals.length) lines.push('- none');

  const evidence = new Set<string>();
  for (const s of signals) {
    if (!s.symbol) continue;
    for (const f of [s.file, s.user].filter((x): x is string => Boolean(x))) {
      for (const l of linesMentioning(f, s.symbol, 3)) evidence.add(l);
    }
  }
  for (const sym of new Set([...a.removes, ...b.removes])) {
    for (const f of symbolFiles(sym, bl.index)) for (const l of linesMentioning(f, sym, 1)) evidence.add(l);
  }
  if (evidence.size) {
    lines.push('', 'Source lines in the repo today:');
    for (const l of [...evidence].slice(0, 24)) lines.push(`  ${l}`);
  }

  const unknown = [...new Set([...a.unknown, ...b.unknown])].slice(0, 12);
  if (unknown.length) {
    lines.push('', 'Identifiers the tickets mention that are not top-level exports (where the name appears in src, if anywhere):');
    for (const id of unknown) {
      const where = bl.index.files.filter((f) => new RegExp(`(?<![\\w$])${id.replace(/\$/g, '\\$')}(?![\\w$])`).test(sourceOf(f))).slice(0, 4);
      lines.push(`- ${id}: ${where.length ? where.join(', ') : 'not found anywhere in src (does not exist today)'}`);
    }
  }
  return lines.join('\n');
}

export function pairCachePath(a: string, b: string): string {
  return `${PAIR_CACHE}/${`${a}__${b}`.replace(/[^\w.-]/g, '_')}.json`;
}

/** Prompt and cache hash for the sorted pair (a before b). */
export function pairPrompt(a: Ticket, b: Ticket, signals: Signal[], bl: Backlog): { user: string; hash: string } {
  const user = `${ticketBlock('A', a)}\n\n${ticketBlock('B', b)}\n\n## Code graph\n${codeSlice(a, b, signals, bl)}`;
  const { name, model } = getProvider();
  return { user, hash: createHash('sha1').update(`${name}:${model}\n${SYSTEM}\n${user}`).digest('hex') };
}

interface Verification {
  changer: 'A' | 'B';
  change_is_explicit: boolean;
  dependent_needs_it: boolean;
  type: 'dependency_break' | 'ordering' | 'none';
  confidence: number;
  reason: string;
}

const VERIFY_SCHEMA = {
  name: 'conflict_verification',
  schema: {
    type: 'object',
    properties: {
      changer: { type: 'string', enum: ['A', 'B'] },
      change_is_explicit: { type: 'boolean' },
      dependent_needs_it: { type: 'boolean' },
      type: { type: 'string', enum: ['dependency_break', 'ordering', 'none'] },
      confidence: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['changer', 'change_is_explicit', 'dependent_needs_it', 'type', 'confidence', 'reason'],
    additionalProperties: false,
  },
};

const VERIFY_SYSTEM = `A first reviewer flagged two hono backlog tickets as conflicting. You are the second reviewer, and you are skeptical: most flags are wrong. Check the claim against the tickets' own text and the code facts.

The first reviewer's type or symbol may be wrong: judge the pair on its merits and report the type that actually holds.

Decide:
- changer: for dependency_break, the ticket ("A" or "B") that changes the contested symbol; for ordering, the ticket that adds the API or option the other one assumes.
- change_is_explicit: true if the changer's own text explicitly says it removes, deletes, renames, makes private, deprecates or replaces the symbol, or changes its signature or the behaviour its callers rely on; or, for ordering, it is the ticket that adds an API or option that does not exist in the code today. "Fix a bug in", "improve", "move", "add an option to" something unrelated, or only discussing the symbol are false.
- dependent_needs_it: true if the other ticket's own requested change needs the symbol as it is today: it calls, extends or re-exports it, or its feature would be built in code that uses the symbol for exactly the behaviour the ticket is about (for example, the ticket extends a parsing, negotiation or signing step and that step is done by the symbol). For ordering: the other ticket's text assumes the new API or option already exists. False when the ticket only mentions the symbol, uses it in an example or a bug report, wants something similar, or works on a different aspect of a module that happens to call the symbol.
- type: "dependency_break" or "ordering" if both are true (pick the one that fits), otherwise "none".
- confidence 0..1 and a one-sentence reason.`;

/** Second, skeptical pass over a positive verdict; cached next to the pair as <A>__<B>.verify.json. */
async function verify(a: Ticket, b: Ticket, user: string, v: ModelVerdict): Promise<Verification> {
  const claim = `\n\n## First reviewer's claim\ntype: ${v.type}\nsymbol: ${v.symbol} in ${v.file}\nticket A line: ${v.ticket_a_line}\nticket B line: ${v.ticket_b_line}\nreason: ${v.reason}`;
  const { name, model } = getProvider();
  const hash = createHash('sha1').update(`${name}:${model}\n${VERIFY_SYSTEM}\n${user}${claim}`).digest('hex');
  const path = pairCachePath(a.key, b.key).replace(/\.json$/, '.verify.json');
  if (existsSync(path)) {
    const hit = JSON.parse(readFileSync(path, 'utf8')) as { hash: string; verification: Verification };
    if (hit.hash === hash) return hit.verification;
  }
  const verification = await withRetry(() => completeJson<Verification>(VERIFY_SYSTEM, `${user}${claim}`, VERIFY_SCHEMA));
  mkdirSync(PAIR_CACHE, { recursive: true });
  writeFileSync(path, JSON.stringify({ hash, model: `${name}:${model}`, pair: [a.key, b.key], verification }, null, 2));
  return verification;
}

/** Hash of the verify prompt for a cached first verdict, or null when the pair has no positive verdict. For --prune. */
export function verifyHash(a: Ticket, b: Ticket, bl: Backlog): string | null {
  const path = pairCachePath(a.key, b.key);
  if (!existsSync(path)) return null;
  const { verdict: v } = JSON.parse(readFileSync(path, 'utf8')) as { verdict: ModelVerdict };
  const { user } = pairPrompt(a, b, pairSignals(a, b, bl), bl);
  const claim = `\n\n## First reviewer's claim\ntype: ${v.type}\nsymbol: ${v.symbol} in ${v.file}\nticket A line: ${v.ticket_a_line}\nticket B line: ${v.ticket_b_line}\nreason: ${v.reason}`;
  const { name, model } = getProvider();
  return createHash('sha1').update(`${name}:${model}\n${VERIFY_SYSTEM}\n${user}${claim}`).digest('hex');
}

/** Raw model answer for the sorted pair, cached by prompt+model hash. */
async function judge(a: Ticket, b: Ticket, signals: Signal[], bl: Backlog): Promise<ModelVerdict> {
  const { user, hash } = pairPrompt(a, b, signals, bl);
  const { name, model } = getProvider();
  const path = pairCachePath(a.key, b.key);
  if (existsSync(path)) {
    const hit = JSON.parse(readFileSync(path, 'utf8')) as { hash: string; verdict: ModelVerdict };
    if (hit.hash === hash) return hit.verdict;
  }
  const verdict = await withRetry(() => completeJson<ModelVerdict>(SYSTEM, user, VERDICT_SCHEMA));
  mkdirSync(PAIR_CACHE, { recursive: true });
  writeFileSync(path, JSON.stringify({ hash, model: `${name}:${model}`, pair: [a.key, b.key], signals: signals.map((s) => s.detail), verdict }, null, 2));
  return verdict;
}

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9$]+/g) ?? []).filter((w) => w.length >= 3);

const REMOVAL = /\b(remov|delet|drop|deprecat|replac|renam|obsolet|private|no longer|rip out|get rid)/i;

/** True when some sentence of the ticket names `symbol` together with a removal verb. */
function saysRemoved(t: Ticket, symbol: string): boolean {
  const re = wordRe(symbol);
  return `${t.title}\n${t.body}\n${t.record.behaviors_asserted.join('\n')}`
    .split(/[.\n]/)
    .some((s) => re.test(s) && REMOVAL.test(s));
}

/** True when `line` is (near-)verbatim ticket text: ≥80% of its words occur in the ticket, and it is not a line we generated. */
function quotes(line: string, t: Ticket): boolean {
  if (/\((?:SCRUM|PLANT|GH)-\d+\)|files \(predicted\)/i.test(line)) return false;
  const lw = words(line);
  if (!lw.length) return false;
  const text = new Set(words(`${t.title}\n${t.body}\n${t.record.behaviors_asserted.join('\n')}`));
  return lw.filter((w) => text.has(w)).length / lw.length >= 0.8;
}

/** Verdict for the pair, oriented so pair[0] is `x`, or null when the model finds no conflict. */
export async function compare(x: Ticket, y: Ticket, bl: Backlog): Promise<ConflictVerdict | null> {
  const [ka] = sortPair(x.key, y.key);
  const [a, b] = ka === x.key ? [x, y] : [y, x];
  const signals = pairSignals(a, b, bl);
  const v = await judge(a, b, signals, bl);
  if (!v.conflict || v.type === 'none' || v.confidence < MIN_CONFIDENCE) return null;
  // Evidence must be the tickets' own words, not the code facts or predicted files we showed the model.
  if (!quotes(v.ticket_a_line, a) || !quotes(v.ticket_b_line, b)) return null;
  let type = v.type as ConflictType;
  let confidence = v.confidence;
  let changerHint: 'A' | 'B' | undefined;
  if (process.env.VERIFY !== '0') {
    const check = await verify(a, b, pairPrompt(a, b, signals, bl).user, v);
    if (!check.change_is_explicit || !check.dependent_needs_it || check.type === 'none' || check.confidence < MIN_CONFIDENCE) return null;
    type = check.type;
    confidence = Math.min(confidence, check.confidence);
    changerHint = check.changer;
  }

  // One symbol for the code path: prefer the one the index links the two tickets through.
  const named = v.symbol.split(/[^\w$]+/).filter(Boolean);
  const linked = ['removed_used', 'removed_named', 'shared_symbol'].flatMap((k) => signals.filter((s) => s.kind === k).map((s) => s.symbol ?? ''));
  const symbol = linked.find((s) => named.includes(s)) ?? named.find((s) => symbolFiles(s, bl.index).length > 0) ?? named[0] ?? '';
  const homes = symbol ? symbolFiles(symbol, bl.index) : [];
  const fileRaw = v.file.replace(/^.*?(?=src\/)/, '').trim();
  const file = homes.includes(fileRaw) ? fileRaw : (homes[0] ?? fileRaw);
  const code_path = symbol ? `${file} → ${symbol}()` : file;

  // A dependency break needs the changing ticket to say, in its own words, that the symbol goes away.
  // Records' `removes` are noisy ("modify serveStatic", "reorder getSignedCookie's args" land there too).
  if (type === 'dependency_break') {
    const aRem = a.removes.includes(symbol);
    const bRem = b.removes.includes(symbol);
    const changer = aRem !== bRem ? (aRem ? a : b) : changerHint === 'B' ? b : changerHint === 'A' ? a : saysRemoved(a, symbol) ? a : b;
    if (!symbol || !saysRemoved(changer, symbol)) return null;
  }

  const flip = a.key !== x.key;
  return {
    pair: [x.key, y.key],
    type,
    confidence: Math.round(confidence * 100) / 100,
    evidence: {
      ticket_a_line: flip ? v.ticket_b_line : v.ticket_a_line,
      ticket_b_line: flip ? v.ticket_a_line : v.ticket_b_line,
      code_path,
    },
  };
}
