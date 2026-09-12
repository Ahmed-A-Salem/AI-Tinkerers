/**
 * Phase B runner — npm run extract
 *   npm run extract                 # every ticket, skips ones already in data/records/
 *   npm run extract -- GH-5364      # force re-extract one ticket (or PLANT-3, or a Jira key)
 *   npm run extract -- --dry GH-5364  # print the prompt for one ticket, no LLM call
 *
 * Env (.env in repo root): OPENAI_API_KEY (primary), else OPENROUTER_API_KEY.
 * Optional: LLM_MODEL (default gpt-5-mini), EXTRACT_CONCURRENCY (default 6).
 */
import 'dotenv/config';
import { loadIssues } from '../src/extract/issues.js';
import { buildVocab, buildPrompt, extractRecord } from '../src/extract/index.js';
import { hasRecord, readRecord, writeRecord, RECORDS_DIR } from '../src/extract/cache.js';
import { getProvider } from '../src/extract/llm.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const forced = args.filter((a) => !a.startsWith('-'));
const CONCURRENCY = Math.max(1, Number(process.env.EXTRACT_CONCURRENCY ?? 6));

async function main() {
  const issues = loadIssues();
  const vocab = buildVocab();
  const known = new Set(issues.map((i) => i.key));
  const unknown = forced.filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`unknown key(s): ${unknown.join(', ')}`);

  const todo = forced.length ? issues.filter((i) => forced.includes(i.key)) : issues.filter((i) => !hasRecord(i.key));
  const cachedCount = forced.length ? issues.filter((i) => hasRecord(i.key)).length : issues.length - todo.length;

  if (DRY) {
    for (const issue of todo.slice(0, 3)) console.log(`--- ${issue.key} ---\n${buildPrompt(issue, vocab).user}\n`);
    console.log(`(dry) ${todo.length} would be extracted, ${cachedCount} already cached`);
    return;
  }

  console.log(`${issues.length} tickets, ${cachedCount} cached, ${todo.length} to extract → ${RECORDS_DIR}/`);
  if (!todo.length) {
    console.log(`${cachedCount} cached, 0 LLM calls`);
    return;
  }

  const p = getProvider();
  console.log(`model: ${p.model} via ${p.name}, concurrency ${CONCURRENCY}`);
  const started = Date.now();
  let done = 0;
  let calls = 0;
  const failed: string[] = [];
  const queue = [...todo];

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let issue = queue.shift(); issue; issue = queue.shift()) {
        calls++;
        try {
          writeRecord(await extractRecord(issue, vocab));
          done++;
          if (done % 20 === 0 || forced.length) console.log(`  ${done}/${todo.length} ${issue.key}`);
        } catch (e: unknown) {
          failed.push(issue.key);
          console.error(`  FAIL ${issue.key}: ${(e as Error)?.message ?? e}`);
        }
      }
    }),
  );

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${cachedCount} cached, ${calls} LLM calls, ${done} written, ${failed.length} failed in ${secs}s`);
  for (const k of forced) console.log(JSON.stringify(readRecord(k), null, 2));
  if (failed.length) {
    console.error(`failed: ${failed.join(', ')} — re-run to retry`);
    process.exit(1);
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
