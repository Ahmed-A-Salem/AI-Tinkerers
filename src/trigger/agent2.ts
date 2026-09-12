/**
 * Phase G, layer 1 — Agent 2 as a Trigger.dev v3 task.
 *
 * Payload { key, event }: a Jira webhook (or scripts/serve.ts, or a manual trigger) hands the
 * ticket key and what happened to it; the task runs the same check → propose → gate → apply
 * path as `npm run act`. Nothing here needs TRIGGER_SECRET_KEY to typecheck; the key is only
 * needed to actually run `npx trigger.dev dev`.
 */
import { task, logger } from '@trigger.dev/sdk/v3';
import { runAgent2, type Agent2Event, type RunResult } from '../actions/run.js';

export interface Agent2Payload {
  key: string;
  event: Agent2Event;
}

export const agent2 = task({
  id: 'agent2-check',
  retry: { maxAttempts: 2 },
  run: async (payload: Agent2Payload): Promise<RunResult> => {
    logger.log(`agent2 ${payload.event} ${payload.key}`);
    return runAgent2({ ...payload, log: (line) => logger.log(line) });
  },
});
