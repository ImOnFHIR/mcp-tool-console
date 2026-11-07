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

test("console code never imports the AI SDK or spend code", () => {
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
    );
  for (const f of [...files("src/console"), ...files("src/ui")]) {
    const t = readFileSync(f, "utf8");
    assert.doesNotMatch(t, /@anthropic-ai\/sdk|spend\.js|alert\.js|matchers\/llm/, f);
  }
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
