/**
 * Phase H — mode gate (brief §5.5).
 *
 * Same actions in every mode; the mode only decides which ones wait.
 *   accept  comment + labels now; links wait for `agent-approved` (src/modes/accept.ts)
 *   auto    everything now
 *   risk    comment + labels now; a link goes now only when the verdict is confident enough
 *
 * The AgentAction union has no edit kind, so nothing meaning-changing can pass any gate.
 * Confidence belongs to one verdict, so gate the actions of one verdict at a time.
 */
import type { AgentAction, Mode } from '../types.js';
import { acceptGate, isApproved, type Gated } from './accept.js';

export { isApproved, type Gated };

/** Mode from src/types.ts plus the risk gate, which lives only here. */
export type GateMode = Mode | 'risk';

/** Links at or above this confidence skip approval in risk mode. */
export const RISK_LINK_CONFIDENCE = 0.9;

export function parseMode(raw: string | undefined): GateMode {
  if (raw === 'auto' || raw === 'risk') return raw;
  return 'accept';
}

/** Risk rule: comments and labels now; a link now only at confidence ≥ 0.9, else pending. */
export function riskGate(actions: AgentAction[], confidence: number): Gated {
  const now: AgentAction[] = [];
  const pending: AgentAction[] = [];
  for (const a of actions) {
    if (a.kind === 'link' && !(confidence >= RISK_LINK_CONFIDENCE)) pending.push(a);
    else now.push(a);
  }
  return { now, pending };
}

export function gate(actions: AgentAction[], mode: GateMode, approved: boolean, confidence: number): Gated {
  switch (mode) {
    case 'auto':
      return { now: actions, pending: [] };
    case 'risk':
      return riskGate(actions, confidence);
    default:
      return acceptGate(actions, approved);
  }
}
