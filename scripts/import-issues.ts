/**
 * t0 / A4 — import the target repo's GitHub issues into a fresh Jira project.
 *
 *   gh issue list --repo honojs/hono --state open --limit 200 \
 *     --json number,title,body,labels,createdAt,url > data/hono-issues.json
 *   npx tsx scripts/import-issues.ts            # dry run, prints what it would create
 *   npx tsx scripts/import-issues.ts --go       # actually creates them
 *
 * Re-runnable: entries already in data/gh-to-jira.json, or already present in Jira (label
 * `imported`, summary prefixed `[gh#N]` / `[PLANT-n]`), are skipped and the mapping is merged,
 * not overwritten. So when Phase D appends PLANT-1..6 to data/hono-issues.json, re-running
 * with --go creates only those six.
 *
 * Bulk create goes over the Jira REST API rather than the Atlassian MCP: 200 issues is a
 * one-shot data load, not agent behaviour. The MCP path is what src/jira/ uses at runtime
 * for the actions the agent is allowed to take (comment / link / label).
 *
 * Env: JIRA_BASE_URL (https://<site>.atlassian.net), JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** gh issue list output, plus Phase D's planted tickets which carry `key` instead of `number`. */
interface SourceIssue {
  key?: string;
  number?: number;
  title: string;
  body: string | null;
  labels?: { name: string }[] | string[];
  createdAt?: string;
  url?: string;
}

/** One row per created Jira issue. `gh` for GitHub-sourced, `src` for planted (PLANT-n). */
interface MappingRow {
  key: string;
  gh?: number;
  src?: string;
}

const SRC = process.argv.find((a) => a.startsWith('--src='))?.slice(6) ?? 'data/hono-issues.json';
const MAPPING = 'data/gh-to-jira.json';
const GO = process.argv.includes('--go');
const BATCH = 50; // Jira's bulk-create ceiling

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} — see header comment`);
  return v;
}

/** Stable identity of a source issue across runs: "gh#5364" or "PLANT-1". */
const sourceId = (i: SourceIssue): string => {
  if (i.key) return i.key;
  if (i.number !== undefined) return `gh#${i.number}`;
  throw new Error(`issue has neither key nor number: ${i.title}`);
};
const rowId = (r: MappingRow): string => r.src ?? `gh#${r.gh}`;

/** Jira v3 descriptions are ADF, not markdown. Paragraphs are enough for imported bodies. */
function adf(text: string) {
  const paras = (text || '_no description_')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 40);
  return {
    type: 'doc',
    version: 1,
    content: paras.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p.slice(0, 3000) }],
    })),
  };
}

