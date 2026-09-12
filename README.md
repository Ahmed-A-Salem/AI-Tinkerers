# Backlog Conflict Agents

Two agents that live inside Jira and act through Jira comments, labels, and links. There is no
separate UI.

- **Agent 1, Meeting Agent.** Reads a meeting transcript, extracts the commitments people made,
  and creates one draft ticket per commitment under the label `agent-draft`. It never creates
  anything else and never edits existing tickets.
- **Agent 2, Backlog Conflict Agent.** Fires whenever a ticket is created or updated. It compares
  the ticket against the rest of the backlog *and against the target codebase* (a symbol and
  import graph built with ts-morph) to find dependency breaks and ordering conflicts. It then
  posts a comment quoting both conflicting lines and the code path, labels the ticket
  `agent-conflict`, and, once a human adds `agent-approved`, links the pair. In Auto mode it
  links without waiting. Agent 2 can only comment, link, and label. It has no code path that
  edits a description.

Target backlog for the demo: 200 open issues from [honojs/hono](https://github.com/honojs/hono)
imported into a Jira project, plus six planted conflicts with recorded ground truth.

Full design: [docs/BRIEF.md](docs/BRIEF.md). Writeup: [docs/WRITEUP.md](docs/WRITEUP.md).

## Requirements

- Node 20 or newer (uses the built-in `fetch`).
- A Jira Cloud site and an API token (id.atlassian.com, Security, API tokens).
- An OpenAI API key. OpenRouter works as a fallback when no OpenAI key is set.

## Environment

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `JIRA_BASE_URL` | `https://<site>.atlassian.net` |
| `JIRA_EMAIL` | Account the API token belongs to |
| `JIRA_API_TOKEN` | Atlassian API token (REST backend) |
| `JIRA_PROJECT_KEY` | Project the backlog is imported into, e.g. `SCRUM` |
| `JIRA_MCP_TOKEN` | Optional. Atlassian MCP OAuth token; when set it is used instead of REST. Force one with `JIRA_BACKEND=rest\|mcp` |
| `OPENAI_API_KEY` | Primary LLM provider |
| `OPENROUTER_API_KEY` | Optional fallback, used only when `OPENAI_API_KEY` is absent |
| `LLM_MODEL` | Model id, default `gpt-5-mini` |
| `MODE` | `accept` (default) or `auto`. See "Modes" below |

## Setup

```bash
npm install
```

```bash
git clone --depth 1 https://github.com/honojs/hono target/hono
```

```bash
npm run index
```

`npm run index` builds the code graph from `target/hono/src` into `data/symbols.json`
(symbol to file, exported flag), `data/imports.json` (file to imported files), and
`data/symbol-collisions.json` (names declared in more than one file).

To confirm the Jira credential works before anything writes:

```bash
npx tsx scripts/jira-smoke.ts
```

## Loading the backlog

`data/hono-issues.json` already holds the 200 issues plus the six planted tickets. To create
them in your Jira project:

```bash
npm run import:issues -- --go
```

Without `--go` it is a dry run. The script is re-runnable; it skips issues already created and
writes the GitHub-to-Jira key mapping to `data/gh-to-jira.json`.

## Run order

Each step reads files from the previous one under `data/`, so each can be run and checked on
its own.

1. **Extract ticket records** (one cheap LLM call per ticket, cached in `data/records/`):

   ```bash
   npm run extract
   ```

   `npm run extract -- <KEY>` forces one ticket. A second run reports every ticket as cached and
   makes no LLM calls.

2. **Map a ticket to code** (landing; Phase C):

   ```bash
   npm run map -- <KEY>
   ```

   Prints the files the ticket is predicted to touch. Results and the accuracy check are in
   `data/mapping-eval.md` once it lands.

3. **Check a ticket for conflicts** (landing; Phase E):

   ```bash
   npm run check -- <KEY>
   ```

   `npm run check -- --all` runs the whole backlog and prints the precision and recall sentence
   against `data/planted.json`. Verdicts are written to `data/verdicts/<KEY>.json`.

4. **Act on the verdicts in Jira** (Agent 2 write-back):

   ```bash
   npm run act -- <KEY>
   ```

   Posts one comment per conflict tagged `agent-proposed` with both quoted lines and the code
   path, and adds the label `agent-conflict`. With no conflict it posts "Checked against N
   related tickets, no conflicts found." Add `--dry` to print the actions without writing.

   After a human adds the label `agent-approved` in Jira:

   ```bash
   npm run act -- <KEY> --apply
   ```

   Links the pair. `act` uses the check step's `checkTicket` when it is present, otherwise
   `data/verdicts/<KEY>.json`, otherwise the hand-written `data/verdicts/SAMPLE.json`.

5. **Turn a meeting into draft tickets** (Agent 1):

   ```bash
   npm run meeting -- demo/standup.txt
   ```

   Creates one `agent-draft` ticket per commitment. Add `--dry` to print the commitments
   without creating anything. Created keys are appended to `data/agent1-drafts.json`.

6. **Verify the planted ground truth**:

   ```bash
   npx tsx scripts/plant.ts --check
   ```

Event-driven runs through Trigger.dev (ticket created or updated in Jira wakes Agent 2 with no
command) are landing; see `src/trigger/` once it is on main.

## Modes

Every mode runs the same pipeline and produces the same proposed actions. The mode only decides
which actions wait.

- **Accept** (default). Comments and labels post immediately, since they are the proposal. The
  link waits until a human adds `agent-approved` to the ticket.
- **Auto** (`MODE=auto`). Nothing waits.
- **Risk-gated** (landing). Actions with confidence of at least 0.9 go through, the rest wait.

Because the action type has only comment, link, and label, no mode can ever edit a ticket's
text.

## Layout

| Path | What |
|---|---|
| `src/jira/` | One `JiraClient` interface, REST and MCP backends. No update-description method by design |
| `src/index/` | ts-morph code index |
| `src/extract/` | Ticket to structured record, LLM client with provider fallback |
| `src/mapping/` | Ticket to files (landing) |
| `src/retrieval/`, `src/compare/`, `src/agent2.ts` | Candidate retrieval and LLM comparison to verdicts (landing) |
| `src/actions/` | Verdicts to Jira actions, and applying them |
| `src/modes/` | Accept gate; Auto and Risk extend it |
| `src/agent1.ts` | Meeting transcript to draft tickets |
| `src/types.ts` | The shared record, verdict, and action shapes |
| `data/` | Index outputs, issue dump, records, verdicts, planted ground truth |
| `demo/` | Stand-up transcript used in the demo |
