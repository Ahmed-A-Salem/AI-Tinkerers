# Submission copy

Paste into the portal field by field. Replace the `[ ]` placeholders first.

## Project name

Backlog Conflict Agents

## Tagline

Two agents inside Jira that turn meetings into tickets and catch backlog conflicts against the real code before anyone writes it.

## Description

Two agents that live inside Jira, with comments, labels, and links as the only interface. Agent 1 reads a meeting transcript and turns each concrete commitment into a draft ticket. Agent 2 checks every created or updated ticket against the rest of the backlog and the codebase's import graph, then comments with both quoted lines and the connecting code path, labels the ticket, and links the pair. Accept, Auto, and Risk-gated modes decide what waits for a human. It never edits a ticket.

## Result

Caught 4 of 6 planted conflicts with 3 false positives across 206 tickets.

## Tech stack

TypeScript, Jira REST API, gpt-5-mini via OpenAI, ts-morph code index, Trigger.dev task plus webhook server, ElevenLabs narration.

## Links

- Repo: https://github.com/Ahmed-A-Salem/AI-Tinkerers
- Video: `demo/demo.mp4` in the repo, or [UPLOADED_VIDEO_LINK]
- Writeup: https://github.com/Ahmed-A-Salem/AI-Tinkerers/blob/main/docs/WRITEUP.md

## How to run

Follow the README at https://github.com/Ahmed-A-Salem/AI-Tinkerers#setup.
Copy `.env.example` to `.env`, then `npm install`, clone `honojs/hono` into `target/hono`, and `npm run index`.
The "Run order" section walks through extract, check, act, and the meeting agent one command at a time.