/** Jira labels allow no spaces. */
const jiraLabel = (s: string) => s.replace(/[^\w.-]+/g, '-').slice(0, 60);
const labelNames = (i: SourceIssue) => (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

function toIssueUpdate(issue: SourceIssue, projectKey: string) {
  const origin = issue.url
    ? `Imported from ${issue.url} (${sourceId(issue)}${issue.createdAt ? `, opened ${issue.createdAt.slice(0, 10)}` : ''})`
    : `Source: ${sourceId(issue)}`;
  return {
    fields: {
      project: { key: projectKey },
      issuetype: { name: 'Task' },
      summary: `[${sourceId(issue)}] ${issue.title}`.slice(0, 254),
      description: adf(`${issue.body ?? ''}\n\n${origin}`),
      labels: ['imported', ...labelNames(issue).map(jiraLabel)].slice(0, 10),
    },
  };
}

function loadMapping(): MappingRow[] {
  return existsSync(MAPPING) ? (JSON.parse(readFileSync(MAPPING, 'utf8')) as MappingRow[]) : [];
}

/** What is already in Jira, keyed by source id, in case the mapping file is missing or stale. */
async function existingInJira(base: string, auth: string, projectKey: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let nextPageToken: string | undefined;
  do {
    const res = await fetch(`${base}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jql: `project = ${projectKey} AND labels = imported ORDER BY created ASC`,
        fields: ['summary'],
        maxResults: 100,
        nextPageToken,
      }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`search failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
    for (const iss of json.issues ?? []) {
      const m = /^\[([^\]]+)\]/.exec(iss.fields?.summary ?? '');
      if (m?.[1]) found.set(m[1], iss.key);
    }
    nextPageToken = json.nextPageToken;
  } while (nextPageToken);
  return found;
}

async function main() {
  const issues: SourceIssue[] = JSON.parse(readFileSync(SRC, 'utf8'));
  console.log(`${issues.length} issues from ${SRC}`);
  if (!issues.length) throw new Error(`no issues in ${SRC}`);

  const mapping = loadMapping();
  const known = new Map(mapping.map((r) => [rowId(r), r.key]));
  console.log(`${mapping.length} already mapped in ${MAPPING}`);

  if (!GO) {
    const todo = issues.filter((i) => !known.has(sourceId(i)));
    const first = todo[0] ?? issues[0]!;
    const sample = toIssueUpdate(first, process.env.JIRA_PROJECT_KEY ?? 'PROJ');
    console.log('dry run — first payload:\n', JSON.stringify(sample, null, 2).slice(0, 900));
    console.log(
      `\nwould create ${todo.length} issues in ${Math.ceil(todo.length / BATCH)} batches ` +
        `(${issues.length - todo.length} skipped as already mapped). re-run with --go`,
    );
    return;
  }

  const base = env('JIRA_BASE_URL').replace(/\/$/, '');
  const projectKey = env('JIRA_PROJECT_KEY');
  const auth = Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64');

  // Belt and braces: anything Jira already has that the mapping file lacks gets recorded, not re-created.
  const inJira = await existingInJira(base, auth, projectKey);
  let recovered = 0;
  for (const [src, key] of inJira) {
    if (known.has(src)) continue;
    const gh = /^gh#(\d+)$/.exec(src);
    mapping.push(gh ? { key, gh: Number(gh[1]) } : { key, src });
    known.set(src, key);
    recovered++;
  }
  if (recovered) console.log(`${recovered} issue(s) found in Jira but not in the mapping — recorded`);

  const todo = issues.filter((i) => !known.has(sourceId(i)));
  console.log(`${issues.length - todo.length} skipped (already in Jira), ${todo.length} to create`);

  let createdCount = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    const res = await fetch(`${base}/rest/api/3/issue/bulk`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueUpdates: slice.map((s) => toIssueUpdate(s, projectKey)) }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`bulk create failed (${res.status}): ${JSON.stringify(json).slice(0, 500)}`);

    // Jira returns created issues in input order minus the rejected ones (errors carry the input index).
    const failedIdx = new Set<number>((json.errors ?? []).map((e: any) => e.failedElementNumber));
    const survivors = slice.filter((_, n) => !failedIdx.has(n));
    (json.issues ?? []).forEach((iss: any, n: number) => {
      const src = survivors[n];
      if (!src) return;
      const id = sourceId(src);
      mapping.push(src.number !== undefined && !src.key ? { key: iss.key, gh: src.number } : { key: iss.key, src: id });
      known.set(id, iss.key);
      createdCount++;
    });
    if (failedIdx.size) console.warn(`batch ${i / BATCH + 1}: ${failedIdx.size} rejected: ${JSON.stringify(json.errors).slice(0, 300)}`);
    console.log(`batch ${i / BATCH + 1}: ${json.issues?.length ?? 0} created`);
    // Persist after every batch so a mid-run failure never loses what Jira already accepted.
    writeFileSync(MAPPING, JSON.stringify(mapping, null, 2) + '\n');
  }

  // The mapping is how planted.json and the ground truth stay pinned to real issues.
  writeFileSync(MAPPING, JSON.stringify(mapping, null, 2) + '\n');
  console.log(`done — ${createdCount} created this run, ${mapping.length} total mapped in ${MAPPING}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
