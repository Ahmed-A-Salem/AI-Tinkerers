# Demo run sheet

Two minutes, brief §7. Terminal on the left, Jira on the right. Narration is `demo/narration.txt`;
each step below has the same number as its narration block.

Tickets used:

| Role | Key | What it is |
|---|---|---|
| Agent 1 draft | SCRUM-205 | "Add hono/path helper with matchedPath and basePath", created from the stand-up |
| Its conflict | SCRUM-210 (PLANT-3) | "perf: fold getPath and getPathNoStrict into one internal path parser", removes `getPath` |
| Auto-mode ticket | SCRUM-208 (PLANT-1) | "Remove signed cookie helpers (getSignedCookie / setSignedCookie) from hono/cookie" |
| Its conflict | SCRUM-198 | GitHub #2398 "Use Signed Cookies in jwt Middleware", needs those helpers |

Expected code paths: SCRUM-205 vs SCRUM-210 → `src/utils/url.ts -> getPath()`.
SCRUM-208 vs SCRUM-198 → `src/helper/cookie/index.ts -> getSignedCookie()`.

`act` accepts either spelling of a key (`SCRUM-208` or `PLANT-1`) and always writes to the
Jira key.

## Before recording

1. `.env` filled in, `npm install`, `target/hono` cloned, `npm run index` done. `data/records/` full.
2. Run the reset procedure at the bottom so every ticket is clean. Once, before the first take:
   delete SCRUM-207 ("Finish PR review and release notes"), a stray draft from an early Agent 1
   run before the commitment filter existed, so the backlog shows only real drafts.
3. Run Phase E on both demo tickets and confirm the verdicts before going on camera:
   `npm run check -- SCRUM-208` prints verdict SCRUM-208 / SCRUM-198, dependency_break, 0.9,
   code path `src/helper/cookie/index.ts -> getSignedCookie()`, and the line
   "Checked against 9 related tickets, 3 conflict(s) found." (the other two are real overlaps
   on the same helpers). `npm run check -- SCRUM-210` prints SCRUM-210 / SCRUM-205,
   dependency_break, 0.92, `src/utils/url.ts -> getPath()`.
4. Dry run the whole sheet once with `--dry` on each `act` command. Nothing is posted. Then reset.
5. Browser tabs open in this order: SCRUM-205, SCRUM-210, SCRUM-208, SCRUM-198, and the backlog
   filter `project = SCRUM AND labels = agent-conflict ORDER BY key`.
6. Terminal: repo root, font large, `MODE` unset (Accept is the default).
7. If the webhook server is part of the take (step 3 option B), start it in a second terminal
   before recording: `npm run serve`.

## The take

### 1. Stand-up audio (0:00 to 0:30)

Screen: the Jira backlog filter tab, currently empty, or the ElevenLabs audio waveform.
Play the generated stand-up. The line that matters is Dev's: he will build `hono/path` on top of
`getPath` from `utils/url`.

### 2. Agent 1 creates drafts (0:30 to 0:45)

Screen: terminal. Then switch to the SCRUM-205 tab.

```bash
npm run meeting -- demo/standup.txt
```

Expect: "2 commitment(s) found": Dev's hono/path helper and Priya's Retry-After. Maya's
PR-review item is filtered out as not a code change. Agent 1 deduplicates against Jira, so on
a repeat run each one is reported as `skipped, exists as SCRUM-205` (and SCRUM-206) instead
of being created again. The command is safe to run live and the keys stay the same. On the SCRUM-205
tab the label `agent-draft` must be visible.

### 3. Agent 2 flags the draft (0:45 to 1:00)

Option A, command:

```bash
npm run act -- SCRUM-205
```

Option B, webhook server already running; this stands in for the Jira webhook:

```bash
curl -X POST localhost:3123/trigger/SCRUM-205?event=created
```

Expect in the terminal:

```
SCRUM-205: 1 verdict(s) ...
  ok   comment on SCRUM-205: [agent-proposed] Possible dependency break with SCRUM-210 (confidence 92%)
  ok   label SCRUM-205 += agent-conflict
  ok   label SCRUM-210 += agent-conflict
held for approval (1); add label agent-approved then run with --apply:
  - link SCRUM-210 -[Relates]-> SCRUM-205
```

Screen: reload the SCRUM-205 tab. The label `agent-conflict` is on the ticket. Scroll to the
new comment.

### 4. The conflict comment (1:00 to 1:20)

Screen: SCRUM-205, comment in full view. It reads, in this shape:

```
[agent-proposed] Possible dependency break with SCRUM-210 (confidence 92%)

SCRUM-205 says: "<the line about building on getPath from utils/url>"

SCRUM-210 says: "<the line about removing the getPath export from src/utils/url.ts>"

Code path: src/utils/url.ts -> getPath()

Proposed action: link SCRUM-205 <-> SCRUM-210 (Relates). To approve, add the label
agent-approved to this ticket; the agent will then link the pair. -- Backlog Conflict Agent
```

