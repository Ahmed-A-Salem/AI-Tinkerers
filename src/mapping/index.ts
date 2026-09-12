/**
 * Phase C — ticket → code mapping (brief §5.2).
 *
 * The LLM sees the ticket text plus the full file tree and names ≤5 files. Its answer is
 * post-filtered to paths that exist in the index. Two deterministic additions:
 *   - paths the ticket spells out (e.g. a GitHub blob link) are always included, first;
 *   - a named symbol that lives in more than one file (data/symbol-collisions.json) pulls in
 *     every candidate file, because symbols.json only keeps one winner per name.
 *
 * API (Phase E calls these):
 *   mapTicketToFiles(ticket, index, record?) → Promise<string[]>
 *     ticket = { key, title, body } — the text the model reads (TicketRecord has none).
 *     index  = loadMappingIndex().
 *     record = optional TicketRecord; its `removes` entries count as named symbols.
 *     Always calls the LLM. No cache.
 *   getFilesForTicket(ticket, index, { record?, force? }) → Promise<string[]>
 *     Same result, cached in data/mapping/<KEY>.json as MappingCacheEntry. force re-runs the LLM.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { completeJson, getProvider } from '../extract/llm.js';
import type { SymbolEntry, SymbolIndex, TicketRecord } from '../types.js';

export interface MappingIndex {
  /** Every indexed source file (keys of imports.json). */
  files: string[];
  symbols: SymbolIndex;
  /** symbol-collisions.json: symbol name → every file that declares it. */
  collisions: Record<string, SymbolEntry[]>;
}

/** The ticket text the model reads. TicketRecord carries no title/body, so it rides along. */
export interface MappingTicket {
  key: string;
  title: string;
  body: string;
}

const MAX_LLM_FILES = 5;
const MAX_BODY_CHARS = 4000;

export function loadMappingIndex(dir = 'data'): MappingIndex {
  const read = (name: string) => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
  return {
    files: Object.keys(read('imports.json')),
    symbols: read('symbols.json'),
    collisions: read('symbol-collisions.json'),
  };
}

export function buildPrompt(ticket: MappingTicket, index: MappingIndex): { system: string; user: string } {
  const system =
    'You map issues filed against the hono web framework (github.com/honojs/hono) to the source files ' +
    'a fix or feature would change. Choose only from the file list you are given. Prefer the file that ' +
    'holds the implementation over an index.ts that only re-exports it. Return JSON ' +
    `{"files": ["src/..."]} with at most ${MAX_LLM_FILES} paths, most likely first. ` +
    'Return {"files": []} if the issue is not about hono source code (docs, CI, questions).';
  const body = ticket.body.length > MAX_BODY_CHARS ? `${ticket.body.slice(0, MAX_BODY_CHARS)}\n[truncated]` : ticket.body;
  const user = `File list:\n${index.files.join('\n')}\n\nIssue ${ticket.key}: ${ticket.title}\n\n${body}`;
  return { system, user };
}

/** Normalise model output ("./src/x", "target/hono/src/x", "src/x/index") onto indexed paths. */
export function filterToExisting(paths: unknown[], index: MappingIndex): string[] {
  const known = new Set(index.files);
  const out: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const p = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^.*?(?=src\/)/, '').replace(/#.*$/, '');
    const hit = [p, `${p}.ts`, `${p}.tsx`, `${p}/index.ts`].find((c) => known.has(c));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/**
 * Indexed paths linked from the ticket, e.g. github.com/honojs/hono/blob/<sha>/src/middleware/cors/index.ts#L113.
 * Bare paths don't count: "put this in src/index.ts" is the reporter's own app.
 */
export function mentionedPaths(text: string, index: MappingIndex): string[] {
  const linked = [...text.matchAll(/honojs\/hono\/(?:blob|tree)\/[^/\s]+\/(src\/[\w./-]+)/g)].map((m) => m[1] ?? '');
  return filterToExisting(linked, index);
}

/**
 * Symbols the ticket names that are declared in more than one file. A name counts as "named"
 * when it sits in inline `code`, is called in prose (`name(`), or is camelCase in prose.
 * Fenced code blocks are skipped: they are the reporter's app code (`new Hono()`, `c.json`),
 * and counting them would drag the four Hono files into nearly every ticket.
 */
export function namedCollisionSymbols(text: string, index: MappingIndex, extra: string[] = []): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, ' ');
  const inline = [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
  const names = new Set(extra.map((s) => s.replace(/\(\)$/, '')));
  for (const name of Object.keys(index.collisions)) {
    const word = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
    const camel = /[a-z][A-Z]/.test(name);
    if (
      inline.some((code) => word.test(code)) ||
      new RegExp(`(?<![\\w$.])${name}\\(`).test(prose) ||
      (camel && word.test(prose))
    ) {
      names.add(name);
    }
  }
  return [...names].filter((n) => index.collisions[n]);
}

