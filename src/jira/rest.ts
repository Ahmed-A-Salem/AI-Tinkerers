/**
 * REST backend — basic auth with an Atlassian API token.
 * Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 */
import type { JiraClient, JiraIssue } from './client.js';
import { toAdf, fromAdf } from './adf.js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export class JiraRestClient implements JiraClient {
  readonly backend = 'rest' as const;
  private base: string;
  private auth: string;

  constructor() {
    this.base = env('JIRA_BASE_URL').replace(/\/$/, '');
    this.auth = Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64');
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`jira ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private toIssue = (raw: any): JiraIssue => ({
    key: raw.key,
    summary: raw.fields?.summary ?? '',
    description: fromAdf(raw.fields?.description).trim(),
    labels: raw.fields?.labels ?? [],
    status: raw.fields?.status?.name ?? 'unknown',
    url: `${this.base}/browse/${raw.key}`,
  });

  async whoAmI(): Promise<string> {
    const me = await this.call<{ displayName: string; emailAddress?: string }>('/rest/api/3/myself');
    return `${me.displayName}${me.emailAddress ? ` <${me.emailAddress}>` : ''} (rest)`;
  }

  async getIssue(key: string): Promise<JiraIssue> {
    return this.toIssue(await this.call(`/rest/api/3/issue/${key}?fields=summary,description,labels,status`));
  }

  async searchIssues(jql: string, max = 100): Promise<JiraIssue[]> {
    const body = JSON.stringify({ jql, maxResults: max, fields: ['summary', 'description', 'labels', 'status'] });
    const res = await this.call<{ issues: any[] }>('/rest/api/3/search/jql', { method: 'POST', body });
    return (res.issues ?? []).map(this.toIssue);
  }

  async addComment(key: string, body: string): Promise<void> {
    await this.call(`/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body: toAdf(body) }),
    });
  }

  async addLabel(key: string, label: string): Promise<void> {
    // update-with-add, so we never clobber labels somebody else set.
    await this.call(`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ update: { labels: [{ add: label }] } }),
    });
  }

  async linkIssues(inwardKey: string, outwardKey: string, linkType = 'Relates'): Promise<void> {
    await this.call('/rest/api/3/issueLink', {
      method: 'POST',
      body: JSON.stringify({
        type: { name: linkType },
        inwardIssue: { key: inwardKey },
        outwardIssue: { key: outwardKey },
      }),
    });
  }

  async createDraftIssue(projectKey: string, summary: string, description: string): Promise<string> {
    const res = await this.call<{ key: string }>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: summary.slice(0, 254),
          description: toAdf(description),
          labels: ['agent-draft'], // brief §5.4 — drafts are never plain tickets
        },
      }),
    });
    return res.key;
  }
}
