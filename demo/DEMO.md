# Demo run sheet

Two minutes, brief §7. Terminal on the left, Jira on the right. Narration is `demo/narration.txt`;
each step below has the same number as its narration block.

Tickets used. `PLANT-n` keys are assigned by the import and will be filled in here once known.

| Role | Key | What it is |
|---|---|---|
| Agent 1 draft | SCRUM-205 | "Add hono/path helper with matchedPath and basePath", created from the stand-up |
| Its conflict | PLANT-3 = `SCRUM-___` | "perf: fold getPath and getPathNoStrict into one internal path parser", removes `getPath` |
| Auto-mode ticket | SCRUM-198 | GitHub #2398 "Use Signed Cookies in jwt Middleware" |
| Its conflict | PLANT-1 = `SCRUM-___` | "Remove signed cookie helpers (getSignedCookie / setSignedCookie) from hono/cookie" |

Expected code paths: SCRUM-205 vs PLANT-3 → `src/utils/url.ts -> getPath()`.
SCRUM-198 vs PLANT-1 → `src/helper/cookie/index.ts -> getSignedCookie()`.

## Before recording

1. `.env` filled in, `npm install`, `target/hono` cloned, `npm run index` done. `data/records/` full.
2. Run the reset procedure at the bottom so every ticket is clean.
3. Confirm the verdicts exist before going on camera. Either `npm run check -- SCRUM-205` and
   `npm run check -- SCRUM-198` (Phase E), or, if `check` is not on main yet, the two fallback
   verdict files in the appendix are in `data/verdicts/`.
4. Dry run the whole sheet once with `--dry` on each `act` command. Nothing is posted. Then reset.
5. Browser tabs open in this order: SCRUM-205, PLANT-3, SCRUM-198, PLANT-1, and the backlog
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

Expect: "3 commitment(s) found" and three keys printed. Only the first two are code changes
(hono/path helper, Retry-After); the third, PR review, is created as a draft by design of the
current filter and is not shown.

If you re-run this on camera the keys will be new (SCRUM-208 and up). Either use the keys it
prints for the rest of the take, or skip the command and show SCRUM-205 as already created.
The label `agent-draft` must be visible on the ticket.

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
  ok   comment on SCRUM-205: [agent-proposed] Possible dependency break with SCRUM-___ (confidence NN%)
  ok   label SCRUM-205 += agent-conflict
  ok   label SCRUM-___ += agent-conflict
held for approval (1); add label agent-approved then run with --apply:
  - link SCRUM-___ -[Relates]-> SCRUM-205
```

Screen: reload the SCRUM-205 tab. The label `agent-conflict` is on the ticket. Scroll to the
new comment.

### 4. The conflict comment (1:00 to 1:20)

Screen: SCRUM-205, comment in full view. It reads, in this shape:

```
[agent-proposed] Possible dependency break with SCRUM-___ (confidence NN%)

SCRUM-205 says: "<the line about building on getPath from utils/url>"

SCRUM-___ says: "<the line about removing the getPath export from src/utils/url.ts>"

Code path: src/utils/url.ts -> getPath()

