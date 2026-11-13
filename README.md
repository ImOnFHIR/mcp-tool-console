# mcp-tool-console

**Describe an MCP tool once, and people and AI can both use it, without anyone reading raw JSON.**

This repo has four parts:
- a small **tool contract**: the plain words, examples and cost of a tool
- one **result shape**, ToolView v1
- a **renderer** and **form builder** that draw both
- a local **dev console** that replaces the MCP Inspector while you build

> Test data in this repo is synthetic. Nothing here touches real people, real systems or the network.

---

## The goal

MCP lets an AI agent call a tool: validate a FHIR bundle, compare two payloads, check whether a member match sends records to the wrong person. That is half the job. **People** have to use the same tools too: to try them, to trust them, and to show someone else what they found.

Until now the only general-purpose screen for an MCP tool has been the MCP Inspector. It's a good protocol debugger, but a poor place to use a tool:
- three narrow panes
- protocol noise
- a wall of JSON where the answer should be

Each tool shouldn't need its own website either.

So every ImOnFHIR tool follows one contract. From that, the same result shows up clearly in three places:

| Where | Who it's for | What they see |
|---|---|---|
| **Dev console** (this repo, `mcp-tool-console`) | People building and testing tools | Every tool from every configured server: a plain form, "Try" buttons, the result first, technical details one click away |
| **Inside Claude** (an MCP App in the tool's own repo) | People asking an AI to run the tool | The same result card, inline in the chat |
| **A web page** | Visitors who want to try a tool | The same result, drawn by this renderer or by the site's own components |

A new tool gets all three by filling in its metadata and returning a view. It needs no front end of its own.

## How it serves the mission

ImOnFHIR is *"a personal healthcare interoperability engineering lab for building, testing, and explaining FHIR workflows with synthetic data."* Its About page says:

> An implementation guide tells you what to build.
> A sample payload shows you the shape of the data.
> ImOnFHIR shows what happens when you actually build it.

The motto behind every ImOnFHIR product is **seamless digital experiences**: less friction between people and technology, and between technical complexity and human understanding.

This repo is how ImOnFHIR's tools live up to that:

- **Show what happened.** A result arrives as a one-line headline in colour with a word ("Problem", "All right"), then tiles, then short bullets. The detail is folded underneath. You see the outcome of a real build, not a JSON dump.
- **Explain without hiding.** The raw request, the raw response, the tool definition, the server log and the matching Inspector command are always one click away, in *Technical details*. Plain words come first, and the technical facts stay available.
- **Build once, show everywhere.** One contract feeds the console, Claude and the web. Agents and people see the same facts, so what an AI reports can be checked by a person.
- **Safe by default.** The console runs only read-only tools. It asks before anything that may cost money and never hands API keys to the servers it starts. Synthetic data only.
- **Stable contracts.** ToolView is versioned (`v: 1`). Tool repos pin this repo to an exact commit, so a change here can't quietly change their output.

## What's inside

| Import | What it is | Runs in |
|---|---|---|
| `mcp-tool-console` | The tool contract (`toolMeta`, `resultMeta`, `describe`) and ToolView (`checkView`, `aiOrDeterministic`, `AI_LABEL`, types, limits) | Anywhere: no Node APIs, no network, no dependencies |
| `mcp-tool-console/render` | `renderView(view)`: a ToolView as escaped HTML; `esc()`; `provenanceLine()`; `requiredText()`, every string a renderer must show | Anywhere |
| `mcp-tool-console/form` | `renderForm(schema)`, `formToArgs`, `argsSummary`: a JSON Schema as a plain form | Anywhere |
| `mcp-tool-console/styles` | `TOKENS`, `VIEW_CSS`: the shared look, light and dark | Anywhere |
| `mcp-tool-console/console` | `Hub`, `createConsoleServer`, `loadConsoleConfig`: the console's Node side | Node |
| `mcp-tool-console/package` | `buildPackage`, `writePackage`: the `package` command's builder | Node |
| `mcp-tool-console/tool-view.schema.json` | ToolView v1 as JSON Schema | Data |
| `mcp-tool-console` (command) | Starts the dev console for the repo you run it in; `mcp-tool-console package` writes a package | Node |

## Quick start

### 1. Install it, pinned to a commit
```sh
npm install github:ImOnFHIR/mcp-tool-console#<commit>
```
npm builds the package on install.

### 2. Describe your tool
```ts
import { toolMeta, describe, type About } from "mcp-tool-console";

const about: About = {
  whatItIs: ["A checker for synthetic prior-authorization bundles."],
  whatItDoes: ["Runs the pinned validator.", "Lists each real problem once."],
  howToUse: ["Paste a bundle, or press a Try button."],
  safeToRun: ["Synthetic data. Read-only. Free."],
};

server.registerTool("check_bundle", {
  title: "Check a bundle",
  description: describe(about), // the same words for clients that ignore _meta
  inputSchema: { /* standard JSON Schema: title, description, examples */ },
  annotations: { readOnlyHint: true },
  _meta: toolMeta({
    about,
    cost: { free: true },
    presets: [{ id: "broken", label: "Try: the broken bundle", args: { /* … */ } }],
    form: { advanced: ["detail"] },
  }),
}, handler);
```

### 3. Return a view with each result
```ts
import { resultMeta, checkView, type ToolView } from "mcp-tool-console";

const view: ToolView = {
  v: 1,
  status: "bad",
  headline: "3 problems found; the bundle would be rejected.",
  stats: [{ label: "Problems", value: "3", status: "bad" }],
  bullets: [{ text: "Claim.patient points to a Patient that isn't in the bundle.", status: "bad" }],
};
// checkView(view) returns [] when the view is valid; use it in your tests.
return { content: [{ type: "text", text }], structuredContent: data, _meta: resultMeta(view) };
```

### 4. Try it in the console
Add `console.config.json` to your repo (relative paths only):
```json
{ "servers": [{ "id": "my-tool", "label": "My tool", "command": "node", "args": ["dist/mcp.js"], "cwd": "." }] }
```
Then run:
```sh
npx mcp-tool-console     # prints http://127.0.0.1:4317/#token=…
```
Servers that live elsewhere on your machine go in `console.local.json`, same shape, gitignored. That's how one console shows several repos' tools side by side.

## The contract

### Inputs: standard JSON Schema
- `title` on every input: its label
- `description`: its help line
- `examples`
- labelled choices as `anyOf: [{ const, title }]`

The form turns these into the right control:
- a labelled choice: chips or a dropdown
- a number range: a slider
- yes/no: a switch
- free text: a text box
- anything bigger: a paste box that also opens a file

### Tool `_meta`
| Key | Required | What it carries |
|---|---|---|
| `com.imonfhir/about` | yes | `whatItIs`, `whatItDoes`, `howToUse`, `safeToRun`: short bullets, each ≤ 110 characters |
| `com.imonfhir/cost` | yes | `{ free: true }` or `{ free: false, note }`. **A tool with no cost entry is treated as not free.** |
| `com.imonfhir/presets` | no | One-click runs: `{ id, label, args }`. `args` must pass the tool's own input schema. |
| `com.imonfhir/form` | no | `{ advanced: [...] }`: inputs folded under "More settings" |

### Result `_meta`: `com.imonfhir/view` = ToolView v1
| Field | What it is |
|---|---|
| `v` | Always `1` |
| `status` | `good`, `bad`, `warn`, `info` or `error` |
| `headline` | One sentence, one line |
| `banner` | Optional notice, such as "Synthetic data only". Required on a machine-written view (below) |
| `stats[]` | Tiles: `{ label, value, status? }` |
| `bullets[]` | `{ text ≤ 110 chars, status?, detail?, refs? }`; the detail opens on click; `refs` are cited passage ids |
| `sections[]` | Collapsed unless `open`; blocks: `bullets`, `table`, `kv`, `text`, `code` |
| `next[]` | Follow-up runs: `{ label, patch }`, the same tool with these arguments changed |
| `footnote` | Small print, such as a data fingerprint |
| `provenance` | Optional: who wrote the words, from what, and where the input went (below) |

**Limits:**
- the view stays under 50 KB
- a table shows at most 200 rows; add a note if you cut it
- unknown block kinds still render, as code, so newer views don't break older renderers

### Who wrote a result, and what it cites (contract 1.1)
Still `v: 1`: these fields are optional, and a renderer written before them still shows the two facts that matter, because neither depends on a new field.

- **The label rides in `banner`.** When `provenance.mode` is anything other than `"deterministic"`, the banner must start with `Machine-written` and name the model and the date, for example `Machine-written · unreviewed · example-model-1 · 2026-11-12.` A new mode a checker doesn't know counts as machine-written, so it can't skip the label.
- **Cited passages are bullets in a section with id `sources`.** Every id in `provenance.passageIds` must be a `refs` entry on a bullet there, and every `refs` entry anywhere must be in `passageIds`.
- **`provenance`** is for newer renderers and for machines:

| Field | What it is |
|---|---|
| `mode` | `"deterministic"` (the tool computed every word) or `"model"` (a language model wrote some) |
| `egress` | Who outside the tool received this run's input: `"none"` or `"model-provider"`. A deterministic view can't say `"model-provider"` |
| `baseDigest` | `sha256:` of the deterministic result this view reports or explains |
| `corpusDigest` | `sha256:` of the committed corpus or pack the passages come from, or `"none"` |
| `passageIds[]` | Every passage the view cites |
| `evidenceType` | What backs the words, such as `validator-output` or `spec-text` |
| `model`, `at` | The model and the date (ISO). Required on a machine-written view |
| `promptVersion`, `costUsd` | Optional |

`checkView` enforces all of this. `docs/tool-view.schema.json` carries what a JSON Schema can express; the cross-field rules (model and date in the banner, sources, refs that resolve) are `checkView`'s alone. The renderer shows the provenance in one line of plain words and the refs after each bullet's text.

**Abstain means the deterministic result alone.** `aiOrDeterministic(candidate, base)` returns a machine-written view only when it passes `checkView`, explains the same result (`baseDigest`) and keeps its status, headline and stats. Otherwise it returns `base` untouched. It never repairs a field or fills in a default.

**Why `_meta` and not `structuredContent`:** a tool's `structuredContent` is its data. Clients, agents and tests may compare it exactly. Keeping the view beside it means adding a view never changes a tool's data.

## The dev console

- **One full-width page per tool:**
  - what it is, what it does, how to use it
  - "Try" buttons
  - a plain form with advanced settings folded away
  - **Run**
- **The result comes first.** After a run, the settings fold into one line.
- **Left list** of every server and tool, with search, a status dot and Restart per server.
- **Technical details** (bottom right): request, response, tool definition, server log, and "copy as Inspector command".
- **At phone width** the layout changes: a Tools button, a sticky Run, and tables become cards. (The CSS for this is tested, but it hasn't yet been checked on a real phone.)

**Safety rules.** Each has a test in `test/console.test.ts`:
- Listens on 127.0.0.1 only, with a new link token each launch.
- Refuses a foreign `Host` header, which blocks DNS rebinding, and refuses calls from other sites.
- Starts only the commands in your config files. The page can't add or change a server.
- Runs only tools marked `readOnlyHint: true`.
- A tool that isn't declared free needs a visible per-run confirmation.
- Started servers get the MCP SDK's default environment plus only the variable names your local config lists, so API keys don't leak by accident.
- Request bodies are capped, and the page is one self-contained file served under a strict Content Security Policy.
- The console code never imports an AI SDK or spending code.

## Packages

`mcp-tool-console package` turns a configured server into a folder another site can embed and pin. It reads the same `console.config.json` as the console, so it knows nothing about any one tool.

```sh
npx mcp-tool-console package [--server <id>] [--out <dir>] [--runs <dir>]
```
- With no `--server` it packages every configured server. With `--server` it packages that one.
- `--out` defaults to `package/<server-id>/`. Without `--server`, `--out` is a parent folder and each server gets `<out>/<server-id>/`.
- `--runs` is a folder of recorded runs to include.

```text
package/<server-id>/
  package.json                  { id, name, version, tools }   name and version come from the server's own initialize reply
  tools/<tool>.json             the tools/list entry, _meta included
  views/<tool>/<preset-id>.json the ToolView a preset produced
  runs/<tool>/<file>.json       copied from --runs
  PROVENANCE.json               sha256 of every file, and packageDigest
```

**What it runs.** Only the presets of tools that are `readOnlyHint: true` and declared `cost: { free: true }`. A preset on any other tool is left alone and the command says so. Every view must pass `checkView`, or the command fails.

**Recorded runs.** Each file in `--runs` must be exactly `{ v: 1, recorded, tool, args, structuredContent, view, model, costUsd, lockDigest }` (its `view` must pass `checkView`). Any other shape fails the command and names the file.

**It refuses a dirty tree.** If `git status` shows an uncommitted change to a tracked file, in the folder you run it in or in the repository of any server it will start (its `cwd`), or either isn't in a git repository, the command exits 1 and writes nothing, not even the output folder. Untracked files don't count: the folders this command writes are untracked until you commit them. Commit your change first, then package, then commit the package.

**What it won't overwrite or write.** An existing output folder is replaced only if it is exactly an earlier package, untouched (every file listed in its `PROVENANCE.json` with the recorded hash, nothing else, and a `packageDigest` that recomputes); delete a hand-edited one first. Names that would collide or can't be a file name on a default macOS or Windows disk fail the build: `Echo` next to `echo`, a trailing dot, `aux`, or a name over 100 characters. The tool-name rule is the hosted catalog's own (`isCatalogToolDir`), so every file the command writes is one the catalog reads. The package folder's name (the server id, or the last segment of `--out` with `--server`) must pass the catalog's id rule: 1 to 40 characters, lowercase letters, digits and dashes, starting with a letter or digit, and not a Windows reserved name. Anything else exits 1 with the rule named, because the catalog skips such folders. With several servers and `--runs`, a recording whose tool name two of them share is refused as ambiguous; package one server at a time.

**Deterministic.** Keys are sorted, file lists are sorted, and there are no timestamps. The same inputs give the same bytes, and the repo's own `package/samples/` is checked against a fresh build by a test.

**`packageDigest`** is `sha256:` plus the hex sha256 of the sorted `path:hash` lines (joined by a newline, `PROVENANCE.json` left out). A consumer pins it and refuses a package whose digest differs. It has no commit SHA in it on purpose: a SHA changes with every commit, so a committed package would be stale at once. The digest changes only when the package's content does.

Embedding: `import { buildPackage, writePackage } from "mcp-tool-console/package"` (Node only; not part of the browser-safe entry point).

## Hosted mode

The same console can run in a small container behind Cloudflare Access, as its owner's human UI. It is an MCP client of **exactly one upstream**: a Cloudflare MCP server portal, reached over Streamable HTTP with the console's own service token. Turning a tool on or off happens in the portal, not here. Laptop mode is the default and behaves as described above.

Choose it with `CONSOLE_MODE=hosted`. Its configuration comes only from the environment:

| Variable | What it is |
|---|---|
| `CONSOLE_MODE` | `hosted` selects this mode; unset or `laptop` is laptop mode; anything else refuses to start |
| `CONSOLE_UPSTREAM_URL` | The one portal: a single `https:` URL |
| `CONSOLE_UPSTREAM_CLIENT_ID`, `CONSOLE_UPSTREAM_CLIENT_SECRET` | This console's own service token, sent upstream as `CF-Access-Client-Id` and `CF-Access-Client-Secret` |
| `CONSOLE_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` (a bare team name also works) |
| `CONSOLE_ACCESS_AUD` | The Access application's audience tag |
| `CONSOLE_OWNER_EMAIL` | The one person let in |
| `CONSOLE_PUBLIC_ORIGIN` | The `https` origin the page is served from, with no path |
| `CONSOLE_PACKAGES_DIR` | Optional: a folder of tool packages for `GET /api/catalog` |
| `CONSOLE_BIND_ADDRESS` | Optional, default `0.0.0.0`. `PORT` as in laptop mode |

**Rules.** Each has a test in `test/hosted.test.ts`:
- Hosted mode is chosen only by `CONSOLE_MODE`. Test: `hosted mode: chosen only by CONSOLE_MODE=hosted; anything unknown refuses`.
- It never reads another service's Access credentials. Test: `hosted code never reads the other service's Access credential variables`.
- The upstream is one `https:` URL. Test: `hosted config: the upstream is one https URL and nothing else`, and `hosted hub: one https upstream only`.
- It never starts a command and never builds a stdio transport. Test: `hosted hub: never starts a command, whatever the config says`.
- The service token goes upstream as the two Access headers, and the owner's own JWT is not forwarded. Tests: `hosted config: the service token goes upstream as the two Access headers`, `hosted server: the portal is sent this console's own service token`.
- The read-only and cost gates apply to upstream tools unchanged. Test: `hosted server: lists the portal's tools and runs them under the same gates`.
- Every request, the page included, carries an Access JWT that names the owner; anything else is a 403 with a plain message. Test: `hosted server: every request, the page included, needs the owner's Access JWT`.
- The JWT check is RS256 only, with keys from the team's certs URL (cached), the issuer and audience checked, `exp` and `nbf` checked with 30 seconds of leeway, and the `email` claim equal to the owner's, ignoring case. Keys older than the cache time are never trusted, so an unreachable certs endpoint locks everyone out rather than keeping withdrawn keys alive. A service-token JWT has no email and is refused. Tests: the `access jwt: ...` group, one test per refusal.
- A portal that drops the console's session shows as stopped, so the page offers Restart (only an HTTP 404 counts, not a JSON-RPC error that carries that number), and stopping or restarting ends the portal session. Tests: `hosted hub: a JSON-RPC error numbered 404 is not a lost session`, `hosted hub: stopping or restarting ends the portal session`, and `hosted hub: a portal that dropped our session shows as stopped, and Restart brings it back`.
- Logs name a reason and never contain the token. Test: `hosted server: the token never reaches a log line`.
- On `/api`, the `Origin` must be the public origin. Test: `hosted server: an Origin other than the public one is refused`.
- On `/api`, the `x-console-request: 1` header must be present (the Access cookie is `SameSite=None`, so this is the CSRF guard; the page sends it). Test: `hosted server: a request without the console's custom header is refused`.
- The `Host` header must be the public origin's host. Test: `hosted server: the Host header must be the public origin's host`.
- No write routes: `PATCH`, `PUT` and `DELETE` on `/api` are a 405. Test: `hosted server: no write routes; PATCH, PUT and DELETE are a 405`.
- No run history: nothing under `src/console` can write a file. Test: `hosted mode: nothing under src/console can write a file`.
- A non-loopback bind without the Access settings exits non-zero and names the missing variables. Test: `hosted cli: a non-loopback bind without the Access settings exits non-zero and names them` (and the three tests after it).
- `GET /api/catalog` is read-only, and no id or file name reaches outside its folder. Test: `catalog: no id or file name reaches outside the folder, and nothing is written`.
- Laptop mode does not serve the catalog and refuses a non-loopback bind. Tests: `laptop mode does not serve /api/catalog`, `laptop cli: refuses a non-loopback bind and an unknown mode`.

**The tool package.** `GET /api/catalog` reads packages in this shape and returns `{ servers: [{ id, tools, runs: [{ tool, file, recorded }] }] }`. The `package` command that will produce them doesn't exist yet; `test/fixtures/packages/sample/` is a synthetic example.
```
<dir>/<server-id>/package.json
                 /tools/*.json            one tools/list entry each, with _meta
                 /views/**/*.json         ToolView conformance views
                 /runs/<tool>/*.json      { v: 1, recorded, tool, args, structuredContent, view, model, costUsd, lockDigest }
                 /PROVENANCE.json
```
Views and `PROVENANCE.json` are part of the format but `/api/catalog` doesn't serve them yet. Ids and file names are matched against a short pattern and symbolic links are skipped.

**Container.** The `Dockerfile` builds the console and runs it as a non-root user with hosted mode on, bound to `0.0.0.0`, port 8080. No credential is baked in; with no settings it exits with the message naming them.

## What this repo won't do

- **Be a second Inspector.** No protocol message log, no prompt or sampling screens. Use the Inspector for protocol debugging.
- **Hold tool-specific code.** Anything about one tool lives in that tool's repo.
- **Run write tools** or call anything outside your machine from the page.
- **Keep a run history on disk.** Runs live only in the open page. The link token is kept for that browser tab only.
- **In hosted mode,** it still keeps no run history, never runs write tools, never starts a command, never reads a local server config, and has no route that changes anything. It talks to one upstream and to nothing else.

## Versioning

- ToolView is `v: 1`. Adding an optional field is allowed. Renaming, removing or changing the meaning of a field means `v: 2`, plus a note here.
- Tool repos install a pinned commit. Updating the pin is its own reviewed change in that repo.

## Used by

- [member-match-decoy-lab](https://github.com/ImOnFHIR/member-match-decoy-lab): tests whether a health plan's `$member-match` sends records to the wrong person. Its `score_member_match` tool uses the full contract, and its in-Claude view uses this renderer.

## Development

```sh
npm install
npm test               # builds, then runs every test
npm run format:check && npm run lint
npm run console        # the console with this repo's sample tools (run npm test once first)
```
In VS Code, each of these is a task: Terminal → Run Task.

## Registry overlay

`docs/registry-overlay.schema.json` is a JSON Schema for the rules a registry entry must meet on top of an MCP Registry `server.json`. Validate the entry against the published `server.json` schema separately; this file adds only the rules on `_meta["com.imonfhir/registry"]` (modes, tier, public ceiling, local launch shape) and on a committed entry's remotes and packages (https remotes with public hosts, no headers or package environment variables).

It is shipped in the package as `docs/registry-overlay.schema.json`. `test/registry-overlay.test.ts` pins a copy of the published schema by hash, checks a valid entry, and checks that each negative fixture in `test/fixtures/registry-overlay/negative/` is a valid `server.json` that fails the overlay at its own rule. The validator (`ajv`) is a dev dependency used by that test only; the console never validates entries at runtime.

## Provenance and licence

- This code was moved out of member-match-decoy-lab so other tools can share it; see [PROVENANCE.md](PROVENANCE.md).
- Licensed under Apache-2.0; see [LICENSE](LICENSE).
