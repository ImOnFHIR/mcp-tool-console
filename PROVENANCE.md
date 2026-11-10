# Provenance

Moved from [ImOnFHIR/member-match-decoy-lab](https://github.com/ImOnFHIR/member-match-decoy-lab) at commit `f851f0e3247b9ba489ec889e239d6179db7b1927` (2026-11-07). Same author, same licence (Apache-2.0). Its git history for these files stays in that repo.

| Here | From | Changed on the way |
|---|---|---|
| `src/tool-meta.ts` | same path | Doc pointer now names this README |
| `src/ui/view.ts`, `render.ts`, `form.ts`, `styles.ts` | same paths | None |
| `src/ui/browser/console-main.ts` | same path | "Copy as Inspector command" uses each server's own launch line, not one tool's hard-coded command |
| `src/console/config.ts`, `http.ts` | same paths | None |
| `src/console/hub.ts` | same path | `overview()` adds `launch` (how to start the server by hand) |
| `src/console/cli.ts` | same path | Runnable as the `mcp-tool-console` command; finds its page inside the package; reads config from the folder it is run in |
| `scripts/ui-build.mjs` | same path | Builds the console page only. The decoy lab's in-Claude view build stays there. |
| `scripts/test.mjs`, `docs/tool-view.schema.json`, `test/helpers/fake-mcp.ts` | same paths | None |
| `test/console.test.ts` | same path | The decoy-tool run moved back to that repo; adds checks for `launch` and the command's page path |
| `test/ui-render.test.ts` | same path | Reads a saved input schema instead of starting the decoy lab's server |
| `test/views/*.json` | same paths | None (synthetic) |
| `test/schemas/score-member-match.input.json` | new | Saved from that repo's `score_member_match` tool listing (synthetic case names) |
| `src/index.ts`, `src/console/index.ts` | new | Package entry points |

Every name in the test data is synthetic. It passed that repo's leak guard (`npm run leak:check`) before the move.

## Registry overlay fixtures

| Here | From | Notes |
|---|---|---|
| `test/fixtures/registry-overlay/server.schema.2025-12-11.json` | The MCP Registry's published server.json schema, <https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json> | Byte-identical copy, unmodified. sha256 `3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0`, pinned in `test/registry-overlay.test.ts`. |
| `docs/registry-overlay.schema.json`, `test/fixtures/registry-overlay/negative/*.json`, `valid.json` | Written by this repo's author | Synthetic (`example.com` names). |

