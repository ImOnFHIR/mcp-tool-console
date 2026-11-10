import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConsoleConfig, type ServerConfig } from "../src/console/config.js";
import { buildPackage, isSafeName, readRuns } from "../src/package.js";

const sdk = (p: string) => pathToFileURL(resolve("node_modules/@modelcontextprotocol/sdk", p)).href;
const CLI = resolve("dist/src/console/cli.js");
const FAKE = resolve("dist/test/helpers/fake-mcp.js");
const samples = (): ServerConfig => {
  const s = loadConsoleConfig(".").find((c) => c.id === "samples");
  assert.ok(s, "console.config.json names a server called samples");
  return s;
};
const tmp = () => mkdtempSync(join(tmpdir(), "pkg-"));
const walk = (dir: string, pre = ""): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name), `${pre}${e.name}/`) : [pre + e.name],
    )
    .toSorted();

/** A committed repo whose console.config.json points at `server` (default: the fake server). */
function repo(server: string = FAKE) {
  const dir = tmp();
  writeFileSync(
    join(dir, "console.config.json"),
    JSON.stringify({ servers: [{ id: "demo", label: "Demo", command: "node", args: [server] }] }),
  );
  writeFileSync(join(dir, "notes.txt"), "one\n");
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], {
      cwd: dir,
      stdio: "pipe",
    });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return { dir, git };
}
const cli = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, "package", ...args], { cwd, encoding: "utf8" });

const goodView = { v: 1, status: "good", headline: "Fine." };
const goodRun = {
  v: 1,
  recorded: "recorded-1",
  tool: "echo",
  args: { text: "hi" },
  structuredContent: { ok: true },
  view: goodView,
  model: "model-x",
  costUsd: 0,
  lockDigest: "sha256:abc",
};
function runsDir(files: Record<string, unknown>) {
  const dir = tmp();
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(dir, name), JSON.stringify(body));
  return dir;
}

test("package: the committed package/samples matches a fresh build, file for file", async () => {
  const built = await buildPackage(samples());
  const committed = walk("package/samples");
  assert.deepEqual([...built.files.keys()].toSorted(), committed, "file list");
  for (const [path, text] of built.files)
    assert.equal(
      readFileSync(join("package/samples", path), "utf8"),
      text,
      `package/samples/${path} is stale: npm run build && node dist/src/console/cli.js package --server samples`,
    );
});

test("package: two builds give identical bytes, and PROVENANCE hashes every other file", async () => {
  const a = await buildPackage(samples());
  const b = await buildPackage(samples());
  assert.deepEqual([...a.files], [...b.files]);
  const prov = JSON.parse(a.files.get("PROVENANCE.json")!);
  const names = [...a.files.keys()].filter((p) => p !== "PROVENANCE.json").toSorted();
  assert.deepEqual(Object.keys(prov.files), names);
  for (const n of names)
    assert.equal(prov.files[n], createHash("sha256").update(a.files.get(n)!).digest("hex"));
  const lines = names.map((n) => `${n}:${prov.files[n]}`).join("\n");
  assert.equal(prov.packageDigest, `sha256:${createHash("sha256").update(lines).digest("hex")}`);
  assert.ok(
    !/20\d\d-\d\d-\d\d|\b[0-9a-f]{40}\b/.test(a.files.get("PROVENANCE.json")!),
    "no date or SHA",
  );
});

test("package: only presets of free, read-only tools are run", async () => {
  const built = await buildPackage(samples());
  assert.deepEqual(built.called, ["echo/hello"]);
  assert.deepEqual(built.skipped.map((s) => s.preset).toSorted(), [
    "paid/spend",
    "write_thing/write",
  ]);
  const views = [...built.files.keys()].filter((p) => p.startsWith("views/"));
  assert.deepEqual(views, ["views/echo/hello.json"]);
  assert.deepEqual(JSON.parse(built.files.get("package.json")!), {
    id: "samples",
    name: "fake",
    tools: ["die", "echo", "env_probe", "hang", "paid", "write_thing"],
    version: "0",
  });
});

