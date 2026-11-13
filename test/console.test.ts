import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { loadConsoleConfig, ConfigError } from "../src/console/config.js";
import { Hub } from "../src/console/hub.js";
import { createConsoleServer } from "../src/console/http.js";
import {
  AI_SDK_PACKAGES,
  aiSdkFindings,
  declaredDependencies,
  installedPackages,
  isAiSdk,
  loaderFor,
} from "./helpers/ai-sdk-ban.js";

const TOKEN = "test-token";
const dir = mkdtempSync(join(tmpdir(), "console-"));
writeFileSync(
  join(dir, "console.config.json"),
  JSON.stringify({
    servers: [
      {
        id: "fake",
        label: "Fake server",
        command: "node",
        args: [resolve("dist/test/helpers/fake-mcp.js")],
        cwd: ".",
        timeoutSeconds: 2,
      },
    ],
  }),
);
writeFileSync(
  join(dir, "console.local.json"),
  JSON.stringify({
    servers: [
      {
        id: "fake-env",
        label: "Fake with env",
        command: "node",
        args: [resolve("dist/test/helpers/fake-mcp.js")],
        cwd: dir,
        env: ["CONSOLE_TEST_ALLOWED"],
      },
    ],
  }),
);

let hub: Hub;
let port = 0;
const server = () =>
  createConsoleServer({ hub, token: TOKEN, page: () => "<!doctype html><title>t</title>" });
let srv: ReturnType<typeof server>;

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  process.env.CONSOLE_TEST_ALLOWED = "yes";
  hub = new Hub(loadConsoleConfig(dir));
  await hub.startAll();
  srv = server();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  port = (srv.address() as AddressInfo).port;
});
after(async () => {
  srv.close();
  await hub.stopAll();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CONSOLE_TEST_ALLOWED;
});

/** Raw HTTP so tests can set Host and Origin freely. */
function call(
  path: string,
  o: {
    method?: string;
    body?: unknown;
    token?: string | null;
    host?: string;
    origin?: string;
    raw?: string;
  } = {},
): Promise<{ status: number; json: any; headers: any; text: string }> {
  return new Promise((res, rej) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const headers: Record<string, string> = { host: o.host ?? `127.0.0.1:${port}` };
    if (o.token !== null) headers["x-console-token"] = o.token ?? TOKEN;
    if (o.origin) headers.origin = o.origin;
    if (data !== undefined) headers["content-type"] = "application/json";
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: o.method ?? (data === undefined ? "GET" : "POST"),
        headers,
      },
      (r) => {
        let t = "";
        r.on("data", (c) => (t += c));
        r.on("end", () => {
          let j: any = null;
          try {
            j = JSON.parse(t);
          } catch {
            /* html */
          }
          res({ status: r.statusCode!, json: j, headers: r.headers, text: t });
        });
      },
    );
    req.on("error", rej);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

test("console: lists servers and their tools", async () => {
  const r = await call("/api/tools");
  assert.equal(r.status, 200);
  const ids = r.json.servers.map((s: any) => [s.id, s.status]);
  assert.deepEqual(ids, [
    ["fake", "ready"],
    ["fake-env", "ready"],
  ]);
  assert.ok(r.json.servers[0].tools.some((t: any) => t.name === "echo"));
  // How to start the server by hand, for the drawer's Inspector command. "node" stays "node".
  assert.equal(r.json.servers[0].launch, `node ${resolve("dist/test/helpers/fake-mcp.js")}`);
});

test("console: the page is served with a strict CSP", async () => {
  const r = await call("/", { token: null });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-security-policy"], /default-src 'none'.*connect-src 'self'/);
});

test("console: refuses calls without the token", async () => {
  assert.equal((await call("/api/tools", { token: null })).status, 401);
  assert.equal((await call("/api/tools", { token: "wrong" })).status, 401);
});