Proposed action: link SCRUM-205 <-> SCRUM-___ (Relates). To approve, add the label
agent-approved to this ticket; the agent will then link the pair. -- Backlog Conflict Agent
```

Hover or point at the two quoted lines, then the code path. Optional: click through to the
PLANT-3 tab to show it carries `agent-conflict` too.

### 5. Accept mode: human approves (1:20 to 1:35)

Screen: SCRUM-205. Click the labels field, add `agent-approved`, save. Then terminal:

```bash
npm run act -- SCRUM-205 --apply
```

Or, if the server is running, the webhook shape Jira sends on that label change:

```bash
curl -X POST localhost:3123/webhook -H 'Content-Type: application/json' -d '{"webhookEvent":"jira:issue_updated","issue":{"key":"SCRUM-205"},"changelog":{"items":[{"field":"labels","fromString":"agent-conflict agent-draft","toString":"agent-approved agent-conflict agent-draft"}]}}'
```

Expect: `ok   link SCRUM-___ -[Relates]-> SCRUM-205` and an `[agent-applied]` comment.

Screen: reload SCRUM-205. The "Linked issues" section shows PLANT-3 under "relates to". The
`[agent-applied]` comment is at the bottom.

### 6. Auto mode: no approval (1:35 to 1:50)

Screen: the SCRUM-198 tab, clean, no labels. Terminal:

```bash
MODE=auto npm run act -- SCRUM-198
```

On Windows PowerShell:

```bash
$env:MODE='auto'; npm run act -- SCRUM-198
```

Expect: comment, both labels, and the link in a single run, `held for approval` absent:

```
  ok   comment on SCRUM-198: [agent-proposed] Possible dependency break with SCRUM-___ ...
  ok   label SCRUM-198 += agent-conflict
  ok   label SCRUM-___ += agent-conflict
  ok   link SCRUM-198 -[Relates]-> SCRUM-___
```

Screen: reload SCRUM-198. Label and link present, nobody clicked anything. The comment's code
path is `src/helper/cookie/index.ts -> getSignedCookie()`.

### 7. The backlog number (1:50 to 2:00)

Screen: the backlog filter tab, reload. Every ticket the agent touched is listed under
`agent-conflict`. Terminal, if Phase E is on main:

```bash
npm run check -- --all
```

Expect the one sentence: "Caught N of 6 planted conflicts with M false positives across 206
tickets." Hold on it. End.

## Reset between takes

The agent only ever adds; it never deletes. Undo by hand in Jira, in this order.

1. **Links.** On SCRUM-205 and SCRUM-198, open "Linked issues", hover the link, click the x.
   One removal clears both sides.
2. **Labels.** On SCRUM-205: remove `agent-approved` and `agent-conflict`, keep `agent-draft`.
   On SCRUM-198, PLANT-1, PLANT-3: remove `agent-conflict`.
3. **Comments.** Every run posts a new comment and the agent cannot delete them, so a take
   without a reset shows duplicates. Delete the `[agent-proposed]` and `[agent-applied]`
   comments on SCRUM-205 and SCRUM-198 via the comment's "..." menu, or leave them and scroll
   past. Comments on other tickets are harmless.
4. **Drafts.** If step 2 was run on camera, the new `agent-draft` tickets stay. Move them to
   Done or delete them in Jira so the next take starts with SCRUM-205 only.
5. **Terminal.** Unset `MODE` (`Remove-Item Env:MODE` on PowerShell, `unset MODE` elsewhere).
6. If the server was used, restart it so any in-flight run is gone: Ctrl+C, `npm run serve`.

Jira does not create a second identical link, so a missed link removal is not fatal. A missed
label removal is: step 3 would post the proposal but step 5 would find the ticket already
approved and skip.

## Appendix: fallback verdicts if `npm run check` is not available

Put these in `data/verdicts/SCRUM-205.json` and `data/verdicts/SCRUM-198.json` with the
`PLANT-n` keys replaced by the real ones. `act` reads them when there is no `checkTicket`.
Remove them once Phase E lands so the real verdicts are used.

`data/verdicts/SCRUM-205.json`:

```json
{
  "candidates": 4,
  "verdicts": [
    {
      "pair": ["SCRUM-205", "PLANT-3"],
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

`data/verdicts/SCRUM-198.json`:

```json
{
  "candidates": 3,
  "verdicts": [
    {
      "pair": ["SCRUM-198", "PLANT-1"],
      "type": "dependency_break",
      "confidence": 0.91,
      "evidence": {
        "ticket_a_line": "Set up a signed cookie with jwt: await setSignedCookie(c, 'session', await sign(payload, secret), ...) and read it back with jwt({ cookie }).",
        "ticket_b_line": "Delete getSignedCookie, setSignedCookie and generateSignedCookie from src/helper/cookie/index.ts.",
        "code_path": "src/helper/cookie/index.ts -> getSignedCookie()"
      }
    }
  ]
}
```
