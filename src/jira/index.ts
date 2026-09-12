/**
 * Pick a backend from whichever credential actually showed up.
 * Everything downstream imports `getJiraClient()` and never names a backend.
 */
import type { JiraClient } from './client.js';
import { JiraRestClient } from './rest.js';
import { JiraMcpClient } from './mcp.js';

export type { JiraClient, JiraIssue } from './client.js';
export { JiraRestClient } from './rest.js';
export { JiraMcpClient } from './mcp.js';

export function describeCredentials(): string {
  const rest = !!(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
  const mcp = !!process.env.JIRA_MCP_TOKEN;
  return `rest:${rest ? 'ready' : 'missing'} mcp:${mcp ? 'ready' : 'missing'}`;
}

/**
 * JIRA_BACKEND forces a choice; otherwise MCP wins when its token is present (it is the
 * brief's preferred path) and REST is the fallback.
 */
export async function getJiraClient(): Promise<JiraClient> {
  const forced = process.env.JIRA_BACKEND as 'rest' | 'mcp' | undefined;
  const haveMcp = !!process.env.JIRA_MCP_TOKEN;
  const haveRest = !!(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);

  if (forced === 'rest' || (!forced && !haveMcp && haveRest)) return new JiraRestClient();
  if (forced === 'mcp' || (!forced && haveMcp)) {
    const client = new JiraMcpClient();
    await client.connect();
    return client;
  }
  throw new Error(
    `no Jira credential found (${describeCredentials()}). Set either ` +
      `JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN, or JIRA_MCP_TOKEN.`,
  );
}