test("console: refuses a foreign Host (DNS rebinding) and a cross-site Origin", async () => {
  assert.equal((await call("/api/tools", { host: `evil.example:${port}` })).status, 403);
  assert.equal((await call("/", { host: `evil.example:${port}`, token: null })).status, 403);
  assert.equal((await call("/api/tools", { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("/api/tools", { origin: `http://127.0.0.1:${port}` })).status, 200);
});

test("console: runs a free read-only tool and returns request, result and timing", async () => {
  const r = await call("/api/call", {
    body: { server: "fake", tool: "echo", args: { text: "hi" } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.result._meta["com.imonfhir/view"].headline, "You said hi.");
  assert.deepEqual(r.json.request, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "echo", arguments: { text: "hi" } },
  });
  assert.equal(typeof r.json.ms, "number");
});

test("console: refuses tools that aren't read-only", async () => {
  const r = await call("/api/call", { body: { server: "fake", tool: "write_thing", args: {} } });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /read-only/);
});

test("console: a tool that may cost money needs a per-run confirmation", async () => {
  assert.equal((await call("/api/call", { body: { server: "fake", tool: "paid" } })).status, 402);
  const ok = await call("/api/call", { body: { server: "fake", tool: "paid", confirmCost: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.result.content[0].text, "spent");
});

test("console: servers can't be added or pointed elsewhere through the API", async () => {
  assert.equal(
    (await call("/api/call", { body: { server: "new", tool: "x", command: "rm" } })).status,
    404,
  );
  assert.equal(
    (await call("/api/restart", { body: { server: "nope", command: "rm" } })).status,
    404,
  );
  assert.equal((await call("/api/servers", { body: { id: "x", command: "rm" } })).status, 404);
});

test("console: child servers get no API keys unless the local config names them", async () => {
  const plain = await call("/api/call", { body: { server: "fake", tool: "env_probe" } });
  assert.deepEqual(JSON.parse(plain.json.result.content[0].text), {
    anthropic: false,
    allowed: null,
  });
  const named = await call("/api/call", { body: { server: "fake-env", tool: "env_probe" } });
  assert.deepEqual(JSON.parse(named.json.result.content[0].text), {
    anthropic: false,
    allowed: "yes",
  });
});

test("console: a hung tool hits its time limit; cancel stops a call", async () => {
  const slow = await call("/api/call", { body: { server: "fake", tool: "hang" } });
  assert.match(slow.json.failure, /timed out|timeout/i);
  const pending = call("/api/call", { body: { server: "fake", tool: "hang", callId: "c1" } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await call("/api/cancel", { body: { callId: "c1" } })).json.cancelled, true);
  assert.match((await pending).json.failure, /cancel/i);
});

test("console: rejects oversized and malformed bodies", async () => {
  assert.equal((await call("/api/call", { raw: "{oops" })).status, 400);
  assert.equal(
    (await call("/api/call", { raw: JSON.stringify({ x: "y".repeat(6 * 1024 * 1024 + 10) }) }))
      .status,
    413,
  );
});

test("console: the server log keeps each server's error output", async () => {
  const r = await call("/api/log?server=fake");
  assert.ok(r.json.lines.includes("fake server started"));
});

test("console config: committed config may not use machine paths; ids must be unique", () => {
  const d = mkdtempSync(join(tmpdir(), "cfg-"));
  writeFileSync(
    join(d, "console.config.json"),
    JSON.stringify({ servers: [{ id: "a", label: "A", command: "node", cwd: "/Users/x" }] }),
  );
  assert.throws(
    () => loadConsoleConfig(d),
    (e: Error) => e instanceof ConfigError && /relative paths only/.test(e.message),
  );
  writeFileSync(
    join(d, "console.config.json"),
    JSON.stringify({
      servers: [
        { id: "a", label: "A", command: "node" },
        { id: "a", label: "B", command: "node" },
      ],
    }),
  );
  assert.throws(() => loadConsoleConfig(d), /used twice/);
});

test("no AI SDK or spend code: none declared, none installed, and no file under src/ or scripts/ imports one", async () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
  assert.deepEqual(declaredDependencies(pkg).filter(isAiSdk), [], "package.json");
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as Record<string, unknown>;
  const installed = installedPackages(lock);
  assert.ok(installed.includes("@modelcontextprotocol/sdk"), "package-lock.json was not read");
  assert.deepEqual(installed.filter(isAiSdk), [], "package-lock.json");
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  const scanned = [...files("src"), ...files("scripts")];
  // The walk reaches past the two folders the old ban covered.
  for (const f of ["src/package.ts", "src/tool-meta.ts", "src/console/http.ts", "src/ui/view.ts"]) {
    assert.ok(scanned.includes(join(f)), `scan misses ${f}`);
  }
  for (const f of scanned) {
    const loader = loaderFor(f);
    assert.ok(loader, `${f}: not a JS or TS file, so the ban can't read it; extend the test`);
    assert.deepEqual(await aiSdkFindings(readFileSync(f, "utf8"), loader), [], f);
  }
});

/** The banned packages a package.json declares. */
const declared = (pkg: Record<string, unknown>) => declaredDependencies(pkg).filter(isAiSdk);
/** The banned packages a lockfile with these `packages` entries installs. */
const lock = (packages: Record<string, unknown>) => installedPackages({ packages }).filter(isAiSdk);

/** One module specifier written in each import form the source scan must catch. */
const importForms = (s: string): string[] => [
  `import Client from "${s}";`,
  `import { Model } from '${s}';`,
  `import Client from /* note */ "${s}";`,
  `export * from "${s}";`,
  `import "${s}";`,
  `const m = await import("${s}");`,
  `const m = await import(/* webpackIgnore: true */ "${s}");`,
  `const m = require('${s}');`,
  "const m = await import(`" + s + "`);",
  `import M = require("${s}");`,
];

test("the AI-SDK ban catches every listed vendor in every import form, and nothing else", async () => {
  const samples = [
    ...AI_SDK_PACKAGES.map((p) => (p.endsWith("/") ? `${p}client` : p)),
    "openai/resources",
    "ai/rsc",
  ];
  for (const s of samples)
    for (const f of importForms(s)) assert.ok((await aiSdkFindings(f)).includes(s), f);
  // Code no dependency check can see: a URL, a data: module, a file outside the tree.
  for (const u of [
    "https://esm.sh/openai",
    "//esm.sh/openai",
    "data:text/javascript;base64,ZXhwb3J0IHt9",
    "blob:https://example.com/0",
    "file:///tmp/x.js",
  ]) {
    assert.deepEqual(await aiSdkFindings(`await import("${u}");`), [u], u);
  }
  // Fail closed: nothing can see what a computed import loads.
  for (const f of [
    `const u = "https://esm.sh/openai"; await import(u);`,
    `const r = require(name);`,
    `await import("./x" + y);`,
    "await import(`./x/${y}`);",
    `await import /* note */ (url);`,
  ]) {
    assert.ok(
      (await aiSdkFindings(f)).some((x) => x.startsWith("computed import: ")),
      f,
    );
  }
  // A scoped vendor name anywhere in the text, as the ban before this one caught it.
  assert.deepEqual(await aiSdkFindings(`const name = "@anthropic-ai/sdk";`), ["@anthropic-ai/"]);
  assert.deepEqual(await aiSdkFindings(`import { charge } from "./spend.js";`), ["spend.js"]);
  // Declared: any of the four maps, and the target of an npm alias.
  assert.deepEqual(declared({ dependencies: { openai: "6.0.0" } }), ["openai"]);
  assert.deepEqual(declared({ devDependencies: { "@ai-sdk/anthropic": "2.0.0" } }), [
    "@ai-sdk/anthropic",
  ]);
  assert.deepEqual(declared({ dependencies: { "model-client": "npm:openai@6.0.0" } }), ["openai"]);
  assert.deepEqual(declared({ peerDependencies: { m: "npm:@anthropic-ai/sdk@1.2.3" } }), [
    "@anthropic-ai/sdk",
  ]);
  // Installed: transitive packages and aliases, by real name.
  assert.deepEqual(lock({ "node_modules/model-client": { name: "openai" } }), ["openai"]);
  assert.deepEqual(lock({ "node_modules/x/node_modules/@ai-sdk/google": {} }), ["@ai-sdk/google"]);
  // Negative twin: what this repo may legitimately hold.
  for (const ok of [
    `const mode = "ai";`,
    `const help = 'Choose from "ai" or "manual"';`,
    `// import OpenAI from "openai";`,
    `import x from "aidbox";`,
    `import x from "./openai-notes.js";`,
    `import x from "langchainish";`,
    `import { Client } from "@modelcontextprotocol/sdk/client/index.js";`,
    `const { run } = await import("../package.js");`,
    `const m = await import(/* webpackIgnore: true */ "./x.js", { with: { type: "json" } });`,
    `const fs = require("node:fs");`,
    `// import(name) is how a computed import looks`,
    `/* require(x) */ const y = 1;`,
    `const here = new URL(".", import.meta.url);`,
  ]) {
    assert.deepEqual(await aiSdkFindings(ok), [], ok);
  }
  assert.deepEqual(declared({ dependencies: { aidbox: "1.0.0", y: "npm:aidbox@1" } }), []);
  assert.deepEqual(lock({ "": { name: "openai-notes" }, "node_modules/aidbox": {} }), []);
});

test("console cli: finds its page beside itself, not in the caller's folder", () => {
  const cli = readFileSync("src/console/cli.ts", "utf8");
  assert.match(cli, /^#!\/usr\/bin\/env node/);
  assert.match(cli, /import\.meta\.url/);
  assert.doesNotMatch(cli, /"dist\/ui\/console\.html"/);
});

test("console page: built file is self-contained", () => {
  const html = readFileSync("dist/ui/console.html", "utf8");
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet|https?:\/\/(?!127\.0\.0\.1)/i);
  assert.match(html, /<title>ImOnFHIR Dev Console<\/title>/);
});

test("console config: only the local config can pass environment variables", () => {
  const d = mkdtempSync(join(tmpdir(), "cfg-env-"));
  writeFileSync(
    join(d, "console.config.json"),
    JSON.stringify({
      servers: [{ id: "a", label: "A", command: "node", env: ["ANTHROPIC_API_KEY"] }],
    }),
  );
  assert.throws(
    () => loadConsoleConfig(d),
    (e: Error) => e instanceof ConfigError && /console\.local\.json/.test(e.message),
  );
});

test("console page: the cost tick is cleared as each run uses it", () => {
  const page = readFileSync("src/ui/browser/console-main.ts", "utf8");
  const run = page.slice(page.indexOf("async function run("), page.indexOf("const callId"));
  assert.match(run, /costBox\.checked = false/);
});

const hubFor = (helper: string, timeoutSeconds: number) =>
  new Hub([
    {
      id: "h",
      label: "H",
      command: process.execPath,
      args: [resolve(`dist/test/helpers/${helper}.js`)],
      cwd: dir,
      env: [],
      timeoutSeconds,
    },
  ]);

test(
  "hub: a server that dies mid-call fails the call at once, not at the time limit",
  { timeout: 15_000 },
  async () => {
    const h = hubFor("fake-mcp", 4); // the limit is long enough to tell "at once" from "at the limit"
    await h.start("h");
    try {
      const t0 = Date.now();
      await assert.rejects(
        h.call("h", "die", {}, "die-1"),
        (e: Error) => /closed/i.test(e.message) && !/timed out|timeout/i.test(e.message),
      );
      assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0} ms: waited for the time limit`);
      const [s] = h.overview();
      assert.equal(s.status, "stopped");
      assert.equal(s.error, "The server stopped.");
    } finally {
      await h.stopAll();
    }
  },
);

test("hub: tools/list is followed across every page", { timeout: 15_000 }, async () => {
  const h = hubFor("fake-paged-mcp", 5);
  await h.start("h");
  try {
    const [s] = h.overview();
    assert.equal(s.status, "ready", s.error ?? "");
    assert.deepEqual(
      s.tools.map((t: any) => t.name),
      ["first_page_tool", "second_page_tool", "third_page_tool"],
    );
  } finally {
    await h.stopAll();
  }
});

test(
  "hub: results from a tool on an earlier page are still checked against its output schema",
  { timeout: 15_000 },
  async () => {
    const h = hubFor("fake-paged-mcp", 5);
    await h.start("h");
    try {
      for (const name of ["first_page_tool", "third_page_tool"])
        await assert.rejects(h.call("h", name, {}, `c-${name}`), /structured|schema/i, name);
    } finally {
      await h.stopAll();
    }
  },
);

test("hub: the overview says where a server runs, for the Inspector command", () => {
  const s = hubFor("fake-mcp", 5).overview()[0];
  assert.equal(s.command, "node");
  assert.deepEqual(s.args, [resolve("dist/test/helpers/fake-mcp.js")]);
  assert.equal(s.cwd, dir);
});
