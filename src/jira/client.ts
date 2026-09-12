/**
 * One interface, two credentials.
 *
 * Jira is the environment (brief §4) but two different credentials can reach it, and at
 * build time we did not know which one would arrive first:
 *   - REST + API token  — a two-minute action for the site admin
 *   - Atlassian MCP + OAuth — the brief's preferred path, slower to authorise
 *
 * Everything above this file is written against `JiraClient` and does not care which one
 * is live. Swapping credentials is one env var, not a rewrite.
 *
 * The allowed action surface is deliberately narrow: Agent 2 may comment, link and label,
 * and nothing else (brief §5.5). There is no updateDescription() here on purpose — the
 * guarantee is enforced by the interface, not by remembering not to call it.
 */
import type { TicketRecord } from '../types.js';

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  labels: string[];
  status: string;
  url: string;
}

export interface JiraClient {
  /** Cheap call that proves the credential works. Used by the t1 smoke test. */
  whoAmI(): Promise<string>;
  getIssue(key: string): Promise<JiraIssue>;
  searchIssues(jql: string, max?: number): Promise<JiraIssue[]>;
  addComment(key: string, body: string): Promise<void>;
  addLabel(key: string, label: string): Promise<void>;
  linkIssues(inwardKey: string, outwardKey: string, linkType?: string): Promise<void>;
  /** Agent 1 only, and only ever under the agent-draft label (brief §5.4). */
  createDraftIssue(projectKey: string, summary: string, description: string): Promise<string>;
  readonly backend: 'rest' | 'mcp';
}

/** Tickets carry their key; records are keyed the same way so the two sides line up. */
export type RecordsByKey = Record<string, TicketRecord>;
