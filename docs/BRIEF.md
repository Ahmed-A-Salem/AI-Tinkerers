# Handoff Brief — Backlog Conflict Agents

**Event:** AI Tinkerers "Agents, Everywhere" Global Hackathon, Paris, Sat 12 Sep 2026
**Build window:** 11:15–15:30. Submission portal closes 15:30. Hard stop.
**Team:** Ahmed, Ather (has built agents before), plus possible teammates picked up at 11:00.
**This session's job:** implement. All product and architecture decisions below are already made. Do not re-open them unless blocked. Open items are marked `[OPEN]`.

---

## 1. One-liner

Two agents living inside Jira. One turns meeting commitments into draft tickets. The other checks every ticket against the backlog *and the codebase* for hidden conflicts — dependency breaks, ordering problems — and acts on what it finds, with a human-in-the-loop mode and an autonomous mode.

## 2. Why this idea (for the writeup, not for debate)

Backlogs contradict themselves invisibly. Two tickets specify different values for the same parameter. One ticket removes a function another depends on. Two tickets solve the same problem in different places. Nobody notices until PRs collide, because nobody reads 200 tickets at once and nobody compares a new ticket against all of them — and nobody checks tickets against the actual code.

The value cannot be reproduced in a standalone chatbox: it requires read access to the whole backlog and the repo, and it acts inside the tool where the tickets live.

## 3. Judging rubric — what we're optimizing for

Four criteria, each 1–5:
- **Core Functionality** — working agent, end-to-end, inside a real work environment
- **Innovation & Theme** — caps at 2 if the environment is "mostly a wrapper"; 5 requires value that could not exist in a chatbox
- **Technical Execution** — caps at 2 for "superficial integrations"; 5 wants orchestration, failure handling, deep integration
- **Usefulness & Agentic Experience** — 4 requires "native to its environment"; 5 requires "clear and controllable"

Three of four criteria score the *integration*, not the intelligence. Every decision below follows from that.

## 4. Decisions made (do not re-litigate)

| Decision | Choice | Reason |
|---|---|---|
| Environment | **Jira** via Atlassian MCP (`https://mcp.atlassian.com/v1/mcp`) | Scores highest on "place people already work"; MCP path exists |
| Fallback | Linear, if Jira auth not working by **12:15** | Don't burn an hour on Atlassian permissions |
| Language | **TypeScript**, single runtime | Trigger.dev is TS-native; ts-morph indexes a TS target repo; no mixed stack |
| Target repo | A mid-size **TypeScript** open-source project, 200–500 files, with real GitHub issue history | Same language as the stack so one parser covers both. `[OPEN: which repo]` |
| Backlog data | Real issues imported from the target repo's GitHub into a fresh Jira project | Removes the "it's mocked" objection |
| Planted conflicts | 6 conflicts inserted into the imported backlog, ground truth recorded | Needed to prove it works — see §9 |
| Models | OpenAI (marquee sponsor, credits provided). OpenRouter as fallback | Who's judging |
| Background jobs | **Trigger.dev** for event-driven runs | Sponsor; fits the trigger model; integration-depth points |
| Trigger model | Event-driven on ticket create/update, not batch | Reads as an agent, not a script |
| UI | Jira comments and labels **are** the UI. No separate panel unless a teammate wants CopilotKit and it's free | Native to environment |
| Approval flow | Inside Jira — label/status transition, not a separate UI | Nobody leaves Jira |
| Demo audio | ElevenLabs narration over screen recording; also generate the demo *meeting* with ElevenLabs multi-voice | Saves recording time; makes pipeline visibly end-to-end |

## 5. Architecture

```
GitHub repo ──► Code Index (ts-morph) ──► symbol→file map + import graph
                                                  │
Jira backlog ──► Ticket Extractor ──► structured records ──┤
                                                  │
Meeting transcript ──► AGENT 1 ──► draft tickets (labelled) ──► Jira
                                                  │
Jira webhook (ticket created/updated) ──► Trigger.dev ──► AGENT 2
                                                  │
                        ┌─────────────────────────┴───────────────┐
                        ▼                                         ▼
                 Retrieve candidates                      Compare shortlist
                 (component/entity/file overlap)          (LLM, with code graph)
                        │                                         │
                        └──────────────► Conflict verdicts ◄──────┘
                                                  │
                                    Mode gate (Accept / Auto)
                                                  │
                                    Jira actions: comment, link, label
```