Hover or point at the two quoted lines, then the code path. Optional: click through to the
SCRUM-210 tab to show it carries `agent-conflict` too.

### 5. Accept mode: human approves (1:20 to 1:35)

Screen: SCRUM-205. Click the labels field, add `agent-approved`, save. Then terminal:

```bash
npm run act -- SCRUM-205 --apply
```

Or, if the server is running, the webhook shape Jira sends on that label change:

```bash
curl -X POST localhost:3123/webhook -H 'Content-Type: application/json' -d '{"webhookEvent":"jira:issue_updated","issue":{"key":"SCRUM-205"},"changelog":{"items":[{"field":"labels","fromString":"agent-conflict agent-draft","toString":"agent-approved agent-conflict agent-draft"}]}}'
```

Expect: `ok   link SCRUM-210 -[Relates]-> SCRUM-205` and an `[agent-applied]` comment.

Screen: reload SCRUM-205. The "Linked issues" section shows SCRUM-210 under "relates to". The
`[agent-applied]` comment is at the bottom.

### 6. Auto mode: no approval (1:35 to 1:50)

Screen: the SCRUM-208 tab, clean, no agent labels. This is the planted ticket that rips out the
signed cookie helpers. Terminal:

```bash
MODE=auto npm run act -- SCRUM-208
```

On Windows PowerShell:

```bash
$env:MODE='auto'; npm run act -- SCRUM-208
```

Expect: comment, both labels, and the link in a single run, `held for approval` absent. Phase E
finds three conflicts for SCRUM-208 (SCRUM-198 plus two other signed-cookie tickets), so the
run posts three proposal comments and three links; the take narrates the SCRUM-198 one:

```
  ok   comment on SCRUM-208: [agent-proposed] Possible dependency break with SCRUM-198 (confidence 90%)
  ok   label SCRUM-208 += agent-conflict
  ok   label SCRUM-198 += agent-conflict
  ok   link SCRUM-208 -[Relates]-> SCRUM-198
```

Screen: reload SCRUM-208. Label and link present, nobody clicked anything. The comment quotes
SCRUM-198 ("jwt middleware ... needs to be able to handle signed cookies") against SCRUM-208
("Delete getSignedCookie, setSignedCookie and generateSignedCookie from
src/helper/cookie/index.ts"), code path `src/helper/cookie/index.ts -> getSignedCookie()`.

### 7. The backlog number (1:50 to 2:00)

Screen: the backlog filter tab, reload. Every ticket the agent touched is listed under
`agent-conflict`. Terminal, if Phase E is on main:

```bash
npm run check -- --all
```

Expect the one sentence: "Caught 4 of 6 planted conflicts with 3 false positives across 206
tickets." Hold on it. End.

## Reset between takes

The agent only ever adds; it never deletes. Undo by hand in Jira, in this order.

1. **Links.** On SCRUM-205 and SCRUM-208, open "Linked issues", hover the link, click the x.
   One removal clears both sides.
2. **Labels.** On SCRUM-205: remove `agent-approved` and `agent-conflict`, keep `agent-draft`.
   On SCRUM-198, SCRUM-208, SCRUM-210: remove `agent-conflict`.
3. **Comments.** Every run posts a new comment and the agent cannot delete them, so a take
   without a reset shows duplicates. Delete the `[agent-proposed]` and `[agent-applied]`
   comments on SCRUM-205 and SCRUM-208 via the comment's "..." menu, or leave them and scroll
   past. Comments on other tickets are harmless.
4. **Drafts.** Nothing to do: Agent 1's dedupe means step 2 creates no new tickets. If a draft
   was deleted by mistake, `npm run meeting` recreates it under a new key; use that key.
5. **Terminal.** Unset `MODE` (`Remove-Item Env:MODE` on PowerShell, `unset MODE` elsewhere).
6. If the server was used, restart it so any in-flight run is gone: Ctrl+C, `npm run serve`.

Jira does not create a second identical link, so a missed link removal is not fatal. A missed
label removal is: step 3 would post the proposal but step 5 would find the ticket already
approved and skip.

## Appendix: fallback verdict for SCRUM-205 if `npm run check` fails on the day

Phase E is on main and `act` calls it first, so this is only insurance. If `check` errors (LLM
key, rate limit), put this in `data/verdicts/SCRUM-205.json` and `act` uses it instead.

```json
{
  "candidates": 4,
  "verdicts": [
    {
      "pair": ["SCRUM-205", "SCRUM-210"],
      "type": "dependency_break",
      "confidence": 0.93,
      "evidence": {
        "ticket_a_line": "Build hono/path on top of getPath from utils/url so the percent-decoding loop is not duplicated a third time.",
        "ticket_b_line": "Remove the getPath and getPathNoStrict exports from src/utils/url.ts.",
        "code_path": "src/utils/url.ts -> getPath()"
      }
    }
  ]
}
```
