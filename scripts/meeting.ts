/**
 * Phase I runner — npm run meeting -- demo/standup.txt
 *   npm run meeting -- demo/standup.txt          # extract commitments, create agent-draft tickets in Jira
 *   npm run meeting -- demo/standup.txt --dry    # extract and print, create nothing
 *
 * Env (.env): OPENAI_API_KEY (or OPENROUTER_API_KEY), Jira credentials, JIRA_PROJECT_KEY.
 * Created keys are appended to data/agent1-drafts.json so the demo can find them.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getJiraClient } from '../src/jira/index.js';
import { createDrafts, draftDescription, extractCommitments } from '../src/agent1.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const file = args.find((a) => !a.startsWith('-'));
const LOG = 'data/agent1-drafts.json';

async function main() {
  if (!file) throw new Error('usage: npm run meeting -- <transcript.txt> [--dry]');
  const transcript = readFileSync(file, 'utf8');
  console.log(`transcript: ${file} (${transcript.split(/\s+/).length} words)`);

  const { commitments, skipped } = await extractCommitments(transcript);
  console.log(`${commitments.length} commitment(s) found, ${skipped.length} other statement(s) skipped`);
  for (const s of skipped) console.log(`  skip [${s.kind}] ${s.owner}: ${s.title}`);
  for (const c of commitments) {
    console.log(`\n--- ${c.owner}: ${c.title}\n${draftDescription(c)}`);
  }
  if (!commitments.length) return;
  if (DRY) {
    console.log('\n(dry) no tickets created');
    return;
  }

  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!projectKey) throw new Error('missing env JIRA_PROJECT_KEY');
  const jira = await getJiraClient();
  const { created, skipped: existing } = await createDrafts(commitments, jira, projectKey);

  console.log('');
  for (const s of existing) console.log(`  skipped, exists as ${s.key}: ${s.title}`);
  for (const c of created) console.log(`  created ${c.key}: ${c.title}`);
  console.log(`${existing.length} skipped, ${created.length} created via ${jira.backend}, label agent-draft`);

  if (created.length) {
    mkdirSync('data', { recursive: true });
    const log: unknown[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];
    log.push({ at: new Date().toISOString(), transcript: file, created });
    writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
