/**
 * Phase F — Accept mode (brief §5.5).
 *
 * Same actions in every mode; the mode only decides which ones wait. In Accept mode the
 * comment and the labels ARE the proposal, so they go out now. The link — the one action
 * that changes ticket structure — waits until a human adds `agent-approved`.
 *
 * Ather's Phase H extends this in src/modes/index.ts (auto + risk gate). Keep this file
 * to the accept rule only.
 */
import type { AgentAction, Mode } from '../types.js';
import { APPROVED_LABEL } from '../actions/index.js';

export interface Gated {
  now: AgentAction[];
  pending: AgentAction[];
}

export function isApproved(labels: string[]): boolean {
  return labels.includes(APPROVED_LABEL);
}

/** Accept rule: comments and labels now; links only once the ticket is approved. */
export function acceptGate(actions: AgentAction[], approved: boolean): Gated {
  const now: AgentAction[] = [];
  const pending: AgentAction[] = [];
  for (const a of actions) {
    if (a.kind === 'link' && !approved) pending.push(a);
    else now.push(a);
  }
  return { now, pending };
}

/** Mode switch. `auto` never waits (brief §5.5); anything else is Accept. */
export function gate(actions: AgentAction[], mode: Mode, approved: boolean): Gated {
  if (mode === 'auto') return { now: actions, pending: [] };
  return acceptGate(actions, approved);
}