**Agents never talk to each other directly. Jira is the message bus.** Agent 1 creates a draft ticket → webhook fires → Agent 2 wakes. This is both the architecture story and true to the theme.

### 5.1 Code Index
- Input: cloned target repo
- Tool: `ts-morph`
- Output: `symbols.json` (symbol → file, exported/not), `imports.json` (file → files it imports)
- Built once at setup, ~50–100 lines. Do this early — it's on the critical path for Agent 2.

### 5.2 Ticket → Code Mapping (**the hard problem — decide by 12:00**)
Tickets rarely name files. Chosen approach: **LLM predicts affected files from ticket text, given the file tree in context.** Test on 5 real tickets before building on it. If accuracy is bad, fallback: require tickets to mention a component and match on that.

Each ticket becomes a structured record:
```json
{
  "key": "PROJ-123",
  "components": ["auth", "session"],
  "files_touched": ["src/auth/session.ts"],
  "behaviors_asserted": ["session timeout is 30s"],
  "values_specified": {"session_timeout": "30s"},
  "removes": ["refreshToken()"],
  "depends_on": ["PROJ-98"]
}
```
One cheap call per ticket, cached. Re-run only on ticket update.

### 5.3 Agent 2 — Backlog Conflict Agent (**build first**)
Fires on ticket create/update. Compares the changed ticket against open backlog.

**Retrieval before comparison.** Pairwise is O(N²) — 200 tickets = 20k calls. Instead: candidate pairs by overlap on `components`, `files_touched`, or named symbols. Expect ~150 candidates from 200 tickets. Only the shortlist goes to the LLM.

