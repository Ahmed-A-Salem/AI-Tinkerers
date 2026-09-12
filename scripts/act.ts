/**
 * Phase F — check → propose → post to Jira, gated by mode. Thin CLI over src/actions/run.ts.
 *
 *   npm run act -- <KEY>            propose: comment(s) tagged agent-proposed + label agent-conflict
 *   npm run act -- <KEY> --apply    apply pending links if the ticket carries label agent-approved
 *   npm run act -- <KEY> --dry      print the actions, write nothing
 *
 * MODE=accept (default) | auto. Ather's Phase H adds risk gating in src/modes/index.ts.
 */
import 'dotenv/config';
import { runAgent2 } from '../src/actions/run.js';

async function main() {
  const args = process.argv.slice(2);
  const key = args.find((a) => !a.startsWith('--'));
  if (!key) {
    console.error('usage: npm run act -- <KEY> [--apply] [--dry]');
    process.exit(2);
  }
  const result = await runAgent2({
    key,
    apply: args.includes('--apply'),
    dry: args.includes('--dry'),
    log: console.log,
  });
  if (result.performed.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
