# Agent instructions: mcp-tool-console

Codex reads this file directly. Claude Code reads it through a local `CLAUDE.md` (not committed) that imports it.

## What this repo is
The shared tool contract, ToolView v1, renderer, form builder and dev console for ImOnFHIR MCP tools. See `README.md` (goal, mission, contract) and `PROVENANCE.md`.

Maintainer-private context (plans, dates, budgets, other private repos) lives in the maintainer's own agent primer, loaded from user-level config. Never write it into this repo.

## Rules
- **No tool-specific code.** Anything about one tool lives in that tool's repo.
- **ToolView stays `v: 1`.** Add optional fields only. Renaming, removing or changing the meaning of a field means `v: 2` and needs the maintainer's yes.
- **The console's safety rules don't weaken.** Every rule listed in README "Safety rules" keeps its test in `test/console.test.ts`. Never add a way to start a command from the page, run a non-read-only tool, or pass environment variables that a local config didn't name.
- **`src/index.ts`, `render`, `form` and `styles` stay browser-safe:** no Node APIs, no network, no new runtime dependencies.
- **No AI SDK and no spending code** anywhere in this repo.
- **Synthetic data only** in tests and examples. No real people, and no names of real people from the standards community.
- **Secrets:** never open `.env*`, `.dev.vars`, keys or credential files. If you see a secret, stop and tell the maintainer the file path; never copy the value.
- Code copied from another repo carries a provenance note (`PROVENANCE.md`).
- Pin exact dependency versions.

## Working with the maintainer
- The maintainer works by voice. Keep messages short and phone-readable, and end with numbered yes/no questions. Never ask them to type a path or long text.
- For anything larger than a small fix, propose the next task and wait for a yes.

## Two agents, one repo
- Claude Code and Codex may both edit.
- **One agent per checkout at a time.** Each works on its own branch, cut from an up-to-date `main`.
- Whoever didn't write a change reviews it before the PR. Codex reviews Claude Code's changes with `codex review`; Claude Code reviews Codex's.

## Consumers
Tool repos install this one pinned to a commit. A change that alters rendered output or the console's behaviour says so in its PR, so each consumer can decide when to move its pin.

## Before you end a session
1. `npm run format`.
2. `npm run lint`. Fix findings in files you touched; don't mass-fix unrelated files.
3. `npm test`. All must pass.
4. Commit on your branch and open a PR.
