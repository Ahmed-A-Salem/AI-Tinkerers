/**
 * Phase B — ticket text → brief §5.2 TicketRecord. One cheap LLM call per ticket.
 *
 * The model only sees vocabulary that exists in the target repo (component names from the
 * file tree, symbol names from symbols.json that the ticket text actually mentions), and every
 * name it returns is post-filtered against that vocabulary, so a record never claims a symbol
 * or component the codebase does not have. files_touched stays empty here; Phase C fills it.
 */
import { readFileSync } from 'node:fs';
import type { ImportGraph, SymbolIndex, TicketRecord } from '../types.js';
import { completeJson, type JsonSchemaSpec } from './llm.js';
import { ghKey, labelNames, type KeyedIssue } from './issues.js';

export interface Vocab {
  components: string[];
  symbols: Set<string>;
}

/** Components = top-level entries under src/ (dirs and core files) — hono's natural module names. */
export function buildVocab(symbolsPath = 'data/symbols.json', importsPath = 'data/imports.json'): Vocab {
  const symbols = JSON.parse(readFileSync(symbolsPath, 'utf8')) as SymbolIndex;
  const imports = JSON.parse(readFileSync(importsPath, 'utf8')) as ImportGraph;
  const components = new Set<string>();
  for (const file of Object.keys(imports)) {
    const m = /^src\/([^/]+)/.exec(file);
    if (m?.[1]) components.add(m[1].replace(/\.tsx?$/, ''));
  }
  return { components: [...components].sort(), symbols: new Set(Object.keys(symbols)) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Symbols the ticket text names verbatim (word boundary, case-sensitive: `getPath`, `HTTPException`).
 * All-lowercase symbols (`order`, `body`, `cache`) are also plain English, so they only count
 * when they appear in code position: after a dot or backtick, or followed by `(`.
 */
export function mentionedSymbols(text: string, vocab: Vocab, max = 40): string[] {
  const found: string[] = [];
  for (const s of vocab.symbols) {
    if (s.length < 3) continue;
    const sym = escapeRe(s);
    const re = /^[a-z]+$/.test(s)
      ? new RegExp(`([.\`]${sym}(?![A-Za-z0-9_$]))|((^|[^A-Za-z0-9_$])${sym}\\()`)
      : new RegExp(`(^|[^A-Za-z0-9_$])${sym}(?![A-Za-z0-9_$])`);
    if (re.test(text)) found.push(s);
    if (found.length >= max) break;
  }
  return found;
}

/** Strict schemas cannot express Record<string,string>; values_specified travels as pairs. */
export interface RawRecord {
  components: string[];
  behaviors_asserted: string[];
  values_specified: { name: string; value: string }[];
  removes: string[];
  depends_on: string[];
}

const SCHEMA: JsonSchemaSpec = {
  name: 'ticket_record',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['components', 'behaviors_asserted', 'values_specified', 'removes', 'depends_on'],
    properties: {
      components: { type: 'array', items: { type: 'string' } },
      behaviors_asserted: { type: 'array', items: { type: 'string' } },
      values_specified: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'value'],
          properties: { name: { type: 'string' }, value: { type: 'string' } },
        },
      },
      removes: { type: 'array', items: { type: 'string' } },
      depends_on: { type: 'array', items: { type: 'string' } },
    },
  },
};

const SYSTEM = `You reduce a software issue/ticket to the facts a conflict checker reasons over.
Return ONLY what the ticket text supports. Never invent. Empty arrays are correct when the ticket says nothing.

Fields:
- components: which parts of the codebase the ticket is about. Choose ONLY from the component list given. 1-3 entries. If nothing fits, choose the closest one.
- behaviors_asserted: concrete behaviours the ticket states or requires, one short sentence each, in the ticket's own terms (e.g. "middleware runs in registration order", "c.req.param() decodes percent-encoding"). 0-5 entries. Not questions, not complaints.
- values_specified: concrete values the ticket pins down: timeouts, limits, defaults, status codes, header names, versions. name = snake_case identifier, value = the literal. Only when a specific value appears in the text.
- removes: symbols (functions, classes, types, methods, options) the ticket proposes to remove, rename, deprecate, or change the signature/behaviour of. Use bare names from the candidate symbol list ONLY. Empty if the ticket removes nothing.
- depends_on: other ticket keys or issue numbers this ticket explicitly says it depends on / must come after (e.g. "#1234", "after PROJ-5 lands"). Only explicit references.`;

export function buildPrompt(issue: KeyedIssue, vocab: Vocab): { user: string; candidates: string[] } {
  const body = (issue.body ?? '').trim();
  const candidates = mentionedSymbols(`${issue.title}\n${body}`, vocab);
  const labels = labelNames(issue);
  const user = [
    `Ticket ${issue.key}`,
    `Title: ${issue.title}`,
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    `Body:\n${body.slice(0, 6000) || '(no description)'}`,
    '',
    `Component list: ${vocab.components.join(', ')}`,
    `Candidate symbols (named in the ticket; use only these in "removes"): ${candidates.length ? candidates.join(', ') : '(none)'}`,
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { user, candidates };
}

export async function extractRecord(issue: KeyedIssue, vocab: Vocab): Promise<TicketRecord> {
  const { user } = buildPrompt(issue, vocab);
  const raw = await completeJson<RawRecord>(SYSTEM, user, SCHEMA);
  return normalise(issue.key, raw, vocab);
}

/** Enforce the vocabulary and the §5.2 shape regardless of what the model returned. */
export function normalise(key: string, raw: RawRecord, vocab: Vocab): TicketRecord {
  const comps = new Set(vocab.components);
  const bare = (s: string) => s.replace(/\(.*\)$/, '').replace(/^.*[./]/, '').trim();
  const uniq = <T>(xs: T[]) => [...new Set(xs)];

  const values: Record<string, string> = {};
  for (const { name, value } of raw.values_specified ?? []) {
    const n = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (n && value?.trim()) values[n] = value.trim();
  }

  return {
    key,
    components: uniq((raw.components ?? []).map((c) => c.trim().toLowerCase()).filter((c) => comps.has(c))).slice(0, 3),
    files_touched: [],
    behaviors_asserted: uniq((raw.behaviors_asserted ?? []).map((s) => s.trim()).filter(Boolean)).slice(0, 5),
    values_specified: values,
    removes: uniq((raw.removes ?? []).map(bare).filter((s) => vocab.symbols.has(s))),
    depends_on: uniq((raw.depends_on ?? []).map(normaliseRef).filter((d): d is string => d !== undefined)),
  };
}

/** "#123", "gh#123", "GH-123", an issue URL → the record key for that issue; "PROJ-5" as is; prose → dropped. */
function normaliseRef(ref: string): string | undefined {
  const s = ref.trim();
  const gh = /^(?:#|gh#|GH-|.*\/issues\/)(\d+)$/i.exec(s);
  if (gh?.[1]) return ghKey(Number(gh[1]));
  return /^[A-Z][A-Z0-9]+-\d+$/.test(s) ? s : undefined;
}
