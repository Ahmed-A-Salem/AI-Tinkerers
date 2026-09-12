/**
 * MCP backend — the brief's preferred path (§4): Atlassian's remote MCP server at
 * https://mcp.atlassian.com/v1/mcp, reached with an OAuth access token.
 *
 * Two things worth knowing before you edit this file:
 *
 * 1. Tool names are resolved at runtime, not hardcoded. We call `tools/list` on connect and
 *    match each intent (comment / label / link / search / get) against the names the server
 *    actually advertises. Atlassian renames these between revisions and we could not verify
 *    them offline; a rename costs us a log line instead of a dead demo.
 * 2. Streamable HTTP means a JSON-RPC POST can come back as either JSON or an SSE stream,
 *    so `rpc()` handles both.
 *
 * Env: JIRA_MCP_URL (default https://mcp.atlassian.com/v1/mcp), JIRA_MCP_TOKEN, JIRA_CLOUD_ID
 */
import type { JiraClient, JiraIssue } from './client.js';

type Intent = 'get' | 'search' | 'comment' | 'label' | 'link' | 'create';

/** Ordered preferences; first advertised tool whose name contains all words of a phrase wins. */
const INTENT_HINTS: Record<Intent, string[][]> = {
  get: [['get', 'jira', 'issue'], ['jira', 'issue', 'read'], ['get', 'issue']],
  search: [['search', 'jira', 'jql'], ['jira', 'search'], ['search', 'issues']],
  comment: [['add', 'comment', 'jira'], ['comment', 'issue'], ['create', 'comment']],
  label: [['edit', 'jira', 'issue'], ['update', 'issue'], ['edit', 'issue']],
  link: [['link', 'jira', 'issue'], ['create', 'issue', 'link'], ['link', 'issues']],
  create: [['create', 'jira', 'issue'], ['create', 'issue']],
};

export class JiraMcpClient implements JiraClient {
  readonly backend = 'mcp' as const;
  private url: string;
  private token: string;
  private sessionId?: string;
  private tools = new Map<Intent, string>();
  private nextId = 1;

  constructor() {
    this.url = process.env.JIRA_MCP_URL ?? 'https://mcp.atlassian.com/v1/mcp';
    const token = process.env.JIRA_MCP_TOKEN;
    if (!token) throw new Error('missing env JIRA_MCP_TOKEN (OAuth access token for the Atlassian MCP server)');
    this.token = token;
  }

  private async rpc(method: string, params?: unknown): Promise<any> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok) throw new Error(`mcp ${method} → ${res.status}: ${text.slice(0, 400)}`);

    // Streamable HTTP: either a bare JSON body or an SSE stream of `data:` lines.
    const payload = text.includes('data:')
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean).pop()
      : text;
    const json = JSON.parse(payload || '{}');
    if (json.error) throw new Error(`mcp ${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
    return json.result;
  }

  /** initialize + tools/list, then bind each intent to a real advertised tool name. */
  async connect(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'backlog-conflict-agents', version: '0.1.0' },
    });
    const { tools = [] } = (await this.rpc('tools/list')) ?? {};
    const names: string[] = tools.map((t: { name: string }) => t.name);
    for (const [intent, phrases] of Object.entries(INTENT_HINTS) as [Intent, string[][]][]) {
      const hit = phrases
        .map((words) => names.find((n) => words.every((w) => n.toLowerCase().includes(w))))
        .find(Boolean);
      if (hit) this.tools.set(intent, hit);
    }
    const missing = (Object.keys(INTENT_HINTS) as Intent[]).filter((i) => !this.tools.has(i));
    console.error(`[jira/mcp] ${names.length} tools advertised; bound ${this.tools.size}` +
      (missing.length ? `; unresolved: ${missing.join(', ')} — advertised names: ${names.join(', ')}` : ''));
  }

  private async callTool(intent: Intent, args: Record<string, unknown>): Promise<any> {
    const name = this.tools.get(intent);
    if (!name) throw new Error(`[jira/mcp] no advertised tool matched intent "${intent}" — run connect() and check the log for real names`);
    const cloudId = process.env.JIRA_CLOUD_ID;
    const result = await this.rpc('tools/call', {
      name,
      arguments: { ...(cloudId ? { cloudId } : {}), ...args },
    });
    if (result?.isError) throw new Error(`[jira/mcp] ${name} failed: ${JSON.stringify(result.content).slice(0, 300)}`);
    const text = (result?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    try {
      return JSON.parse(text);
    } catch {
      return text; // some tools answer in prose; callers that need structure ask for JSON
    }
  }

  private toIssue = (raw: any): JiraIssue => ({
    key: raw.key ?? raw.issueKey ?? '',
    summary: raw.summary ?? raw.fields?.summary ?? '',
    description: typeof raw.description === 'string' ? raw.description : (raw.fields?.description ?? ''),
    labels: raw.labels ?? raw.fields?.labels ?? [],
    status: raw.status?.name ?? raw.fields?.status?.name ?? 'unknown',
    url: raw.url ?? raw.self ?? '',
  });

  async whoAmI(): Promise<string> {
    if (!this.sessionId) await this.connect();
    return `mcp session ${this.sessionId ?? 'n/a'}, ${this.tools.size} intents bound (mcp)`;
  }

  async getIssue(key: string): Promise<JiraIssue> {
    return this.toIssue(await this.callTool('get', { issueIdOrKey: key }));
  }

  async searchIssues(jql: string, max = 100): Promise<JiraIssue[]> {
    const res = await this.callTool('search', { jql, maxResults: max });
    const issues = Array.isArray(res) ? res : (res?.issues ?? []);
    return issues.map(this.toIssue);
  }

  async addComment(key: string, body: string): Promise<void> {
    await this.callTool('comment', { issueIdOrKey: key, commentBody: body, body });
  }

  async addLabel(key: string, label: string): Promise<void> {
    await this.callTool('label', { issueIdOrKey: key, fields: { labels: [{ add: label }] } });
  }

  async linkIssues(inwardKey: string, outwardKey: string, linkType = 'Relates'): Promise<void> {
    await this.callTool('link', { inwardIssueKey: inwardKey, outwardIssueKey: outwardKey, linkType });
  }

  async createDraftIssue(projectKey: string, summary: string, description: string): Promise<string> {
    const res = await this.callTool('create', {
      projectKey,
      issueTypeName: 'Task',
      summary: summary.slice(0, 254),
      description,
      additional_fields: { labels: ['agent-draft'] },
    });
    return res?.key ?? res?.issueKey ?? '';
  }
}
