/**
 * t1 — prove the Jira credential works end to end: read issues, write one test comment.
 *
 *   npx tsx scripts/jira-smoke.ts                 # read-only
 *   npx tsx scripts/jira-smoke.ts --comment PROJ-1  # ...and write one comment
 *
 * Works against whichever backend has credentials (see src/jira/index.ts).
 */
import { getJiraClient, describeCredentials } from '../src/jira/index.js';

async function main() {
  console.log(`credentials: ${describeCredentials()}`);
  const jira = await getJiraClient();
  console.log(`backend: ${jira.backend}`);
  console.log(`whoami: ${await jira.whoAmI()}`);

  const project = process.env.JIRA_PROJECT_KEY;
  const jql = project ? `project = ${project} ORDER BY created DESC` : 'ORDER BY created DESC';
  const issues = await jira.searchIssues(jql, 5);
  console.log(`read ${issues.length} issues:`);
  for (const i of issues) console.log(`  ${i.key}  ${i.summary.slice(0, 70)}  [${i.labels.join(', ')}]`);

  const flag = process.argv.indexOf('--comment');
  if (flag === -1) {
    console.log('\nread path OK. re-run with --comment <ISSUE-KEY> to test the write path.');
    return;
  }
  const key = process.argv[flag + 1] ?? issues[0]?.key;
  if (!key) throw new Error('no issue key to comment on');
  await jira.addComment(key, `Backlog Conflict Agent smoke test — write path OK via ${jira.backend} at ${new Date().toISOString()}.`);
  console.log(`\nwrote a test comment to ${key}. t1 satisfied.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
