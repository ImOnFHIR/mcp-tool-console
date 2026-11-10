# Remaining work

Newest session first.

## Package command
Done:
- `mcp-tool-console package [--server <id>] [--out <dir>] [--runs <dir>]`, exported as `mcp-tool-console/package` (README "Packages").
- Presets are run only for tools that are `readOnlyHint: true` and declared free; every view passes `checkView`.
- A dirty tree (tracked changes in the run folder or in any selected server's repository, or no git repository) is refused: exit 1, nothing written.
- An existing output folder is replaced only if it is exactly an earlier package; case-colliding names fail the build.
- Recorded runs are shape-checked; output is deterministic; `PROVENANCE.json` carries per-file hashes and `packageDigest` (no commit SHA).
- `package/samples/` is committed, and a drift test regenerates it and compares every file and the file list.
- The fake server's tools gained presets so the gate has something to refuse.

Remaining:
- A tool repo that built its own bundle by hand moving onto this command, with its own committed package, is a separate change in that repo.
- Any site consumer pinning a `packageDigest`.
- Signed or attested provenance.

Tests: `npm test` 61/61 (47 before, plus 14 in `test/package.test.ts`). Each control was removed to confirm its test goes red.

## Review findings closed
Each of the twelve earlier `codex review` P2 findings is fixed and has a test that goes red when the fix is taken out. Console-page tests drive the built page inside happy-dom (`test/helpers/dom-page.ts`).

| # | Finding | Test |
|---|---|---|
| 1 | Preset click adds listeners each time | `console page: a preset click adds no listeners; each click is one run` |
| 2 | Result renders into another tool's page | `console page: a result never lands in another tool's page` |
| 3 | Filling a preset resets the cost tick | `console page: filling a preset leaves the cost tick as it was` |
| 4 | Settings don't fold away (`[hidden]` vs `display`) | `console page: [hidden] wins over display: grid and flex` |
| 5 | Server status not refreshed after a stop | `console page: after a server stops, the next run shows its Restart button` |
| 6 | Unticked yes/no can't send `false` | `form: an unticked yes/no sends false; a tool whose default is false is left to it` |
| 7 | Number or boolean choices come back as strings | `form: number and boolean choices come back as numbers and booleans` |
| 8 | `checkView` throws on non-list `stats`/`sections`/`next` | `checkView: stats, sections or next that aren't lists are problems, not crashes` |
| 9 | `transport.onclose` replaced the SDK's handler | `hub: a server that dies mid-call fails the call at once, not at the time limit` |
| 10 | `tools/list` pagination not followed | `hub: tools/list is followed across every page` |
| 11 | Inspector command omits the working directory | `inspector command: starts from the server's own folder` (and the page's `console page: the Inspector command starts in the server's folder and is quoted`) |
| 12 | Inspector command arguments not shell-quoted | `inspector command: every word is shell-quoted` (same page test) |

Tests: `npm test` 47/47 (28 before). Also covered, found by the review of these fixes:
- `hub: results from a tool on an earlier page are still checked against its output schema` (paging must not drop the SDK's output checks)
- `form: choices that read the same as text (1 and "1") still come back as picked`
- `form: an encoded choice never takes the place of a real text choice`
- `console page: a Try click on a folded page unfolds the form to show progress and problems`
- `hub: the overview says where a server runs, for the Inspector command`

## 2026-11-08 session (repo created)
Completed:
- Moved the tool contract, ToolView v1, renderer, form and dev console out of member-match-decoy-lab (`PROVENANCE.md`).
- README: goal, how it serves the mission, the contract, the console's safety rules.
- Fixed four safety gaps that `codex review` found in the moved code. Each has a test:
  1. a range's schema bounds could inject HTML attributes
  2. a committed config could pass environment variables, such as an API key
  3. the cost tick stayed ticked across runs
  4. a table cell's status could inject HTML; `checkView` now checks cell statuses too

Remaining: nothing from that review; the twelve findings are closed (section above).

Tests: `npm test` 28/28. Leak guard (member-match-decoy-lab's, pointed at this repo): 41 files, 0 violations. gitleaks: no leaks.
