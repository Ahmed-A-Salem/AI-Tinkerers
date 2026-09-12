/**
 * Phase G, layer 2 — a plain HTTP server so Agent 2 runs on Jira events with no Trigger.dev key.
 *
 *   npm run serve                       # listens on PORT (default 3123)
 *
 *   POST /trigger/<KEY>                 run Agent 2 on one ticket (propose); ?event=approved applies
 *   POST /webhook                       Jira webhook body → same call
 *   GET  /health                        liveness
 *
 * Webhook mapping: jira:issue_created → 'created'; jira:issue_updated → 'updated', or 'approved'
 * when the changelog adds label agent-approved. Updates whose only changes are labels (other than
 * agent-approved) or issue links are the agent's own write-back and are ignored, so the agent does
 * not wake itself. Comment events are ignored for the same reason.
 *
 * When TRIGGER_SECRET_KEY is set the work is handed to the Trigger.dev task instead of running
 * inline, so the same server is the webhook receiver in both layers.
 */
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runAgent2, type Agent2Event } from '../src/actions/run.js';
import { APPROVED_LABEL } from '../src/actions/index.js';

const PORT = Number(process.env.PORT ?? 3123);
const USE_TRIGGER = !!process.env.TRIGGER_SECRET_KEY;
const EVENTS: Agent2Event[] = ['created', 'updated', 'approved'];
const inflight = new Set<string>();

interface JiraWebhook {
  webhookEvent?: string;
  issue_event_type_name?: string;
  issue?: { key?: string; fields?: { labels?: string[] } };
  changelog?: { items?: { field?: string; fromString?: string | null; toString?: string | null }[] };
}

/** Jira body → { key, event } or a reason to ignore it. */
export function mapWebhook(body: JiraWebhook): { key: string; event: Agent2Event } | { ignore: string } {
  const key = body.issue?.key;
  if (!key) return { ignore: 'no issue key' };
  const kind = body.webhookEvent ?? body.issue_event_type_name ?? '';
  if (/comment/.test(kind)) return { ignore: `comment event ${kind}` };
  if (/issue_created/.test(kind)) return { key, event: 'created' };
  if (!/issue_updated|issue_generic/.test(kind)) return { ignore: `unhandled event ${kind}` };

  const items = body.changelog?.items ?? [];
  const labelChange = items.find((i) => i.field === 'labels');
  const labelsOf = (s: string | null | undefined) => (s ?? '').split(/\s+/).filter(Boolean);
  if (labelChange) {
    const before = labelsOf(labelChange.fromString);
    const after = labelsOf(labelChange.toString);
    if (after.includes(APPROVED_LABEL) && !before.includes(APPROVED_LABEL)) return { key, event: 'approved' };
  }
  // Only label / link changes and no approval: that is our own write-back echoing back.
  const agentOnly = items.length > 0 && items.every((i) => i.field === 'labels' || i.field === 'Link' || i.field === 'issuelinks');
  if (agentOnly) return { ignore: 'label/link-only update (agent write-back)' };
  return { key, event: 'updated' };
}

async function dispatch(key: string, event: Agent2Event) {
  if (USE_TRIGGER) {
    const { agent2 } = await import('../src/trigger/agent2.js');
    const handle = await agent2.trigger({ key, event });
    return { key, event, queued: true, runId: handle.id };
  }
  if (inflight.has(key)) throw Object.assign(new Error(`${key} already running`), { status: 409 });
  inflight.add(key);
  try {
    return await runAgent2({ key, event, log: (line) => console.log(`  ${line}`) });
  } finally {
    inflight.delete(key);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2) + '\n');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const t0 = Date.now();
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, trigger: USE_TRIGGER });

    if (req.method === 'POST' && url.pathname.startsWith('/trigger/')) {
      const key = decodeURIComponent(url.pathname.slice('/trigger/'.length));
      const ev = url.searchParams.get('event') ?? 'updated';
      if (!EVENTS.includes(ev as Agent2Event)) return send(res, 400, { error: `event must be one of ${EVENTS.join('|')}` });
      console.log(`POST /trigger/${key} event=${ev}`);
      const result = await dispatch(key, ev as Agent2Event);
      console.log(`  done in ${Date.now() - t0}ms`);
      return send(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/webhook') {
      const raw = await readBody(req);
      let body: JiraWebhook;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return send(res, 400, { error: 'body is not JSON' });
      }
      const mapped = mapWebhook(body);
      if ('ignore' in mapped) {
        console.log(`POST /webhook ignored: ${mapped.ignore}`);
        return send(res, 202, { ignored: mapped.ignore });
      }
      console.log(`POST /webhook ${mapped.key} event=${mapped.event}`);
      const result = await dispatch(mapped.key, mapped.event);
      console.log(`  done in ${Date.now() - t0}ms`);
      return send(res, 200, result);
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`  error ${status}: ${message}`);
    return send(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`agent2 server on http://localhost:${PORT} (${USE_TRIGGER ? 'hands off to Trigger.dev' : 'runs inline'})`);
  console.log(`  POST /trigger/<KEY>[?event=created|updated|approved]   POST /webhook   GET /health`);
});