export function collisionFiles(symbols: string[], index: MappingIndex): string[] {
  return [...new Set(symbols.flatMap((s) => (index.collisions[s] ?? []).map((e) => e.file)))];
}

const FILES_SCHEMA = {
  name: 'files_touched',
  schema: {
    type: 'object',
    properties: { files: { type: 'array', items: { type: 'string' } } },
    required: ['files'],
    additionalProperties: false,
  },
};

function askModel({ system, user }: { system: string; user: string }): Promise<{ files?: unknown[] }> {
  return completeJson<{ files?: unknown[] }>(system, user, FILES_SCHEMA);
}

export type FileSource = 'linked' | 'llm' | 'collision';

/** data/mapping/<KEY>.json */
export interface MappingCacheEntry {
  key: string;
  files: string[];
  /** Why each file is in `files`; the first rule that produced it wins (linked > llm > collision). */
  source: Record<string, FileSource>;
  model: string;
}

const CACHE_DIR = 'data/mapping';

async function mapTicket(
  ticket: MappingTicket,
  index: MappingIndex,
  record?: Pick<TicketRecord, 'removes'>,
): Promise<MappingCacheEntry> {
  const text = `${ticket.title}\n${ticket.body}`;
  const answer = await askModel(buildPrompt(ticket, index));
  const source: Record<string, FileSource> = {};
  const add = (files: string[], from: FileSource) => files.forEach((f) => (source[f] ??= from));
  add(mentionedPaths(text, index), 'linked');
  add(filterToExisting(Array.isArray(answer.files) ? answer.files : [], index).slice(0, MAX_LLM_FILES), 'llm');
  add(collisionFiles(namedCollisionSymbols(text, index, record?.removes), index), 'collision');
  const { name, model } = getProvider();
  return { key: ticket.key, files: Object.keys(source), source, model: `${name}:${model}` };
}

/** Predict the files a ticket touches. Always calls the LLM; see getFilesForTicket for the cached path. */
export async function mapTicketToFiles(
  ticket: MappingTicket,
  index: MappingIndex,
  record?: Pick<TicketRecord, 'removes'>,
): Promise<string[]> {
  return (await mapTicket(ticket, index, record)).files;
}

export function cachePath(key: string): string {
  return `${CACHE_DIR}/${key.replace(/[^\w.-]/g, '_')}.json`;
}

export function readMappingCache(key: string): MappingCacheEntry | null {
  const path = cachePath(key);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as MappingCacheEntry) : null;
}

/** Cached mapping for one ticket: reads data/mapping/<KEY>.json, or runs the LLM and writes it. */
export async function getMappingForTicket(
  ticket: MappingTicket,
  index: MappingIndex,
  opts: { record?: Pick<TicketRecord, 'removes'>; force?: boolean } = {},
): Promise<MappingCacheEntry & { cached: boolean }> {
  const hit = opts.force ? null : readMappingCache(ticket.key);
  if (hit) return { ...hit, cached: true };
  const entry = await mapTicket(ticket, index, opts.record);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(ticket.key), JSON.stringify(entry, null, 2));
  return { ...entry, cached: false };
}

export async function getFilesForTicket(
  ticket: MappingTicket,
  index: MappingIndex,
  opts: { record?: Pick<TicketRecord, 'removes'>; force?: boolean } = {},
): Promise<string[]> {
  return (await getMappingForTicket(ticket, index, opts)).files;
}
