# Phase C — ticket → code mapping eval

Question (brief §5.2): can an LLM predict `files_touched` from ticket text plus the file tree well
enough to build on? Rule from the plan: **≥3 of 5 include the expected file → COMMIT**, otherwise
**FALLBACK** (mapping only for tickets that name a component/symbol; demo restricted to those).

Method: `npm run map -- --eval` runs `mapTicketToFiles` on each issue below. The model sees the
title, body and all 188 indexed paths and returns ≤5 paths, post-filtered to paths that exist.
Linked hono source paths and collision-symbol candidates are added deterministically.

## Cases

Five real hono issues whose correct file is obvious to a human reading the source. None of them
links the file, so a hit comes from the model, not the linked-path rule.

| # | Issue | Title | Expected file(s) | Why |
|---|-------|-------|------------------|-----|
| 1 | #2762 | Setting cookie with Max-Age > 400 days throws | `src/utils/cookie.ts` | The 400-day throw is in `serialize` (cookie.ts:210). A tempting wrong answer is `src/helper/cookie/index.ts`. |
| 2 | #2942 | Make argument order for getSignedCookie the same as setSignedCookie | `src/helper/cookie/index.ts` | Both functions are declared there (lines 50, 130). |
| 3 | #4623 | Inconsistent behavior of /** syntax in TrieRouter vs other routers | `src/router/trie-router/node.ts` | TrieRouter's wildcard matching lives in `Node`. |
| 4 | #3407 | `trimTrailingSlash` doesn't work on paths with `*` | `src/middleware/trailing-slash/index.ts` | `trimTrailingSlash` is declared there (line 44). |
| 5 | #3995 | JWT Middleware doesn't inform of JWT expiry | `src/middleware/jwt/jwt.ts` | The middleware's `catch` (jwt.ts:142) swallows `JwtTokenExpired` into a generic 401 `HTTPException`. A tempting wrong answer is `src/utils/jwt/jwt.ts`, which throws the typed error correctly. |

(#3809 logger/TTY was dropped as a case because its body links `src/utils/color.ts`, so the linked-path rule would hit without the model.)

## Results

Run 2026-09-12 with `npm run map -- --eval --force`, model **`openai:gpt-5-mini`** (the plan's model,
from `LLM_MODEL`). GH numbers resolve to record keys through `data/gh-to-jira.json`. Predictions are
cached in `data/mapping/<KEY>.json`. A hit counts only files from the `llm` or `collision` source.

| # | Issue | Result | Predicted (source) |
|---|-------|--------|--------------------|
| 1 | #2762 → SCRUM-180 | HIT | `src/utils/cookie.ts` (llm)<br>`src/context.ts` (llm) |
| 2 | #2942 → SCRUM-174 | HIT | `src/helper/cookie/index.ts` (llm)<br>`src/utils/cookie.ts` (llm) |
| 3 | #4623 → SCRUM-35 | HIT | `src/router/trie-router/router.ts` (llm)<br>`src/router/trie-router/node.ts` (llm) |
| 4 | #3407 → SCRUM-148 | HIT | `src/middleware/trailing-slash/index.ts` (llm) |
| 5 | #3995 → SCRUM-101 | HIT | `src/middleware/jwt/jwt.ts` (llm)<br>`src/middleware/jwt/index.ts` (llm)<br>`src/utils/jwt/jwt.ts` (llm)<br>`src/http-exception.ts` (llm) |

**5/5 include the expected file.** Predictions are tight: 1–4 files each. The extras are plausible
neighbours (the cookie util next to the cookie helper, `router.ts` next to `node.ts`, `http-exception.ts`
for the 401).

Earlier run with `openai:gpt-4o-mini`: 3/5 (it missed #2942 and #4623 with a same-area wrong file and added noisier extras).

## Decision

**COMMIT** to LLM file prediction with `gpt-5-mini` (5/5, rule is ≥3/5). Phase E uses
`getFilesForTicket()` for `files_touched`. File overlap is a candidate signal, not proof; the
comparison step confirms each pair. Model choice matters: with `gpt-4o-mini` the same eval only just
cleared the bar, so keep `LLM_MODEL=gpt-5-mini`.
