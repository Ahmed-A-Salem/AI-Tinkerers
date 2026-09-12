/**
 * Agent 1 — meeting transcript → draft tickets (brief §5.4).
 *
 * Extracts commitments (things a named person agreed to deliver), turns each into a draft
 * ticket with title / description / acceptance criteria, and creates it in Jira through
 * createDraftIssue(), which hardcodes the `agent-draft` label. Agent 1 never creates anything
 * else and never edits existing tickets. Creation fires the webhook that wakes Agent 2.
 */
import type { JiraClient, JiraIssue } from './jira/client.js';
import { completeJson, type JsonSchemaSpec } from './extract/llm.js';

export interface Commitment {
  owner: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  quote: string;
}

/**
 * The model classifies every statement of intent before anything becomes a ticket; only
 * `code_change` survives. Forcing the label makes "I'm on PR review until Thursday" and
 * "I might poke at X" land in the bins they belong to instead of becoming drafts.
 */
type Kind = 'code_change' | 'review_or_admin' | 'tentative' | 'already_done';
interface RawCommitment extends Commitment {
  kind: Kind;
}

const SCHEMA: JsonSchemaSpec = {
  name: 'commitments',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['commitments'],
    properties: {
      commitments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'owner', 'title', 'description', 'acceptance_criteria', 'quote'],
          properties: {
            kind: { type: 'string', enum: ['code_change', 'review_or_admin', 'tentative', 'already_done'] },
            owner: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            acceptance_criteria: { type: 'array', items: { type: 'string' } },
            quote: { type: 'string' },
          },
        },
      },
    },
  },
};

const SYSTEM = `You read a meeting transcript from a software team and list every statement of intent a named person made, classified by kind:
- code_change: a firm commitment to deliver a specific change to the codebase or its docs ("I'll ship X this sprint", "I'm adding Y today", "for this sprint I'll add Z").
- review_or_admin: reviewing PRs, writing release notes, meetings, planning, on-call, "nothing new to ship" — ongoing duties, not a deliverable change.
- tentative: might / maybe / if I have time / no promises.
- already_done: finished before this meeting ("yesterday I fixed…").

Only code_change items become tickets, but list the others too with their kind so nothing is silently dropped. Questions and suggestions aimed at someone else are not statements of intent; skip them.

One item per commitment, not per sentence: everything a speaker says about the same change in one turn (the code, its option, its default, the docs page for it) is ONE item. Only split when a speaker commits to two unrelated changes.

For each item produce a draft ticket:
- kind: one of the four labels above.
- owner: the speaker's name as written.
- title: imperative, under 80 characters, names the component and the change (e.g. "Add Retry-After header to timeout middleware").
- description: 2-4 sentences in the speaker's own terms. Name every function, module, file, option, header or default value the speaker mentioned, exactly as they said it. Do not add design details they did not state.
- acceptance_criteria: 2-4 short, checkable statements derived only from what was said.
- quote: the exact sentence(s) from the transcript containing the commitment.

Return an empty list if nobody committed to anything.`;

export interface Extraction {
  commitments: Commitment[];
  /** What the model saw but did not turn into a ticket, for the log. */
  skipped: { kind: Kind; owner: string; title: string }[];
}

export async function extractCommitments(transcript: string): Promise<Extraction> {
  const res = await completeJson<{ commitments: RawCommitment[] }>(SYSTEM, `Transcript:\n\n${transcript}`, SCHEMA);
  const items = (res.commitments ?? []).filter((c) => c.title?.trim() && c.quote?.trim());
  return {
    commitments: items.filter((c) => c.kind === 'code_change').map(({ kind: _kind, ...c }) => c),
    skipped: items.filter((c) => c.kind !== 'code_change').map((c) => ({ kind: c.kind, owner: c.owner, title: c.title })),
  };
}

/** The ticket body Agent 2 will read. Plain paragraphs; the Jira client converts to ADF. */
export function draftDescription(c: Commitment): string {
  const criteria = c.acceptance_criteria.map((a, i) => `${i + 1}. ${a}`).join('\n');
  return [
    c.description.trim(),
    `Acceptance criteria:\n${criteria}`,
    `Source: committed by ${c.owner} in stand-up — "${c.quote.trim()}"`,
    'Draft created by Agent 1 from the meeting transcript. Review before promoting to a real ticket.',
  ].join('\n\n');
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A commitment already has a draft when an existing agent-draft issue has the same title, or
 * its description carries the same verbatim quote from the transcript (titles drift a little
 * between model runs, the quote does not — it is copied from the transcript).
 */
export function findExistingDraft(c: Commitment, drafts: JiraIssue[]): JiraIssue | undefined {
  const title = norm(c.title);
  const quote = norm(c.quote).slice(0, 80);
  return drafts.find((d) => norm(d.summary) === title || (quote.length >= 20 && norm(d.description).includes(quote)));
}

export interface DraftResult {
  created: { key: string; title: string }[];
  skipped: { key: string; title: string }[];
}

/** Idempotent: the demo runs this more than once and must not pile up duplicate drafts. */
export async function createDrafts(commitments: Commitment[], jira: JiraClient, projectKey: string): Promise<DraftResult> {
  const existing = await jira.searchIssues(`project = ${projectKey} AND labels = agent-draft ORDER BY created DESC`, 100);
  const result: DraftResult = { created: [], skipped: [] };
  for (const c of commitments) {
    const dup = findExistingDraft(c, existing);
    if (dup) {
      result.skipped.push({ key: dup.key, title: c.title });
      continue;
    }
    const key = await jira.createDraftIssue(projectKey, c.title, draftDescription(c));
    result.created.push({ key, title: c.title });
  }
  return result;
}
