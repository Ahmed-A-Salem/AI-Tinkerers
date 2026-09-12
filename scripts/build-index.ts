/**
 * t2 runner — npm run index
 *   TARGET_REPO=target/hono npx tsx scripts/build-index.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildIndex } from '../src/index/build.js';

const repo = process.env.TARGET_REPO ?? 'target/hono';
const started = Date.now();

const { symbols, imports, collisions, stats } = buildIndex(repo, [
  `${repo}/src/**/*.ts`,
  `${repo}/src/**/*.tsx`,
  `!${repo}/src/**/*.test.ts`,
  `!${repo}/src/**/*.test.tsx`,
]);

mkdirSync('data', { recursive: true });
writeFileSync('data/symbols.json', JSON.stringify(symbols, null, 2));
writeFileSync('data/imports.json', JSON.stringify(imports, null, 2));
if (stats.collisions) writeFileSync('data/symbol-collisions.json', JSON.stringify(collisions, null, 2));

console.log(
  `indexed ${repo} in ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
    `  files      ${stats.files}\n` +
    `  symbols    ${stats.symbols} (${stats.exported} exported)\n` +
    `  import edges ${stats.edges}\n` +
    `  name collisions ${stats.collisions}${stats.collisions ? ' → data/symbol-collisions.json' : ''}`,
);
