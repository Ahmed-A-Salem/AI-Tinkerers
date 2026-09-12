/**
 * Phase F — verdicts in, Jira actions out.
 *
 * `propose()` is pure: it turns ConflictVerdict[] into the AgentAction[] the agent *wants*
 * to take. `apply()` performs them through JiraClient. The union in src/types.ts has only
 * comment / link / label, so nothing meaning-changing can be proposed or applied here,
 * whatever the mode (brief §5.5).
 *
 * Jira comments and labels are the UI, so the comment text is written for a human reading
 * the ticket, not for a log.
 */
import type { AgentAction, ConflictVerdict, ConflictType } from '../types.js';
import type { JiraClient } from '../jira/index.js';

/** Tag on every proposal comment (brief §5.5). */
export const PROPOSED_TAG = 'agent-proposed';
/** Tag on the comment posted after a pending action is applied. */
export const APPLIED_TAG = 'agent-applied';
/** Label the agent adds to a ticket that has at least one verdict. */
export const CONFLICT_LABEL = 'agent-conflict';
/** Label a human adds to let pending actions through in Accept mode. */
export const APPROVED_LABEL = 'agent-approved';

const TYPE_TITLE: Record<ConflictType, string> = {
  dependency_break: 'Possible dependency break',
  ordering: 'Ordering conflict',
  value_conflict: 'Value conflict',
  duplicate_work: 'Possible duplicate work',
};

export type LinkAction = Extract<AgentAction, { kind: 'link' }>;

/**
 * Jira link semantics: for "Blocks", the OUTWARD issue blocks the INWARD one.
 * ordering         — B is only correct once A ships, so A blocks B.
 * dependency_break — A relies on something B removes; a plain relation, not an order.
 */
export function linkFor(v: ConflictVerdict): LinkAction {
  const [a, b] = v.pair;
  if (v.type === 'ordering') return { kind: 'link', inward: b, outward: a, linkType: 'Blocks' };
  return { kind: 'link', inward: a, outward: b, linkType: 'Relates' };
}

/** The ticket in the pair that is not the one being checked. */
export function otherOf(v: ConflictVerdict, key: string): string {
  return v.pair[0] === key ? v.pair[1] : v.pair[0];
}

function quote(s: string): string {
  return `"${(s ?? '').trim().replace(/\s+/g, ' ')}"`;
}

/** One proposal comment per verdict: both quoted lines, the code path, the action it wants. */
export function proposalComment(v: ConflictVerdict, key: string): string {
  const other = otherOf(v, key);
  const link = linkFor(v);
  const pct = Math.round(v.confidence * 100);
  const arrow =
    link.linkType === 'Blocks' ? `${link.outward} blocks ${link.inward}` : `${link.inward} <-> ${link.outward}`;
  return [
    `[${PROPOSED_TAG}] ${TYPE_TITLE[v.type]} with ${other} (confidence ${pct}%)`,
    `${v.pair[0]} says: ${quote(v.evidence.ticket_a_line)}`,
    `${v.pair[1]} says: ${quote(v.evidence.ticket_b_line)}`,
    `Code path: ${v.evidence.code_path}`,
    `Recommended order: ${recommendedOrder(v)}`,
    `Proposed action: link ${arrow} (${link.linkType}). To approve, add the label ${APPROVED_LABEL} to this ticket; the agent will then link the pair. -- Backlog Conflict Agent`,
  ].join('\n\n');
}

/** Symbol name from a code path like "src/utils/url.ts -> getPath()" (either arrow style). */
function symbolOf(codePath: string): string {
  const tail = codePath.split(/->|→/).pop() ?? codePath;
  return tail.trim().replace(/\(\)$/, '') || 'the shared symbol';
}

/**
 * A human-readable ordering suggestion inside the comment. Advice only: the agent's actions
 * stay comment / label / link, and the humans decide.
 */
export function recommendedOrder(v: ConflictVerdict): string {
  const [a, b] = v.pair;
  if (v.type === 'ordering') return `${a} first, then ${b} (${b} assumes ${a} has shipped).`;
  const sym = symbolOf(v.evidence.code_path);
  return `land ${a} before ${b}, or keep ${sym} available until ${a} has migrated off it; if ${b} must go first, add the replacement to ${a} before merging.`;
}

export function noConflictComment(candidates: number | undefined): string {
  const n =
    candidates === undefined ? 'related tickets' : `${candidates} related ticket${candidates === 1 ? '' : 's'}`;
  return `Checked against ${n}, no conflicts found. -- Backlog Conflict Agent`;
}

/**
 * verdicts → actions for ticket `key`.
 * Comment + conflict label go on the checked ticket; the other side of each pair is
 * labelled too so the backlog view shows every ticket involved. The link is the only
 * action that changes anything structural, which is why Accept mode holds it back.
 */
export function propose(key: string, verdicts: ConflictVerdict[], candidates?: number): AgentAction[] {
  if (verdicts.length === 0) {
    return [{ kind: 'comment', issueKey: key, body: noConflictComment(candidates) }];
  }
  const actions: AgentAction[] = [];
  for (const v of verdicts) {
    actions.push({ kind: 'comment', issueKey: key, body: proposalComment(v, key) });
    actions.push({ kind: 'label', issueKey: key, label: CONFLICT_LABEL });
    actions.push({ kind: 'label', issueKey: otherOf(v, key), label: CONFLICT_LABEL });
    actions.push(linkFor(v));
  }
  return actions;
}

export function describe(a: AgentAction): string {
  switch (a.kind) {
    case 'comment':
      return `comment on ${a.issueKey}: ${(a.body.split('\n')[0] ?? '').slice(0, 90)}`;
    case 'label':
      return `label ${a.issueKey} += ${a.label}`;
    case 'link':
      return `link ${a.outward} -[${a.linkType}]-> ${a.inward}`;
  }
}

export interface ApplyResult {
  action: AgentAction;
  ok: boolean;
  error?: string;
}

/**
 * Perform actions in order. A failure is recorded and does not stop the rest, so one bad
 * link (e.g. a link type the site lacks) never swallows the comment that explains it.
 * "Blocks" falls back to "Relates" when the site has no such link type.
 */
export async function apply(actions: AgentAction[], jira: JiraClient): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const action of actions) {
    try {
      switch (action.kind) {
        case 'comment':
          await jira.addComment(action.issueKey, action.body);
          break;
        case 'label':
          await jira.addLabel(action.issueKey, action.label);
          break;
        case 'link':
          try {
            await jira.linkIssues(action.inward, action.outward, action.linkType);
          } catch (e) {
            if (action.linkType !== 'Relates' && /link type|400/i.test(String(e))) {
              await jira.linkIssues(action.inward, action.outward, 'Relates');
            } else throw e;
          }
          break;
      }
      out.push({ action, ok: true });
    } catch (e) {
      out.push({ action, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
