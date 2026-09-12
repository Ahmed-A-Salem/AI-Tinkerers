/**
 * Shared contracts. Shapes come straight from docs/BRIEF.md §5.1–5.3.
 * Nobody changes these shapes without telling the orchestrator.
 */

/** Brief §5.2 — a ticket reduced to the facts the comparison step reasons over. */
export interface TicketRecord {
  key: string;
  components: string[];
  files_touched: string[];
  behaviors_asserted: string[];
  values_specified: Record<string, string>;
  removes: string[];
  depends_on: string[];
}

/** Brief §5.3 — the two demo types; the last two are stretch (brief §5.3). */
export type ConflictType =
  | 'dependency_break'
  | 'ordering'
  | 'value_conflict'
  | 'duplicate_work';

export interface ConflictEvidence {
  ticket_a_line: string;
  ticket_b_line: string;
  /** e.g. "src/auth/session.ts → refreshToken()" */
  code_path: string;
}

export interface ConflictVerdict {
  pair: [string, string];
  type: ConflictType;
  confidence: number;
  evidence: ConflictEvidence;
}

/** Brief §5.1 — code index outputs. */
export interface SymbolEntry {
  file: string;
  exported: boolean;
}
/** symbols.json: symbol name → where it lives. */
export type SymbolIndex = Record<string, SymbolEntry>;
/** imports.json: file → files it imports. */
export type ImportGraph = Record<string, string[]>;

/** Agent 2 may only comment, link and label (brief §5.5). */
export type AgentAction =
  | { kind: 'comment'; issueKey: string; body: string }
  | { kind: 'link'; inward: string; outward: string; linkType: string }
  | { kind: 'label'; issueKey: string; label: string };

export type Mode = 'accept' | 'auto';
