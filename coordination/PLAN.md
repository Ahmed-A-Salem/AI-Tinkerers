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
  messages). Ather's sessions report to Ather's local orchestrator, which reports to the main
  orchestrator over the ntfy bus. See `coordination/ORCHESTRATION.md`.
- If a gate is missed, cut from the bottom of the phase list, never the top. Phases A–F alone
  are a submittable product.

## Fresh session bootstrap

**Developer session (either laptop):**
1. `CLAUDE.md` is loaded automatically. Read `docs/BRIEF.md` §5 (architecture) once.
2. Read your phase card below. Nothing else in this file is required.
3. `npm install && npm run typecheck` must pass before you start.
4. Send `CLAIM <phase>: <files>` to your orchestrator. Do the work. Run the acceptance check.
   Send `DONE <phase>: <acceptance output>` or `BLOCKED <phase>: <what you need>`.

**Orchestrator session (either laptop):** see `coordination/ORCHESTRATION.md` → "Fresh orchestrator".

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
| A     | Foundation                        | Ahmed | **done** except A4 (needs Jira credential) | 12:15 | — |
| B     | Ticket extractor → records        | Ahmed | todo          | 12:45 | A |
| C     | Ticket→code mapping (decision)    | Ather | todo          | 13:00 | A |
| D     | Planted conflicts + ground truth  | Ather | todo          | 13:00 | A |
| E     | Retrieval + comparison → verdicts | Ather | todo          | 13:30 | B, C, D |
| F     | Write-back + Accept mode          | Ahmed | todo          | 14:00 | A4, E (interface only) |
| G     | Event-driven via Trigger.dev      | Free  | todo          | 14:15 | F |
| H     | Auto mode + risk gate             | Ather | todo          | 14:30 | F |
| I     | Agent 1: transcript → drafts      | Free  | todo, cut if E slipped | 14:30 | A4 |
| J     | Demo, writeup, submit             | Ahmed | todo          | 15:10 | E, F |

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
| A3 | Target repo `honojs/hono` shallow-cloned to `target/hono` (gitignored). 200 open issues in `data/hono-issues.json`. `scripts/import-issues.ts` dry-run OK. | `npm run import:issues` (dry run) prints 200 valid payloads |
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
- **Model:** OpenAI (`OPENAI_API_KEY`), fallback OpenRouter (`OPENROUTER_API_KEY`). Use structured output / JSON mode.
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

(Phases A1–A3 were done by Ahmed's worker session `ai-tinkerers-d2`, now released. It is HOLDING.)

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
- Jira credential + project key: **[OPEN, blocks A4 and everything that writes to Jira]**
