/**
 * t0 — import the target repo's GitHub issues into a fresh Jira project.
 *
 *   gh issue list --repo honojs/hono --state open --limit 200 \
 *     --json number,title,body,labels,createdAt,url > data/hono-issues.json
 *   npx tsx scripts/import-issues.ts            # dry run, prints what it would create
 *   npx tsx scripts/import-issues.ts --go       # actually creates them
 *
 * Bulk create goes over the Jira REST API rather than the Atlassian MCP: 200 issues is a
 * one-shot data load, not agent behaviour. The MCP path is what src/jira/ uses at runtime
 * for the actions the agent is allowed to take (comment / link / label).
 *
 * Env: JIRA_BASE_URL (https://<site>.atlassian.net), JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  createdAt: string;
  url: string;
}

const SRC = process.argv.find((a) => a.startsWith('--src='))?.slice(6) ?? 'data/hono-issues.json';
const GO = process.argv.includes('--go');
const BATCH = 50; // Jira's bulk-create ceiling

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} — see header comment`);
  return v;
}

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

function toIssueUpdate(issue: GhIssue, projectKey: string) {
  const body = `${issue.body ?? ''}\n\nImported from ${issue.url} (gh#${issue.number}, opened ${issue.createdAt.slice(0, 10)})`;
  return {
    fields: {
      project: { key: projectKey },
      issuetype: { name: 'Task' },
      summary: `[gh#${issue.number}] ${issue.title}`.slice(0, 254),
      description: adf(body),
      labels: ['imported', ...issue.labels.map((l) => jiraLabel(l.name))].slice(0, 10),
    },
  };
}

async function main() {
  const issues: GhIssue[] = JSON.parse(readFileSync(SRC, 'utf8'));
  console.log(`${issues.length} issues from ${SRC}`);

  const first = issues[0];
  if (!first) throw new Error(`no issues in ${SRC}`);

  if (!GO) {
    const sample = toIssueUpdate(first, process.env.JIRA_PROJECT_KEY ?? 'PROJ');
    console.log('dry run — first payload:\n', JSON.stringify(sample, null, 2).slice(0, 900));
    console.log(`\nwould create ${issues.length} issues in ${Math.ceil(issues.length / BATCH)} batches. re-run with --go`);
    return;
  }

  const base = env('JIRA_BASE_URL').replace(/\/$/, '');
  const projectKey = env('JIRA_PROJECT_KEY');
  const auth = Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64');

  const created: { key: string; gh: number }[] = [];
  for (let i = 0; i < issues.length; i += BATCH) {
    const slice = issues.slice(i, i + BATCH);
    const res = await fetch(`${base}/rest/api/3/issue/bulk`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueUpdates: slice.map((s) => toIssueUpdate(s, projectKey)) }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`bulk create failed (${res.status}): ${JSON.stringify(json).slice(0, 500)}`);
    (json.issues ?? []).forEach((iss: any, n: number) => {
      const src = slice[n];
      if (src) created.push({ key: iss.key, gh: src.number });
    });
    if (json.errors?.length) console.warn(`batch ${i / BATCH}: ${json.errors.length} rejected`);
    console.log(`batch ${i / BATCH + 1}: ${json.issues?.length ?? 0} created`);
  }

  // The mapping is how planted.json and the ground truth stay pinned to real issues.
  writeFileSync('data/gh-to-jira.json', JSON.stringify(created, null, 2));
  console.log(`done — ${created.length} issues, mapping in data/gh-to-jira.json`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