test("package: a dirty tracked file is refused with exit 1 and nothing written", () => {
  const { dir, git } = repo();
  // Control: the same clean repo packages fine.
  const ok = cli(dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(existsSync(join(dir, "package/demo/PROVENANCE.json")));
  git("clean", "-fdxq");
  assert.ok(!existsSync(join(dir, "package")));

  writeFileSync(join(dir, "notes.txt"), "two\n");
  const r = cli(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Uncommitted changes[\s\S]*notes\.txt/);
  assert.ok(!existsSync(join(dir, "package")), "no output directory");
  const custom = cli(dir, "--out", "elsewhere");
  assert.equal(custom.status, 1);
  assert.ok(!existsSync(join(dir, "elsewhere")));
});

test("package: an untracked file does not make the tree dirty", () => {
  const { dir } = repo();
  writeFileSync(join(dir, "scratch.txt"), "x");
  assert.equal(cli(dir).status, 0);
});

test("package: a recorded run must have exactly the run shape; the file is named", () => {
  const { dir } = repo();
  const bad: Record<string, any> = {
    "extra-key.json": { ...goodRun, note: "x" },
    "missing-key.json": (({ model: _m, ...rest }) => rest)(goodRun),
    "wrong-v.json": { ...goodRun, v: 2 },
    "cost-text.json": { ...goodRun, costUsd: "0.10" },
    "args-list.json": { ...goodRun, args: [] },
  };
  for (const [name, body] of Object.entries(bad)) {
    const r = cli(dir, "--runs", runsDir({ [name]: body }));
    assert.equal(r.status, 1, name);
    assert.ok(r.stderr.includes(`runs/${name}`), `${name}: ${r.stderr}`);
    assert.ok(!existsSync(join(dir, "package")), `${name}: nothing written`);
  }
  const notJson = tmp();
  writeFileSync(join(notJson, "a.json"), "{nope");
  assert.equal(cli(dir, "--runs", notJson).status, 1);
});

test("package: valid runs are copied byte for byte under runs/<tool>/", () => {
  const { dir } = repo();
  const runs = runsDir({ "first.json": goodRun });
  const r = cli(dir, "--runs", runs);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(join(dir, "package/demo/runs/echo/first.json"), "utf8"),
    readFileSync(join(runs, "first.json"), "utf8"),
  );
  const prov = JSON.parse(readFileSync(join(dir, "package/demo/PROVENANCE.json"), "utf8"));
  assert.ok("runs/echo/first.json" in prov.files);
  // A run for a tool nobody packages is an error, not a dropped file.
  const orphan = runsDir({ "x.json": { ...goodRun, tool: "nothing" } });
  assert.equal(cli(dir, "--runs", orphan).status, 1);
});

test("package: a recorded run whose view fails checkView fails the command", () => {
  const dir = runsDir({ "bad-view.json": { ...goodRun, view: { v: 1, status: "good" } } });
  assert.throws(() => readRuns(dir), /runs\/bad-view\.json: view is not a valid ToolView/);
});

/** A one-file MCP server whose tools are `tools` (name -> view returned by its one preset). */
function inlineServer(tools: Record<string, unknown>): ServerConfig {
  const dir = tmp();
  const script = join(dir, "server.mjs");
  writeFileSync(
    script,
    `import { McpServer } from "${sdk("dist/esm/server/mcp.js")}";
import { StdioServerTransport } from "${sdk("dist/esm/server/stdio.js")}";
const s = new McpServer({ name: "inline", version: "1" });
for (const [name, view] of Object.entries(${JSON.stringify(tools)}))
  s.registerTool(name, { inputSchema: {}, annotations: { readOnlyHint: true },
    _meta: { "com.imonfhir/cost": { free: true }, "com.imonfhir/presets": [{ id: "p", label: "p", args: {} }] } },
    async () => ({ content: [], _meta: { "com.imonfhir/view": view } }));
await s.connect(new StdioServerTransport());
`,
  );
  return { ...samples(), id: "inline", command: process.execPath, args: [script], cwd: dir };
}

test("package: a view the server produces must pass checkView", async () => {
  await assert.rejects(
    () => buildPackage(inlineServer({ t: { v: 1, status: "good" } })),
    /t\/p: view is not a valid ToolView/,
  );
});

