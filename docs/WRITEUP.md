# Backlog Conflict Agents

AI Tinkerers "Agents, Everywhere" Global Hackathon, Paris, 12 September 2026.
Team: Ahmed, Ather.

## What it is

Two agents that live inside Jira. One turns meeting commitments into draft tickets. The other
checks every created or updated ticket against the rest of the backlog and against the target
codebase, finds dependency breaks and ordering conflicts, and acts on them from inside Jira:
a comment that quotes both conflicting lines and names the code path, a label, and a link
between the two tickets. A human-in-the-loop mode holds the link until someone approves. An
autonomous mode does not wait.

## Who it is for

Teams whose backlog is large enough that nobody reads all of it. Backlogs contradict themselves
invisibly: one ticket removes a function another ticket depends on, two tickets assume different
values for the same parameter, two tickets solve the same problem in different places. Nobody
notices until pull requests collide, because nobody compares a new ticket against two hundred
others, and nobody checks a ticket against the actual code.

This cannot be done from a chat window. It needs read access to the whole backlog and the
repository, and it has to act where the tickets live.

## Why Jira comments and labels are the UI

Nobody leaves Jira. The proposal is a comment on the ticket that is affected. Approval is a label
a human adds in the ticket view. The outcome is an issue link. Every artefact the agent produces
is something a Jira user already knows how to read, search, filter, and undo. There is no panel to
open and no dashboard to learn, and the same surface works for Accept mode and Auto mode.

## Architecture: retrieve, then compare, using the code graph

The target backlog is 200 real open issues from honojs/hono imported into a Jira project, plus six
planted conflicts with recorded ground truth.

1. **Code index.** ts-morph walks the target repository and emits two files: symbol to file
   (with an exported flag) and file to imported files. Names declared in more than one file are
   kept in a collisions list so ambiguous symbols are resolved to every candidate.
2. **Ticket records.** One cheap structured LLM call per ticket reduces it to the facts the
   comparison reasons over: components, files touched, behaviours asserted, values specified,
   symbols it removes, dependencies it names. Records are cached on disk, so re-runs make no
   calls.
3. **Ticket to code mapping.** The model sees the ticket text and the repository file tree and
   returns the handful of files the ticket will touch, filtered to paths that exist.
4. **Retrieval before comparison.** Pairwise comparison of 200 tickets would be twenty thousand
   LLM calls. Instead a ticket is a candidate only if it overlaps another on components, files,
   named symbols, or an import edge between their files. That yields on the order of 150 pairs,
   and only those go to the model.
5. **Comparison.** For each candidate pair the model gets both records, both ticket texts, and
   the slice of the code graph that connects them. It returns a typed verdict: the pair, the
   conflict type, a confidence, one quoted line from each ticket, and the code path such as
   `src/utils/cookie.ts -> parse()`.
6. **Write-back.** Verdicts become actions. The action type has exactly three members: comment,
   link, label. Agent 2 has no code path that edits a ticket description, so no mode and no
   prompt can make it do so.

The two conflict types both need the code graph. A **dependency break** is a symbol one ticket
removes that files from another ticket import. An **ordering** conflict is a ticket that is only
correct if another ships first, with nothing in either ticket saying so.

## Modes

Every mode runs the same pipeline and produces the same proposed actions. The mode decides only
which ones wait.

- **Accept.** The comment and the conflict label post immediately, since they are the proposal.
  The link waits until a human adds the label `agent-approved` to the ticket.
- **Auto.** Nothing waits.
- **Risk-gated.** Reversible actions with confidence of at least 0.9 go through. Anything below
  waits. Because the action set is only comment, link, and label, the gate never has to decide
  about a meaning-changing edit.

## Agent 1: meeting to draft tickets

A stand-up transcript goes through one structured call that classifies each statement of intent.
Only concrete code-change commitments survive; "I'm on review duty" and "I might look at X" do
not. Each commitment becomes a draft ticket with a title, description, and acceptance criteria,
created under the label `agent-draft`. Creating the draft is what wakes Agent 2, so a commitment
made out loud in a meeting is checked against the backlog and the code within a minute.

## Proving it works

Six conflicts were planted in the imported backlog with the ground truth recorded in
`data/planted.json`: four dependency breaks that use real import edges from the code graph, and
two ordering conflicts. The full backlog was checked once.

> **Caught N of 6 planted conflicts with M false positives across 206 tickets.**

## Stack

TypeScript throughout, single runtime. Jira through the Atlassian REST API with an MCP backend
behind the same interface. OpenAI `gpt-5-mini` with structured output; OpenRouter as fallback.
ts-morph for the code index. Trigger.dev for event-driven runs on ticket create and update.
ElevenLabs for the demo meeting audio and narration.
