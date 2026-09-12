# Plan (owned by the main orchestrator on Ahmed's laptop)

Spec: `docs/BRIEF.md`. Hard stop **15:30** today (2026-09-12). Submit by 15:10.
Only the main orchestrator edits this file. Everyone else reads it and reports CLAIM / DONE / BLOCKED.

## How this plan works

- **Phases are independent.** Each phase reads files or a CLI from earlier phases and produces
  files or a CLI for later ones. Interfaces are in `src/types.ts` and are fixed.
- **No unit tests. A phase is DONE when its acceptance check passes against real data / real Jira.**
  The check is a command or an observable effect, written in the phase card. Run it, paste the
  output in your DONE message.
- **Every phase card is self-contained.** A fresh session with no history should be able to read
  `CLAUDE.md` (auto-loaded) + its phase card and start. If the card is missing something, that's
  a plan bug: tell your orchestrator, don't guess.
- **Two lanes, one plan.** Ahmed's sessions report to the main orchestrator directly (session
  messages). **Ather's developer sessions report straight to the main orchestrator over the ntfy
  bus** (no local orchestrator on Ather's side, decided 13:30). See "Ather's developer sessions" below.
- If a gate is missed, cut from the bottom of the phase list, never the top. Phases A–F alone
  are a submittable product.

## Fresh session bootstrap

**Developer session (either laptop):**
1. `CLAUDE.md` is loaded automatically. Read `docs/BRIEF.md` §5 (architecture) once.
2. Read your phase card below. Nothing else in this file is required.
3. `npm install && npm run typecheck` must pass before you start.
   If your phase needs the target repo (`target/hono`, gitignored, so absent on a fresh clone):
   `git clone --depth 1 https://github.com/honojs/hono target/hono && npm run index`
4. Send `CLAIM <phase>: <files>` to your orchestrator. Do the work. Run the acceptance check.
   Send `DONE <phase>: <acceptance output>` or `BLOCKED <phase>: <what you need>`.

**Ather's developer sessions (one per phase, no local orchestrator):**
1. Do steps 1–3 above. Set `AGENT_BUS_NODE=ather-<phase>` (e.g. `ather-D`) in your shell.
2. Report over the bus instead of `SendMessage`, from the repo root:
   `python coordination/agent_bus.py send request "CLAIM D: data/planted.json, data/planted-tickets.json, scripts/plant.ts"`
   Same for `DONE <phase>: <acceptance output>`, `BLOCKED <phase>: <need>`, `Q: <question>`.
3. Read answers with `python coordination/agent_bus.py poll --since 30m` (the main orchestrator
   replies on the same topic with `reply_to` set to your message id). Pull `main` after any
   `PLAN:` message.
4. When DONE, push your phase's files on a branch and open a PR (see "Git workflow"). Never push to `main`.
5. Current lane order: **D now** (no LLM needed), **C now** (build + dry run; the LLM acceptance
   waits for the OpenRouter key), then **E** once B, C, D are done, then **H**.

**Orchestrator session (Ahmed's laptop):** see `coordination/ORCHESTRATION.md` → "Fresh orchestrator".

## Lanes

| Lane  | Owns                                                            | Directories                                                       |
|-------|-----------------------------------------------------------------|-------------------------------------------------------------------|
| Ahmed | Data + integration: Jira client, issue import, code index, ticket extractor, write-back, demo/submission | `src/jira/`, `src/index/`, `src/extract/`, `src/actions/`, `scripts/`, `demo/` |
| Ather | Intelligence: ticket→code mapping, planted conflicts, retrieval, comparison, modes | `src/mapping/`, `src/retrieval/`, `src/compare/`, `src/modes/`, `data/planted.json` |
| Free  | Trigger.dev wiring, Agent 1                                     | `src/trigger/`, `src/agent1/`                                     |

Shared, frozen: `src/types.ts`. Changing a shape requires telling the main orchestrator first.
Shared, append-only: `package.json` (add deps, don't remove), `.env.example`.

## Phase status board

| Phase | Name                              | Lane  | Status        | Gate  | Depends on |
|-------|-----------------------------------|-------|---------------|-------|------------|
| A     | Foundation                        | Ahmed | **done** 14:08 incl. A4: 206 issues in Jira (`SCRUM-5..204` = GitHub, `SCRUM-208..213` = PLANT-1..6), `data/gh-to-jira.json` 206 rows | 12:15 | — |
| B     | Ticket extractor → records        | Ahmed | **done** 13:50 (206 records, rerun 0 LLM calls; code ba293e9) | 12:45 | A |
| C     | Ticket→code mapping (decision)    | Ather | **done** 14:02: **COMMIT**, 5/5 eval hits on gpt-5-mini (4o-mini scored 3/5); **merged #6 14:12** | 13:00 | A |
| D     | Planted conflicts + ground truth  | Ather | **done** 13:42 (plant.ts --check exit 0; commit to main pending from Ather) | 13:00 | A |
| E     | Retrieval + comparison → verdicts | Ather | **done, merged #14 14:26.** "Caught 4 of 6 planted conflicts with 3 false positives across 206 tickets." (PLANT-1..4 caught with correct type + code_path; missed the two ordering pairs; FPs PLANT-1/SCRUM-185, PLANT-3/SCRUM-129, SCRUM-27/SCRUM-171). Replays from the shipped pair cache, 146 pairs in 1 s | 13:30 | B, C, D |
| F     | Write-back + Accept mode          | Ahmed | **done**: SCRUM-2/3/4 (0e5c1b2) and final check on the planted demo pair SCRUM-208 ↔ SCRUM-198 14:20 (PR #9, stacked on #1) | 14:00 | A4, E (interface only) |
| G     | Event-driven via Trigger.dev      | Free  | **done, merged #1 14:30**; was 14:25 (manual endpoint + webhook verified in live Jira; Trigger.dev task typechecks, no live run without a key). On PR #1 (branch `phase-g-event-driven`, bb4e0a0), **not on main** | 14:15 | F |
| H     | Auto mode + risk gate             | Ather | **done, merged #13 14:24** | 14:30 | F |
| I     | Agent 1: transcript → drafts      | Free  | **done, merged #4 14:35**: drafts SCRUM-205 (collides with PLANT-3 getPath) + SCRUM-206 (clean), rerun dedupes (2 skipped, 0 created); stray SCRUM-207 for Ahmed | 14:30 | A4 |
| J     | Demo, writeup, submit             | Ahmed | docs, run sheet, narration, social all on main with the final sentence (#15, 14:28). **Left: video recording + submission form (Ahmed).** | 15:10 | E, F |

Status values: todo · claimed · in-progress · done · blocked

---

## Phase cards

### Phase A — Foundation  `[Ahmed]`  **done except A4**

Everything later phases build on. Already built by Ahmed's worker session; listed so a fresh
session knows what exists and does not redo it.

| Part | What exists | Acceptance (already passing unless noted) |
|------|-------------|--------------------------------------------|
| A1 | Root `package.json` (ESM; ts-morph, openai, @trigger.dev/sdk; tsx, typescript), `tsconfig.json` (strict), `.env.example` | `npm install && npm run typecheck` exits 0 |
| A2 | `src/types.ts`: TicketRecord (§5.2), ConflictVerdict (§5.3), index shapes (§5.1), `AgentAction` union = comment / link / label only | typecheck |
| A3 | `src/jira/client.ts`: `getJiraClient()` → `JiraClient` with whoAmI / getIssue / searchIssues / addComment / addLabel / linkIssues / createDraftIssue. REST backend (API token) and MCP backend, chosen by env. No updateDescription by design. | typecheck |
| A3 | Target repo `honojs/hono` shallow-cloned to `target/hono` (gitignored; fresh clones re-create it with `git clone --depth 1 https://github.com/honojs/hono target/hono`). 200 open issues in `data/hono-issues.json`. `scripts/import-issues.ts` dry-run OK. | `npm run import:issues` (dry run) prints 200 valid payloads |
| A3 | Code index: `npm run index` → `data/symbols.json` (1122 symbols, 625 exported), `data/imports.json` (493 internal edges), `data/symbol-collisions.json` (66 names in >1 file) | files exist, counts as stated |
| **A4** | **Jira live.** Needs from Ahmed: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` in `.env` (or the MCP OAuth). | `npx tsx scripts/jira-smoke.ts --comment <KEY>` reads 5 issues and a test comment appears in Jira. Then `npm run import:issues -- --go` creates 200 issues and writes `data/gh-to-jira.json`. **BLOCKED on Ahmed.** |

Known sharp edges for later phases: see "Notes for the intelligence layer" at the bottom.

---

### Phase B — Ticket extractor → structured records  `[Ahmed]`  gate 12:45

**Goal:** one §5.2 `TicketRecord` per ticket, cached on disk, one cheap LLM call each.

- **Input:** `data/hono-issues.json` (or Jira via `getJiraClient().searchIssues()` once A4 is live; same shape either way), `data/symbols.json` for the symbol vocabulary.
- **Output:** `data/records/<KEY>.json`, one per ticket, exactly `TicketRecord`. `files_touched` may be empty here; Phase C fills it.
- **CLI:** `npm run extract` (all tickets, skips cached) and `npm run extract -- <KEY>` (force one).
- **Files:** `src/extract/`, `scripts/extract.ts`.
- **Model:** OpenAI (`OPENAI_API_KEY`), model `gpt-5-mini` via `LLM_MODEL`. OpenRouter (`OPENROUTER_API_KEY`) only as fallback. Use structured output / JSON mode. **Do not send `temperature`**: GPT-5 models reject any value but the default.
- **Acceptance:**
  1. `npm run extract` over 200 tickets completes; `ls data/records | wc -l` = 200.
  2. Open 5 records by hand: `components` non-empty and plausible, `removes` / `values_specified` populated where the ticket text supports it, nothing invented.
  3. Run `npm run extract` again: 0 LLM calls (log line shows "200 cached").
  Paste the count line and one full record in the DONE message.

---

### Phase C — Ticket→code mapping decision  `[Ather]`  decide by 13:00

**Goal:** answer the brief's hard question (§5.2): can an LLM predict `files_touched` from ticket
text + file tree well enough to build on? Commit or fall back.

- **Input:** `data/hono-issues.json`, file list = keys of `data/imports.json`, `data/symbols.json`.
- **Output:** `src/mapping/index.ts` exporting `mapTicketToFiles(record, index) → string[]`,
  and `data/mapping-eval.md` with the result of the test below.
- **CLI:** `npm run map -- <KEY>` prints predicted files for one ticket.
- **Files:** `src/mapping/`, `scripts/map.ts`, `data/mapping-eval.md`.
- **Approach:** LLM sees ticket title+body and the file tree (188 paths, fits in context), returns
  ≤5 paths. Post-filter to paths that exist. If the ticket names a symbol that is in
  `data/symbol-collisions.json`, include every candidate file.
- **Acceptance:**
  1. Pick 5 real hono issues whose correct file is obvious to a human (e.g. it names a helper or
     a middleware). Record the expected file for each in `data/mapping-eval.md`.
  2. Run `npm run map` on each. **≥3 of 5 include the expected file → COMMIT** to this approach.
     **<3 → FALLBACK:** mapping uses only tickets that name a component/symbol; demo restricted
     to those. Write the decision in `data/mapping-eval.md` and in the DONE message.

---

### Phase D — Planted conflicts + ground truth  `[Ather]`  gate 13:00

**Goal:** 6 known conflicts inserted into the backlog so Phase E can be proven (§9).

- **Input:** `data/hono-issues.json`, `data/symbols.json`, `data/imports.json`.
- **Output:** `data/planted.json`: 6 entries `{ pair: [KEY_A, KEY_B], type, expected_code_path, note }`,
  and the planted ticket bodies appended to `data/hono-issues.json` with keys `PLANT-1..6`
  (they get real Jira keys when A4 imports; `data/gh-to-jira.json` maps them).
- **Files:** `data/planted.json`, `data/planted-tickets.json` (the 6 bodies), `scripts/plant.ts`.
- **Mix:** 4 × `dependency_break` (ticket B removes/renames a symbol that files from ticket A
  import; use real edges from `imports.json`), 2 × `ordering` (B assumes A shipped; no
  `depends_on` stated). Write them like real issues, not like test fixtures. One of them must be
  the demo pair from brief §7: a ticket that rips out a refresh-token-style flow vs. a ticket
  that relies on it (pick the hono equivalent, e.g. a middleware helper).
- **Acceptance:** `data/planted.json` has 6 entries; each `expected_code_path` names a real file
  and symbol from `data/symbols.json`; each `dependency_break` pair's edge exists in
  `data/imports.json`. `npx tsx scripts/plant.ts --check` verifies all of that and exits 0.

---

### Phase E — Retrieval + comparison → verdicts  `[Ather]`  gate 13:30 (e2e on one example)

**Goal:** given one changed ticket, find candidate tickets cheaply, compare only the shortlist with
the LLM using the code graph, emit §5.3 `ConflictVerdict[]`.

- **Input:** `data/records/*.json` (Phase B), `mapTicketToFiles` (Phase C), `data/symbols.json`,
  `data/imports.json`, `data/symbol-collisions.json`, `data/planted.json` (for the proof run).
- **Output:** `src/retrieval/` → `candidates(key) → key[]`; `src/compare/` → `compare(a, b, index) → ConflictVerdict | null`;
  `src/agent2.ts` → `checkTicket(key) → ConflictVerdict[]`. Results written to `data/verdicts/<KEY>.json`.
- **CLI:** `npm run check -- <KEY>` (one ticket) and `npm run check -- --all` (full backlog, prints the §9 sentence).
- **Files:** `src/retrieval/`, `src/compare/`, `src/agent2.ts`, `scripts/check.ts`.
- **Retrieval rule:** candidate if overlap on `components`, or `files_touched`, or any named symbol,
  or an import edge between the two tickets' files. Expect ~150 pairs from 200 tickets, not 20k.
- **Comparison:** LLM gets both records, both tickets' text, and the relevant slice of the graph
  (files, symbols, edges between them). Returns verdict with `confidence` and quoted evidence lines.
  Only `dependency_break` and `ordering` for now.
- **Acceptance:**
  1. `npm run check -- PLANT-1` (the demo pair) → one verdict, correct pair, correct type,
     `evidence.code_path` matches `planted.json`.
  2. `npm run check -- --all` → prints e.g. "Caught 5 of 6 planted conflicts with 1 false positive
     across 206 tickets." **≥4 of 6 with ≤2 false positives** is the bar. Paste the sentence.
  3. A ticket with no conflict returns `[]` and the candidate count (for the "checked N related
     tickets, no conflicts" comment in Phase F).

---

### Phase F — Write-back + Accept mode  `[Ahmed]`  gate 14:00

**Goal:** turn verdicts into Jira actions, gated by approval. Jira comments and labels are the UI.

- **Input:** `ConflictVerdict[]` from Phase E (until E is done, use a hand-written verdict file
  `data/verdicts/SAMPLE.json` so this phase is independent), `JiraClient` from A3, live Jira from A4.
- **Output:** `src/actions/` → `propose(verdicts) → AgentAction[]`, `apply(actions)`;
  `src/modes/accept.ts` (Ather owns `src/modes/` later; you create only this file, Ather extends).
- **CLI:** `npm run act -- <KEY>` runs check → propose → (Accept mode) post one comment per verdict
  tagged `agent-proposed` with both quoted lines and the code path, plus label `agent-conflict`.
  `npm run act -- <KEY> --apply` applies pending proposals on a ticket that carries label `agent-approved`
  (link the pair with Jira issue link type "Blocks" / "Relates").
  On no conflict: comment "Checked against N related tickets, no conflicts found."
- **Files:** `src/actions/`, `src/modes/accept.ts`, `scripts/act.ts`.
- **Acceptance (in real Jira):**
  1. `npm run act -- <planted key>` → a comment appears on the ticket with both quoted lines and the
     code path, and the ticket gets label `agent-conflict`.
  2. Add label `agent-approved` in the Jira UI, run `npm run act -- <key> --apply` → the two tickets
     are linked. Screenshot both.
  3. `npm run act -- <clean key>` → the "no conflicts found" comment appears.

---

### Phase G — Event-driven via Trigger.dev  `[free]`  gate 14:15

**Goal:** no manual command. Ticket created/updated in Jira → Agent 2 runs.

- **Input:** `checkTicket` + `propose`/`apply` (E, F). `TRIGGER_SECRET_KEY` (Trigger.dev project).
- **Output:** `src/trigger/agent2.ts` task; Jira webhook (issue created/updated, and label
  `agent-approved` added) → Trigger.dev. Fallback: `POST /trigger/<KEY>` manual endpoint if the
  webhook can't reach a dev tunnel; do not debug tunnels past 14:30.
- **Files:** `src/trigger/`, `trigger.config.ts`.
- **Acceptance:** edit a planted ticket's description in Jira → within 60 s the `agent-proposed`
  comment appears with no command run. Add `agent-approved` → link appears. Show the Trigger.dev
  run log.

---

### Phase H — Auto mode + risk gate  `[Ather]`  gate 14:30

**Goal:** same pipeline, flag decides whether actions wait.

- **Input:** `AgentAction[]` from Phase F; `MODE=accept|auto|risk` env.
- **Output:** `src/modes/index.ts`: `gate(actions, mode, confidence) → { now: AgentAction[], pending: AgentAction[] }`.
  `auto`: everything now. `risk`: comment/label/link with confidence ≥0.9 now, everything else
  pending; there is no edit action in the type so nothing meaning-changing can ever pass.
- **Files:** `src/modes/` (extends Ahmed's `accept.ts`).
- **Acceptance:** `MODE=auto npm run act -- <second planted key>` → link applied with no approval
  label. `MODE=risk` with a verdict edited to confidence 0.6 → comment posted, link left pending.

---

### Phase I — Agent 1: transcript → draft tickets  `[free]`  gate 14:30, **cut if E slipped**

- **Input:** `demo/standup.txt` (the stand-up script; write it first, it defines the demo),
  `createDraftIssue` from A3.
- **Output:** `src/agent1.ts` → commitments → draft tickets (title, description, acceptance criteria)
  created under label `agent-draft`. `npm run meeting -- demo/standup.txt`.
- **Acceptance:** run it → 2 draft tickets appear in Jira with label `agent-draft`; Agent 2 (via
  G, or `npm run act`) flags one of them against a planted ticket.

---

### Phase J — Demo, writeup, submit  `[Ahmed]`  submit by 15:10

- `demo/standup.txt` → ElevenLabs multi-voice audio; narration script `demo/narration.txt` →
  ElevenLabs; screen recording following brief §7. Run the demo input 20 times before recording.
- `README.md` a judge can follow: env vars, `npm run index`, `npm run extract`, `npm run check -- --all`, `npm run act`.
- `docs/WRITEUP.md`: what, for whom, why Jira, retrieval architecture, the §9 sentence from Phase E.
- Social post tagging sponsors. Owners for video/post: **[OPEN], assign by 14:00.**
- **Acceptance:** submission confirmation received before 15:15.

---

## Active claims (conflict watch)

| Owner | Phase | Files / areas | Since |
|-------|-------|---------------|-------|
| Ahmed / session ai-tinkerers-a3 | free (e2e done) | — | 14:30 |
| Ather / session ai-tinkerers-b2 | E | `src/retrieval/`, `src/compare/`, `src/agent2.ts`, `scripts/check.ts`, `data/verdicts/<KEY>.json` (not SAMPLE.json), `check` script in package.json | 13:49 |
| Ahmed / session ai-tinkerers-f2 | free | — | 14:30 |

Main orchestrator since 12:48: session ai-tinkerers-f0. Ather's side: local orchestrator ai-tinkerers-c3 (bus node `ather`) online since 13:33; it relays its workers' CLAIM/DONE. Direct `ather-<phase>` posts are also accepted.

## Git workflow (decided by Ahmed 14:32): PR per phase, no direct pushes to main

Workers were racing each other on `main` (last push wins), so the ruleset "Protect main" is
deliberate and stays. Rules from now on, both laptops, orchestrator included:
1. Never push to `main`. Branch from a fresh `main`: `git fetch origin && git checkout -b phase-<x>-<slug> origin/main`.
2. Commit only your phase's files. Push the branch, open a PR against `main`
   (`gh pr create --fill --base main`), and put the PR number in your DONE message.
3. A reviewer session on Ahmed's laptop checks each PR for conflicts and file ownership, reports to
   the main orchestrator, and approves it on GitHub. It runs no code and does not merge. Cross-approval:
   Ather approves PRs from Ahmed's account, Ahmed approves Ather's. A human merges from the GitHub UI.
   If a fix is needed, the main orchestrator assigns it to the PR's owner; fix on the same branch.
4. After a merge, everyone `git pull origin main` before starting the next thing.
Merged: #6 Phase C (14:12); #7, #8, #5, #1, #2, #3 (14:30); #4 (14:35). #12 (14:22); #13 (14:24). #14 (E, 14:26); #15 (docs numbers, 14:28). Open: #11 only (B removes, held until after submission by E's decision; merging it invalidates cached verdicts for 13 tickets). #9 and #10 were auto-closed when the phase-g branch was deleted on #1's merge; being re-created against main (F-keys by f2, H by Ather, in that order). **Never merge with --delete-branch while another PR stacks on that branch.** Open PRs: #1 Phase G, #2 plan update, #3 demo run sheet + narration, #4 Phase I, #5 social post, #7 A4 planted mapping, #8 key helpers (`resolveKey`/`jiraKey`), #9 F key resolution + SCRUM-208 verdict (stacked on #1), #10 Phase H (Ather, draft, stacked on #1). Approvals: Ather's session ai-tinkerers-1e approves Ahmed-authored PRs; our reviewer ai-tinkerers-08 approves Ather's. PR #3 updated with the planted keys. The main orchestrator merges once approved (Ahmed, 14:12). **Merge order: #1, #4 (rebase), #2, #3, #5, #7, #8, #9, then #10 rebased onto main (adjacent-hunk conflict with #9 in `src/actions/run.ts`), then E.** Old note: (H and the final F check edit files on it).

## End-to-end proof on main (14:30, commit 4079467 + #15)

1. `npm run typecheck` exit 0.
2. `npm run check -- SCRUM-210` → SCRUM-210 ↔ SCRUM-205 (Agent 1 draft) dependency_break 0.92, `src/utils/url.ts → getPath()`.
3. `npm run act -- SCRUM-205` (live Jira) → agent-proposed comment quoting both lines, `agent-conflict` on 205 and 210, link held; after `agent-approved`, `--apply` linked 210 → 205.
4. `npm run check -- --all` → "Caught 4 of 6 planted conflicts with 3 false positives across 206 tickets." from cache, 146 pairs in 1 s.
5. `npm run check -- SCRUM-114` → "Checked against 2 related tickets, no conflicts found."

## Submission checklist (Ahmed)

- [ ] Record the video from `demo/DEMO.md` on `main` (`git pull`, `npm install`, target/hono at `edd138e`); narration in `demo/narration.txt`.
- [ ] Delete stray draft SCRUM-207 in Jira before recording (run sheet pre-flight).
- [ ] Submit: repo link, video, `docs/WRITEUP.md`; social post from `demo/social.md` with tags and links filled.
- [ ] After submission: merge #11 and re-run `npm run check -- --all` if there is time.

## Decisions

- 2026-09-12: bus = ntfy topic `claude9-agent-x7k9p2`; main orchestrator on Ahmed's laptop;
  Ather runs a local orchestrator that reports up over the bus.
- All product/architecture decisions are in `docs/BRIEF.md` §4 and are closed.
- Target repo: `honojs/hono` (public, MIT, 188 non-test TS files, 266 open issues).
- Bulk issue import over Jira REST (API token). MCP remains a runtime backend; REST is the
  fallback for runtime actions too, so the product stays on Jira even if OAuth never completes.
  Linear only if no Jira credential at all.
- `JiraClient` has no updateDescription(); `createDraftIssue()` hardcodes `agent-draft`.
- Verification = functional acceptance checks per phase, no unit tests.
- 2026-09-12 13:30 (Ahmed + Ather): **no local orchestrator on Ather's laptop.** Ather's developer
  sessions post CLAIM/DONE/BLOCKED/Q directly on the bus with `AGENT_BUS_NODE=ather-<phase>`;
  the main orchestrator answers on the bus. Each side commits its own finished phase files to `main`.
- 2026-09-12 14:10: **key spaces.** Canonical record key = `SCRUM-x` for imported GitHub issues, `PLANT-n`
  for planted tickets (their Jira keys are `SCRUM-208..213`). `resolveKey(ref)` maps any reference
  (GH-n, #n, PLANT-n, SCRUM-x) to the record key; `jiraKey(recordKey)` maps back to the Jira key.
  Verdicts and Jira actions carry Jira keys; records and caches carry record keys. `target/hono`
  must be at `edd138e` for E's pair cache to replay without LLM calls (both laptops are).
- 2026-09-12 13:50 (Phase B): **records are keyed by Jira key.** The 200 GitHub issues are
  `SCRUM-5..SCRUM-204` (`data/gh-to-jira.json`, rows `{key, gh}`); planted tickets are `PLANT-1..6`
  until their import. `data/planted.json` still names `GH-<n>`; resolve through `issueKey()` in
  `src/extract/issues.ts`. `depends_on` refs in records already resolve to SCRUM keys.
- 2026-09-12 13:40 (Ahmed): **LLM provider = OpenAI, model = `gpt-5-mini`.** Supersedes the 12:58
  OpenRouter decision (organizers gave OpenAI credits). Every phase that calls a model (B, C, E, I):
  `new OpenAI()` with `OPENAI_API_KEY`, model id from `LLM_MODEL` env (`.env` has `gpt-5-mini`).
  Fallback only if `OPENAI_API_KEY` is absent: OpenRouter with `baseURL https://openrouter.ai/api/v1`
  and the model prefixed `openai/`. **Never pass `temperature`** (GPT-5 family returns 400 for
  anything but the default). Use `response_format: json_schema` (strict) with a `json_object` retry.
  Reuse `src/extract/llm.ts` (`completeJson`) instead of writing another client.
- 2026-09-12 12:50 (Phase B): **record key convention** for `data/records/<KEY>.json`: `issue.key` if
  present (PLANT-*), else the `data/gh-to-jira.json` mapping if it exists, else `GH-<number>`.
  Exported as `issueKey()` / `loadIssues()` from `src/extract/issues.ts`; Phases C and E reuse it
  rather than re-deriving keys.

## Phase F interface (done 14:00, commit 0e5c1b2)

- `src/actions/index.ts`: `propose(verdicts) → AgentAction[]`, `apply(actions)`, `linkFor`, `describe`;
  constants `PROPOSED_TAG`, `APPLIED_TAG`, `CONFLICT_LABEL` (`agent-conflict`), `APPROVED_LABEL` (`agent-approved`).
- `src/modes/accept.ts`: `gate(actions, mode, approved) → { now, pending }`, `acceptGate`, `isApproved`.
  `MODE=accept` (default) holds links until the ticket carries `agent-approved`; `MODE=auto` applies links
  at once. **Phase H extends this file's `gate()` with `risk`** (confidence ≥ 0.9 now, else pending).
- `scripts/act.ts` verdict source order: `src/agent2.ts` `checkTicket(key)` if the module exists →
  `data/verdicts/<KEY>.json` → `SAMPLE.json`. Either a bare `ConflictVerdict[]` or
  `{ candidates: number, verdicts: [] }`; **Phase E should return the object form** so the
  no-conflict comment can say "Checked against N related tickets".
- Links: `ordering` → "Blocks" (A blocks B), everything else → "Relates". Label `agent-conflict` on both
  tickets, comment on the checked ticket only.
- Known limit: re-running the proposal step posts a duplicate comment (no comment dedupe).

## Planted conflicts (Phase D output, 13:42)

| Pair | Type | Code path |
|------|------|-----------|
| GH-2398 (SCRUM-198) ↔ PLANT-1 (SCRUM-208) | dependency_break | `src/helper/cookie/index.ts` `getSignedCookie()` — **demo pair** (jwt middleware reads its token from a signed cookie) |
| GH-4192 ↔ PLANT-2 (SCRUM-209) | dependency_break | `src/utils/basic-auth.ts` `auth()` |
| GH-3210 ↔ PLANT-3 (SCRUM-210; Agent 1 draft SCRUM-205 also collides) | dependency_break | `src/utils/url.ts` `getPath()` |
| GH-3543 ↔ PLANT-4 (SCRUM-211) | dependency_break | `src/utils/accept.ts` `parseAccept()` |
| GH-3527 ↔ PLANT-5 (SCRUM-212) | ordering | `src/helper/streaming/sse.ts` `streamSSE()` |
| GH-3751 ↔ PLANT-6 (SCRUM-213) | ordering | `src/utils/color.ts` `getColorEnabledAsync()` |

`data/hono-issues.json` has 206 entries; PLANT-n entries carry `key` instead of `number`.
`data/planted.json` entries also have `edge`, `demo`, `also_acceptable`. For Phase E scoring:
`also_acceptable` pairs are real overlaps, not false positives; pairs match in either order.
Phase I: an Agent 1 draft that "rips out signed cookies" would duplicate PLANT-1; pick a different commitment.

## Notes for the intelligence layer (Phases C, D, E)

- `data/symbols.json` holds one winner per symbol name. 66 names are declared in more than one
  file; see `data/symbol-collisions.json`. `Hono` resolves to `src/hono-base.ts` but tickets mean
  `src/hono.ts`; `Context` spans 4 files. When a symbol is in the collisions file, consider every
  candidate file.
- `data/imports.json` has internal (relative) edges only. 31 files have zero internal imports;
  an ordering check must tolerate that.
- Hono's `src/jsx` subtree carries a lot of issue traffic.

## Open questions (brief §10)

- Project name: [OPEN]
- Video owner, social post owner: [OPEN], assign by 14:00
- CopilotKit panel: only if a teammate wants it and it costs nothing
- Jira credential + project key: **resolved 13:20**, REST backend, project key `SCRUM`. LLM key: **resolved 13:40**, OpenAI, model `gpt-5-mini`.
