# AI Tinkerers hackathon — Backlog Conflict Agents

## Project

Two agents living inside Jira. Agent 1 turns meeting-transcript commitments into draft
tickets. Agent 2 checks every created/updated ticket against the backlog *and the target
codebase* for dependency breaks and ordering conflicts, then comments / links / labels in
Jira, with an Accept (human-in-the-loop) mode and an Auto mode.

**Full spec: `docs/BRIEF.md`.** All product and architecture decisions are made there.
Do not re-open them unless blocked. Hard stop: submission portal closes **15:30** today.

Key constraints (from the brief):
- TypeScript only, single runtime. Trigger.dev for event-driven runs. ts-morph for the code index.
- Jira via Atlassian MCP (`https://mcp.atlassian.com/v1/mcp`). Fallback to Linear if auth isn't working by 12:15.
- Models: OpenAI first, OpenRouter fallback.
- Jira comments and labels ARE the UI. No separate panel.
- Agent 2 may only comment, link, and label. Never edit descriptions autonomously.
- Agent 1 may only create tickets under label `agent-draft`.
- Build order and cut points are in brief §6. Steps 0–6 alone are a submittable product.
  If a gate is missed, cut from the bottom, never the top.

Interface contracts every module must respect:
- Ticket structured record: brief §5.2 JSON shape.
- Conflict verdict: brief §5.3 JSON shape.
- Code index outputs: `symbols.json` (symbol → file, exported flag) and `imports.json` (file → imported files).

## Working agreement

- Two people (Ahmed and Ather) work from one shared plan: `coordination/PLAN.md`. It is split
  into independent phases; each phase card is self-contained. Read the "Fresh session bootstrap"
  section and your phase card. Do not edit the plan; report to your orchestrator session
  (CLAIM before starting, DONE with acceptance output when finished, BLOCKED if stuck).
- **No unit tests.** A phase is done when its acceptance check in the plan passes against real
  data or real Jira. Run the check, paste the output in your DONE message.
- Interfaces between phases are files under `data/` and `npm run` commands, so phases can be
  built and verified in isolation. Use a hand-written sample input if the upstream phase isn't
  done yet; the plan says where.
- Stay inside the files/areas your task owns. If you need to touch another owner's area, ask
  your orchestrator first; it knows what the other side is doing.
- `coordination/` is inter-session plumbing (message bus, orchestration notes). It is not part
  of the product. Ignore it unless you are an orchestrator session.
- **Orchestrator sessions only:** read `coordination/ORCHESTRATION.md` for the full procedure.