**Conflict types for the demo (two, both need the code graph):**
1. **Dependency break** — Ticket A relies on a symbol/behavior that Ticket B removes or changes. Detected via `removes` ∩ (symbols imported by A's files).
2. **Ordering** — B is only correct if A ships first, and nothing says so. Detected via `depends_on` gaps + import graph.

Value conflict and duplicate work are stretch — add only if both above work by 14:00.

**Verdict schema:**
```json
{
  "pair": ["PROJ-123", "PROJ-140"],
  "type": "dependency_break",
  "confidence": 0.92,
  "evidence": {
    "ticket_a_line": "...",
    "ticket_b_line": "...",
    "code_path": "src/auth/session.ts → refreshToken()"
  }
}
```

**On no conflict:** post a short comment — "Checked against 3 related tickets, no conflicts found." Silence looks like it didn't run.

### 5.4 Agent 1 — Meeting Agent (**build last, cut if needed**)
Input: pasted transcript. No live transcription, no audio processing.
- Extract commitments (things someone agreed to do)
- Convert each to a draft ticket: title, description, acceptance criteria
- Create in Jira under label `agent-draft`, never published as a normal ticket
- Creation fires the webhook → Agent 2 runs on the draft automatically

For the demo, the transcript is a two-minute stand-up script rendered with ElevenLabs (2–3 voices) where someone commits to something that conflicts with a planted backlog ticket.

### 5.5 Modes
Both modes run the identical pipeline and produce identical proposed actions. The only difference is whether the action waits.

- **Accept mode (default):** Agent posts proposed action as a comment tagged `agent-proposed`. A human adds label `agent-approved` or transitions status → webhook → agent applies.
- **Auto mode:** Same, no wait.
- **Risk-gated (preferred if time):** Auto-apply reversible low-stakes actions (link, label, comment). Require approval for meaning-changing actions (edit description, create non-draft ticket, change assignee/priority). Confidence gate: ≥0.9 acts, <0.9 asks.

Build Accept first. Auto is a flag. Risk-gating is a switch statement on action type.

**Allowed actions:**
- Agent 2: comment, link pair, add label. Never edits descriptions autonomously.
- Agent 1: create draft under label only.

## 6. Build order with cut points

Time gates are real. If a gate is missed, cut from the bottom of this list, never the top.

| Step | Owner `[OPEN]` | Gate |
|---|---|---|
| 0. Pick target repo, clone, import issues into fresh Jira project | — | 11:45 |
| 1. Jira auth + read issues + write a test comment (riskiest unknown, do first) | — | **12:15 — else switch to Linear** |
| 2. Code index (ts-morph → symbols.json, imports.json) | — | 12:30 |
| 3. Ticket extractor → structured records, cached | — | 12:45 |
| 4. Ticket→code mapping — test on 5 tickets, commit or fallback | — | **12:00 decision, 13:00 working** |
| 5. Retrieval + comparison on planted conflicts | — | **13:30 — end-to-end on one example or cut features** |
| 6. Write-back: comment + link + label, Accept mode | — | 14:00 |
| 7. Trigger.dev webhook wiring (event-driven) | — | 14:15 |
| 8. Auto mode / risk gating | — | 14:30 |
| 9. Agent 1: transcript → drafts | — | 14:30 — **cut if step 5 slipped** |
| 10. ElevenLabs meeting + narration, record video | — | 15:00 |
| 11. Writeup, social post, submit | — | 15:30 |

**Steps 0–6 alone are a complete, submittable product.** Everything after is upside.

Hardcode anything not on the demo path. One tested demo input, run twenty times before recording.

## 7. Demo script (2 minutes)

1. (0:00) Synthetic stand-up plays — three voices, ~30s. Someone says "I'll rip out the refresh token flow this sprint."
2. (0:30) Agent 1 produces two draft tickets in Jira, labelled `agent-draft`.
3. (0:45) Agent 2 wakes on the webhook. One draft goes red: dependency break against PROJ-xxx.
4. (1:00) Click into the conflict comment: both contradicting lines quoted, code path shown (`src/auth/session.ts → refreshToken()`).
5. (1:20) Accept mode: human adds `agent-approved` → agent links the pair.
6. (1:35) Flip to Auto mode, touch a second ticket, agent links it without asking. Fifteen seconds.
7. (1:50) Close on the backlog view: N conflicts caught, one number from §9.

Narration: ElevenLabs. Write the script *before* building — it defines "done."

## 8. Submission checklist

- [ ] Title — name `[OPEN]`
- [ ] Written description: what, for whom, why the environment matters, the retrieval architecture, the §9 number
- [ ] Public GitHub repo with README that lets a judge run it
- [ ] 2-minute video
- [ ] Social post tagging sponsors — owner `[OPEN]`, assigned by 14:00
- [ ] Video owner `[OPEN]`, assigned by 14:00

## 9. Proving it works

Six conflicts planted, ground truth recorded in `planted.json`. Run the full backlog once. Report precision/recall in one sentence in the writeup: (illustrative example from the brief; the measured result is in `docs/WRITEUP.md`) *"Caught 5 of 6 planted conflicts with 1 false positive across 200 tickets."* This sentence is worth more than a paragraph of architecture.

## 10. Open decisions

- `[OPEN]` Target repo (TypeScript, 200–500 files, real issue history)
- `[OPEN]` Project name
- `[OPEN]` Role assignments once team is formed
- `[OPEN]` Video owner, post owner
- `[OPEN]` Whether a teammate builds a CopilotKit panel (only if free)

## 11. Things that will go wrong

- **Jira OAuth** — most likely hour-eater. Gate at 12:15, switch to Linear.
- **Ticket→code mapping accuracy** — test early. If it's noisy, restrict demo to tickets that name components.
- **Webhook doesn't fire locally** — use Trigger.dev's dev tunnel or a manual trigger endpoint as fallback. Don't debug ngrok at 14:30.
- **Portal slow at 15:25** — submit at 15:10.
- **Auto mode does something bold on camera** — make sure the auto action in the demo is a link, not an edit.
