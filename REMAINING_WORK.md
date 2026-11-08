# Remaining work

Newest session first.

## 2026-11-08 session (repo created)
Completed:
- Moved the tool contract, ToolView v1, renderer, form and dev console out of member-match-decoy-lab (`PROVENANCE.md`).
- README: goal, how it serves the mission, the contract, the console's safety rules.
- Fixed four safety gaps that `codex review` found in the moved code. Each has a test:
  1. a range's schema bounds could inject HTML attributes
  2. a committed config could pass environment variables, such as an API key
  3. the cost tick stayed ticked across runs
  4. a table cell's status could inject HTML; `checkView` now checks cell statuses too

Remaining (`codex review` P2 findings, not yet fixed):
1. Console page: a preset click adds another set of listeners each time, so repeated Try clicks slow the page down.
2. Console page: a result can render into another tool's page if you navigate away while it runs.
3. Console page: filling a preset resets the visible cost tick.
4. Console page: after a run the settings don't fold away (`display: grid` overrides `[hidden]`), and the same applies to the settings line.
5. Console page: server status isn't refreshed after a server stops, so Restart can stay hidden.
6. Form: an unticked yes/no can't send `false`.
7. Form: number or boolean choices come back as strings.
8. `checkView`: `stats`, `sections` or `next` that aren't lists throw instead of returning problems.
9. Hub: assigning `transport.onclose` replaces the SDK's own handler, so a server that dies mid-call waits for the timeout.
10. Hub: `tools/list` pagination isn't followed.
11. Inspector command: it leaves out the server's working directory.
12. Inspector command: arguments aren't shell-quoted.

Tests: `npm test` 28/28. Leak guard (member-match-decoy-lab's, pointed at this repo): 41 files, 0 violations. gitleaks: no leaks.