test("package: names that differ only in case would collide on disk, so the build fails", async () => {
  await assert.rejects(
    () => buildPackage(inlineServer({ Echo: goodView, echo: goodView })),
    /same file on a case-insensitive disk/,
  );
  const built = await buildPackage(inlineServer({ one: goodView, two: goodView }));
  assert.ok(built.files.has("views/one/p.json"));
});

test("package: a server's own repository must be clean, not only the folder you run in", () => {
  const host = repo();
  const other = repo();
  writeFileSync(
    join(host.dir, "console.config.json"),
    JSON.stringify({
      servers: [
        {
          id: "demo",
          label: "Demo",
          command: "node",
          args: [FAKE],
          cwd: relative(host.dir, other.dir),
        },
      ],
    }),
  );
  host.git("commit", "-q", "-am", "point at the other checkout");
  assert.equal(cli(host.dir).status, 0, "control: both clean");
  host.git("clean", "-fdxq");
  writeFileSync(join(other.dir, "notes.txt"), "changed\n");
  const r = cli(host.dir);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(realpathSync(other.dir)), r.stderr);
  assert.ok(!existsSync(join(host.dir, "package")));
});

test("package: a package edited by hand, or with stale hashes, is not replaced", () => {
  const { dir } = repo();
  assert.equal(cli(dir, "--server", "demo", "--out", "mine").status, 0);
  const file = join(dir, "mine/tools/echo.json");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original + " ");
  assert.equal(cli(dir, "--server", "demo", "--out", "mine").status, 1);
  assert.equal(readFileSync(file, "utf8"), original + " ", "left as it was");
  writeFileSync(file, original);
  const prov = join(dir, "mine/PROVENANCE.json");
  const p = JSON.parse(readFileSync(prov, "utf8"));
  p.packageDigest = `sha256:${"0".repeat(64)}`;
  writeFileSync(prov, JSON.stringify(p));
  assert.equal(
    cli(dir, "--server", "demo", "--out", "mine").status,
    1,
    "digest that does not recompute",
  );
});

test("package: names Windows can't hold as one file each are refused", async () => {
  for (const bad of ["echo.", "aux", "NUL", "com1.txt"])
    await assert.rejects(
      () => buildPackage(inlineServer({ [bad]: goodView })),
      /not usable as a file name/,
      bad,
    );
  assert.ok(isSafeName("echo") && isSafeName("a.b-c_d"));
  assert.ok(!isSafeName("echo.") && !isSafeName("Aux.json") && !isSafeName(".hidden"));
});

test("package: only a folder that is exactly an earlier package is replaced", () => {
  const { dir } = repo();
  assert.equal(cli(dir, "--server", "demo", "--out", "mine").status, 0);
  assert.equal(
    cli(dir, "--server", "demo", "--out", "mine").status,
    0,
    "an earlier package is replaced",
  );
  // A stray file next to a real PROVENANCE.json: not ours to delete.
  writeFileSync(join(dir, "mine/keep.txt"), "keep");
  assert.equal(cli(dir, "--server", "demo", "--out", "mine").status, 1);
  assert.equal(readFileSync(join(dir, "mine/keep.txt"), "utf8"), "keep");
  // A PROVENANCE.json that isn't ours (any shape) is not a licence to delete.
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/PROVENANCE.json"), "{}");
  writeFileSync(join(dir, "src/code.txt"), "code");
  assert.equal(cli(dir, "--server", "demo", "--out", "src").status, 1);
  assert.equal(readFileSync(join(dir, "src/code.txt"), "utf8"), "code");
});

test("package: an output folder that is not an earlier package is not overwritten", () => {
  const { dir } = repo();
  mkdirSync(join(dir, "mine"));
  writeFileSync(join(dir, "mine/keep.txt"), "keep");
  const r = cli(dir, "--server", "demo", "--out", "mine");
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(dir, "mine/keep.txt"), "utf8"), "keep");
});

test("package: an unknown --server fails; the files hold no machine paths", async () => {
  const { dir } = repo();
  assert.equal(cli(dir, "--server", "nope").status, 1);
  const built = await buildPackage(samples());
  const all = [...built.files.values()].join("\n");
  assert.ok(!all.includes(resolve(".")), "no absolute path of this machine");
});
