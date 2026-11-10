import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createAccessVerifier } from "../src/console/access-jwt.js";
import { readCatalog, readPackage } from "../src/console/catalog.js";
import type { ServerConfig } from "../src/console/config.js";
import {
  HostedConfigError,
  isHostedMode,
  loadHostedConfig,
  parseUpstreamUrl,
  upstreamServerConfig,
} from "../src/console/hosted-config.js";
import { Hub } from "../src/console/hub.js";
import { createConsoleServer } from "../src/console/http.js";
import { checkView } from "../src/index.js";
import { AUD, OWNER, TEAM, claims, hs256, makePair, sign, unsigned } from "./helpers/jwt.js";
import { PORTAL_URL, startFakeUpstream } from "./helpers/fake-upstream.js";

const ORIGIN = "https://console.test";
const PACKAGES = resolve("test/fixtures/packages");

// ── configuration ───────────────────────────────────────────────────────────────────────────────
const goodEnv = (): NodeJS.ProcessEnv => ({
  CONSOLE_MODE: "hosted",
  CONSOLE_UPSTREAM_URL: PORTAL_URL,
  CONSOLE_UPSTREAM_CLIENT_ID: "id-1",
  CONSOLE_UPSTREAM_CLIENT_SECRET: "secret-1",
  CONSOLE_ACCESS_TEAM_DOMAIN: TEAM,
  CONSOLE_ACCESS_AUD: AUD,
  CONSOLE_OWNER_EMAIL: OWNER,
  CONSOLE_PUBLIC_ORIGIN: ORIGIN,
});

test("hosted mode: chosen only by CONSOLE_MODE=hosted; anything unknown refuses", () => {
  assert.equal(isHostedMode({}), false);
  assert.equal(isHostedMode({ CONSOLE_MODE: "laptop" }), false);
  assert.equal(isHostedMode({ CONSOLE_MODE: "hosted" }), true);
  assert.throws(() => isHostedMode({ CONSOLE_MODE: "public" }), HostedConfigError);
});

test("hosted config: a missing variable is named", () => {
  for (const k of Object.keys(goodEnv()).filter((n) => n !== "CONSOLE_MODE")) {
    const env = goodEnv();
    delete env[k];
    assert.throws(
      () => loadHostedConfig(env),
      (e: Error) => e instanceof HostedConfigError && e.message.includes(k),
      k,
    );
  }
});

test("hosted config: the upstream is one https URL and nothing else", () => {
  assert.equal(parseUpstreamUrl("https://portal.test/mcp"), "https://portal.test/mcp");
  for (const bad of [
    "http://portal.test/mcp",
    "ws://portal.test/mcp",
    "node server.js",
    "https://a.test/mcp,https://b.test/mcp",
    "https://a.test/mcp https://b.test/mcp",
    "https://a.test/mcp;https://b.test/mcp",
    "https://user:pw@portal.test/mcp",
    "not a url",
  ])
    assert.throws(() => parseUpstreamUrl(bad), HostedConfigError, bad);
});

test("hosted config: origin, team domain and folder are checked", () => {
  for (const [k, v] of [
    ["CONSOLE_PUBLIC_ORIGIN", "http://console.test"],
    ["CONSOLE_PUBLIC_ORIGIN", "https://console.test/path"],
    ["CONSOLE_ACCESS_TEAM_DOMAIN", "evil.example"],
    ["CONSOLE_PACKAGES_DIR", join(tmpdir(), "does-not-exist-here")],
  ])
    assert.throws(() => loadHostedConfig({ ...goodEnv(), [k]: v }), HostedConfigError, `${k}=${v}`);
  const cfg = loadHostedConfig({ ...goodEnv(), CONSOLE_ACCESS_TEAM_DOMAIN: "unit-team" });
  assert.equal(cfg.accessTeamDomain, TEAM);
  assert.equal(cfg.bindAddress, "0.0.0.0");
});

test("hosted config: the service token goes upstream as the two Access headers", () => {
  const c = upstreamServerConfig(loadHostedConfig(goodEnv()));
  assert.deepEqual(c.upstream?.headers, {
    "CF-Access-Client-Id": "id-1",
    "CF-Access-Client-Secret": "secret-1",
  });
  assert.equal(c.command, "");
});

test("hosted code never reads the other service's Access credential variables", () => {
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  for (const f of files("src"))
    assert.doesNotMatch(readFileSync(f, "utf8"), /CF_ACCESS_CLIENT_(ID|SECRET)/, f);
});

test("hosted mode: nothing under src/console can write a file", () => {
  for (const f of readdirSync("src/console")) {
    assert.doesNotMatch(
      readFileSync(join("src/console", f), "utf8"),
      /writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink|rename\(/,
      f,
    );
  }
});

// ── the Access JWT ──────────────────────────────────────────────────────────────────────────────
const NOW = 1_800_000_000;
function verifierFor(
  pairs = [makePair()],
  extra: Partial<Parameters<typeof createAccessVerifier>[0]> = {},
) {
  const urls: string[] = [];
  const v = createAccessVerifier({
    teamDomain: TEAM,
    aud: AUD,
    ownerEmail: OWNER,
    now: () => NOW,
    fetchJwks: async (url) => {
      urls.push(url);
      return { keys: pairs.map((p) => p.jwk) };
    },
    ...extra,
  });
  return { v, urls, pair: pairs[0] };
}
const fresh = (over: Record<string, unknown> = {}) => claims(over, NOW);

test("access jwt: accepts the owner, whatever the case of the email", async () => {
  const { v, pair } = verifierFor();
  assert.deepEqual(await v(sign(pair, fresh())), { ok: true, email: OWNER.toLowerCase() });
  assert.equal((await v(sign(pair, fresh({ email: OWNER.toUpperCase() })))).ok, true);
});

test("access jwt: the key set comes from the team's certs URL and is cached", async () => {
  const { v, urls, pair } = verifierFor();
  for (let i = 0; i < 3; i++) await v(sign(pair, fresh()));
  assert.deepEqual(urls, [`https://${TEAM}/cdn-cgi/access/certs`]);
});

function refusal(
  name: string,
  token: (p: ReturnType<typeof makePair>) => string | undefined,
  reason: string,
) {
  test(`access jwt: refuses ${name}`, async () => {
    const { v, pair } = verifierFor();
    assert.deepEqual(await v(token(pair)), { ok: false, reason });
  });
}
refusal("a missing token", () => undefined, "missing-token");
refusal("a token that is not a JWT", () => "not.a.jwt!", "malformed");
refusal("alg none", () => unsigned(fresh()), "bad-alg");
refusal("HS256, even keyed with the public key", (p) => hs256(p, fresh()), "bad-alg");
refusal("a token signed by another key", () => sign(makePair("k1"), fresh()), "bad-signature");
refusal("a key id nobody published", (p) => sign({ ...p, kid: "other" }, fresh()), "unknown-key");
refusal(
  "a changed payload",
  (p) => {
    const [h, , s] = sign(p, fresh()).split(".");
    const forged = Buffer.from(JSON.stringify(fresh({ email: "someone@example.test" }))).toString(
      "base64url",
    );
    return `${h}.${forged}.${s}`;
  },
  "bad-signature",
);
refusal(
  "another issuer",
  (p) => sign(p, fresh({ iss: "https://other.cloudflareaccess.com" })),
  "bad-issuer",
);
refusal("another audience", (p) => sign(p, fresh({ aud: ["someone-else"] })), "bad-audience");
refusal("an expired token", (p) => sign(p, fresh({ exp: NOW - 31 })), "expired");
refusal("a token with no expiry", (p) => sign(p, { ...fresh(), exp: undefined }), "expired");
refusal("a token not valid yet", (p) => sign(p, fresh({ nbf: NOW + 31 })), "not-yet-valid");
refusal(
  "a service-token JWT (no email)",
  (p) => sign(p, { ...fresh(), email: undefined }),
  "no-email",
);
refusal(
  "another person's email",
  (p) => sign(p, fresh({ email: "other@example.test" })),
  "not-owner",
);

test("access jwt: a small leeway forgives clock drift, no more", async () => {
  const { v, pair } = verifierFor();
  assert.equal((await v(sign(pair, fresh({ exp: NOW - 29 })))).ok, true);
  assert.equal((await v(sign(pair, fresh({ nbf: NOW + 29 })))).ok, true);
});

test("access jwt: a string aud is accepted when it matches", async () => {
  const { v, pair } = verifierFor();
  assert.equal((await v(sign(pair, fresh({ aud: AUD })))).ok, true);
});

test("access jwt: a rotated key is found by one refetch, and an unknown key can't force more", async () => {
  const oldPair = makePair("old");
  const newPair = makePair("new");
  let published = [oldPair];
  let fetches = 0;
  let clock = NOW;
  const v = createAccessVerifier({
    teamDomain: TEAM,
    aud: AUD,
    ownerEmail: OWNER,
    now: () => clock,
    minRefetchSeconds: 30,
    fetchJwks: async () => {
      fetches++;
      return { keys: published.map((p) => p.jwk) };
    },
  });
  assert.equal((await v(sign(oldPair, claims({}, clock)))).ok, true);
  published = [oldPair, newPair];
  clock += 40; // past the refetch limit, well inside the cache time
  assert.equal((await v(sign(newPair, claims({}, clock)))).ok, true);
  clock += 40;
  const fetchesBefore = fetches;
  for (let i = 0; i < 5; i++)
    assert.deepEqual(await v(sign({ ...oldPair, kid: `junk-${i}` }, claims({}, clock))), {
      ok: false,
      reason: "unknown-key",
    });
  assert.equal(fetches - fetchesBefore, 1, "guessing key ids must not trigger a fetch each time");
});

test("access jwt: overlapping requests share one key fetch instead of failing", async () => {
  const pair = makePair();
  let fetches = 0;
  const v = createAccessVerifier({
    teamDomain: TEAM,
    aud: AUD,
    ownerEmail: OWNER,
    now: () => NOW,
    fetchJwks: async () => {
      fetches++;
      await new Promise((r) => setTimeout(r, 30));
      return { keys: [pair.jwk] };
    },
  });
  const verdicts = await Promise.all([1, 2, 3, 4].map(() => v(sign(pair, fresh()))));
  assert.deepEqual(
    verdicts.map((x) => x.ok),
    [true, true, true, true],
  );
  assert.equal(fetches, 1);
});

test("access jwt: keys older than the cache time are not trusted when the refresh fails", async () => {
  const pair = makePair();
  let down = false;
  let clock = NOW;
  const v = createAccessVerifier({
    teamDomain: TEAM,
    aud: AUD,
    ownerEmail: OWNER,
    now: () => clock,
    cacheSeconds: 600,
    minRefetchSeconds: 30,
    fetchJwks: async () => {
      if (down) throw new Error("down");
      return { keys: [pair.jwk] };
    },
  });
  assert.equal((await v(sign(pair, claims({}, clock)))).ok, true);
  down = true;
  clock += 300; // inside the cache time: still served from the cache
  assert.equal((await v(sign(pair, claims({}, clock)))).ok, true);
  clock += 400; // past it, and the certs endpoint is down: nobody gets in
  assert.deepEqual(await v(sign(pair, claims({}, clock))), {
    ok: false,
    reason: "jwks-unavailable",
  });
  down = false;
  clock += 31; // the endpoint is back and the owner is let in again
  assert.equal((await v(sign(pair, claims({}, clock)))).ok, true);
});

test("access jwt: if the key set can't be fetched, nobody gets in", async () => {
  const pair = makePair();
  const v = createAccessVerifier({
    teamDomain: TEAM,
    aud: AUD,
    ownerEmail: OWNER,
    now: () => NOW,
    fetchJwks: async () => {
      throw new Error("down");
    },
  });
  assert.deepEqual(await v(sign(pair, fresh())), { ok: false, reason: "jwks-unavailable" });
});

// ── the hosted server ───────────────────────────────────────────────────────────────────────────
let upstream: Awaited<ReturnType<typeof startFakeUpstream>>;
let hub: Hub;
let srv: ReturnType<typeof createConsoleServer>;
let port = 0;
const pair = makePair();
const logs: string[] = [];

const hostedHub = (cfg?: Partial<ServerConfig>) =>
  new Hub(
    [
      {
        ...upstreamServerConfig(loadHostedConfig(goodEnv())),
        ...cfg,
        upstream: {
          ...upstreamServerConfig(loadHostedConfig(goodEnv())).upstream!,
          fetch: upstream.viaHttps,
        },
      },
    ],
    { hosted: true },
  );

before(async () => {
  upstream = await startFakeUpstream();
  hub = hostedHub();
  await hub.startAll();
  srv = createConsoleServer({
    hub,
    page: () => "<!doctype html><title>t</title>",
    hosted: {
      publicOrigin: ORIGIN,
      verifyOwner: createAccessVerifier({
        teamDomain: TEAM,
        aud: AUD,
        ownerEmail: OWNER,
        fetchJwks: async () => ({ keys: [pair.jwk] }),
      }),
      catalog: () => readCatalog(PACKAGES),
      log: (l) => logs.push(l),
    },
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  port = (srv.address() as AddressInfo).port;
});
after(async () => {
  srv.close();
  await hub.stopAll();
  await upstream.close();
});

interface Opts {
  method?: string;
  body?: unknown;
  jwt?: string | null;
  host?: string;
  origin?: string | null;
  marker?: string | null;
}
function call(path: string, o: Opts = {}): Promise<{ status: number; json: any; text: string }> {
  return new Promise((res, rej) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const headers: Record<string, string> = { host: o.host ?? "console.test" };
    const jwt = o.jwt === undefined ? sign(pair) : o.jwt;
    if (jwt !== null) headers["cf-access-jwt-assertion"] = jwt;
    if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
    if (o.marker !== null) headers["x-console-request"] = o.marker ?? "1";
    if (data !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
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
          res({ status: r.statusCode!, json: j, text: t });
        });
      },
    );
    req.on("error", rej);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

test("hosted server: every request, the page included, needs the owner's Access JWT", async () => {
  const stranger = sign(pair, claims({ email: "stranger@example.test" }));
  const serviceToken = sign(pair, { ...claims(), email: undefined });
  for (const path of ["/", "/api/tools", "/api/catalog"]) {
    for (const jwt of [null, "junk", stranger, serviceToken, unsigned(claims())]) {
      const r = await call(path, { jwt });
      assert.equal(r.status, 403, `${path} with ${jwt?.slice(0, 12)}`);
      assert.match(r.json.error, /owner/);
    }
    assert.equal((await call(path)).status, 200, path);
  }
});

test("hosted server: the token never reaches a log line", async () => {
  const secret = sign(pair, claims({ email: "stranger@example.test" }));
  logs.length = 0;
  await call("/api/tools", { jwt: secret });
  await call("/api/tools", { jwt: "junk-token-value" });
  assert.deepEqual(logs, ["access refused: not-owner", "access refused: malformed"]);
  for (const l of logs) assert.ok(!l.includes(secret) && !l.includes("junk-token-value"));
});

test("hosted server: an Origin other than the public one is refused", async () => {
  for (const origin of ["https://evil.example", "http://console.test", "null"]) {
    assert.equal((await call("/api/tools", { origin })).status, 403, origin);
    assert.equal(
      (await call("/api/call", { origin, body: { server: "portal", tool: "echo" } })).status,
      403,
    );
  }
  // A POST with no Origin at all is not a browser's same-origin call either.
  assert.equal(
    (await call("/api/call", { origin: null, body: { server: "portal", tool: "echo" } })).status,
    403,
  );
  // A browser's own same-origin GET carries no Origin header.
  assert.equal((await call("/api/tools", { origin: null })).status, 200);
});

test("hosted server: a request without the console's custom header is refused", async () => {
  assert.equal((await call("/api/tools", { marker: null })).status, 403);
  assert.equal((await call("/api/tools", { marker: "0" })).status, 403);
  assert.equal(
    (await call("/api/call", { marker: null, body: { server: "portal", tool: "echo" } })).status,
    403,
  );
});

test("hosted server: the Host header must be the public origin's host", async () => {
  assert.equal((await call("/api/tools", { host: "evil.example" })).status, 403);
  assert.equal((await call("/", { host: `127.0.0.1:${port}` })).status, 403);
});

test("hosted server: lists the portal's tools and runs them under the same gates", async () => {
  const list = await call("/api/tools");
  const [s] = list.json.servers;
  assert.equal(s.id, "portal");
  assert.equal(s.status, "ready", s.error ?? "");
  assert.deepEqual(s.tools.map((t: any) => t.name).toSorted(), ["echo", "paid", "write_thing"]);
  assert.equal(s.command, "");
  assert.doesNotMatch(JSON.stringify(list.json), /secret-1|CF-Access/);

  const echo = await call("/api/call", {
    body: { server: "portal", tool: "echo", args: { text: "hi" } },
  });
  assert.equal(echo.json.result.content[0].text, "echo: hi");
  const w = await call("/api/call", { body: { server: "portal", tool: "write_thing" } });
  assert.equal(w.status, 403);
  assert.match(w.json.error, /read-only/);
  assert.equal((await call("/api/call", { body: { server: "portal", tool: "paid" } })).status, 402);
  const paid = await call("/api/call", {
    body: { server: "portal", tool: "paid", confirmCost: true },
  });
  assert.equal(paid.json.result.content[0].text, "spent");
});

test("hosted server: the portal is sent this console's own service token", () => {
  assert.ok(upstream.seen.length > 0);
  for (const h of upstream.seen) {
    assert.equal(h["cf-access-client-id"], "id-1");
    assert.equal(h["cf-access-client-secret"], "secret-1");
    assert.equal(h["cf-access-jwt-assertion"], undefined, "the owner's JWT is not forwarded");
  }
});

test("hosted server: no write routes; PATCH, PUT and DELETE are a 405", async () => {
  for (const method of ["PATCH", "PUT", "DELETE"])
    for (const path of ["/api/tools", "/api/call", "/api/servers/portal", "/api/catalog"]) {
      const r = await call(path, { method, body: { enabled: false } });
      assert.equal(r.status, 405, `${method} ${path}`);
      assert.match(r.json.error, /no write routes/);
    }
});

test("hosted server: /api/catalog serves the fixture package", async () => {
  const r = await call("/api/catalog");
  assert.equal(r.status, 200);
  assert.equal(r.json.servers.length, 1);
  assert.equal(r.json.servers[0].id, "sample");
});

test("laptop mode does not serve /api/catalog", async () => {
  const lap = createConsoleServer({ hub: new Hub([]), token: "t", page: () => "x" });
  await new Promise<void>((r) => lap.listen(0, "127.0.0.1", r));
  const p = (lap.address() as AddressInfo).port;
  try {
    const status = await new Promise<number>((res, rej) =>
      request(
        {
          host: "127.0.0.1",
          port: p,
          path: "/api/catalog",
          headers: { host: `127.0.0.1:${p}`, "x-console-token": "t" },
        },
        (r) => (r.resume(), res(r.statusCode!)),
      )
        .on("error", rej)
        .end(),
    );
    assert.notEqual(status, 200, "the catalog is hosted-only");
  } finally {
    lap.close();
  }
});

// ── the hub in hosted mode ──────────────────────────────────────────────────────────────────────
test("hosted hub: never starts a command, whatever the config says", async () => {
  const stdio: ServerConfig = {
    id: "x",
    label: "X",
    command: process.execPath,
    args: ["-e", "1"],
    cwd: ".",
    env: [],
    timeoutSeconds: 5,
  };
  assert.throws(() => new Hub([stdio], { hosted: true }), /never starts a command/);
  // Even a config that names a URL can't smuggle a command in beside it.
  assert.throws(
    () => new Hub([{ ...stdio, upstream: { url: PORTAL_URL, headers: {} } }], { hosted: true }),
    /never starts a command/,
  );
  // And a hub that was given a laptop config can't be told afterwards to go hosted-style.
  const h = hostedHub();
  (h as any).servers.get("portal").config.upstream = undefined;
  await h.start("portal").then(
    () => assert.fail("should refuse"),
    (e: Error) => assert.match(e.message, /never starts a command/),
  );
});

test("hosted hub: one https upstream only", () => {
  const base = upstreamServerConfig(loadHostedConfig(goodEnv()));
  assert.throws(
    () =>
      new Hub([{ ...base, upstream: { url: "http://portal.test/mcp", headers: {} } }], {
        hosted: true,
      }),
    /https/,
  );
  assert.throws(() => new Hub([base, { ...base, id: "two" }], { hosted: true }), /exactly one/);
  assert.throws(() => new Hub([], { hosted: true }), /exactly one/);
});

test("hosted hub: a portal that dropped our session shows as stopped, and Restart brings it back", async () => {
  const h = hostedHub();
  await h.start("portal");
  try {
    assert.equal(h.overview()[0].status, "ready");
    upstream.state.sessionLost = true;
    // Two tabs hit the dead session together: both fail cleanly (the portal's answer, or the closed connection), neither crashes.
    const both = await Promise.allSettled([
      h.call("portal", "echo", {}, "lost-1"),
      h.call("portal", "echo", {}, "lost-1b"),
    ]);
    for (const r of both) {
      assert.equal(r.status, "rejected");
      assert.match(String((r as PromiseRejectedResult).reason), /session not found|closed/i);
    }
    assert.equal(h.overview()[0].status, "stopped");
    assert.equal(h.overview()[0].error, "The portal ended the session.");
    upstream.state.sessionLost = false;
    await h.start("portal");
    assert.equal(h.overview()[0].status, "ready");
    const r = await h.call("portal", "echo", { text: "back" }, "lost-2");
    assert.equal((r as any).content[0].text, "echo: back");
  } finally {
    upstream.state.sessionLost = false;
    await h.stopAll();
  }
});

test("hosted hub: a JSON-RPC error numbered 404 is not a lost session", async () => {
  // The portal answers 200 with an application-level error whose code happens to be 404.
  const appError: typeof fetch = async (input, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (body?.method === "tools/call")
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: 404, message: "no such thing" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    return upstream.viaHttps(input, init);
  };
  const cfg = upstreamServerConfig(loadHostedConfig(goodEnv()));
  const h = new Hub([{ ...cfg, upstream: { ...cfg.upstream!, fetch: appError } }], {
    hosted: true,
  });
  await h.start("portal");
  try {
    await assert.rejects(h.call("portal", "echo", {}, "app-1"), /no such thing/);
    assert.equal(h.overview()[0].status, "ready");
  } finally {
    await h.stopAll();
  }
});

test("hosted hub: stopping or restarting ends the portal session", async () => {
  const stateful = await startFakeUpstream({ stateful: true });
  try {
    const cfg = upstreamServerConfig(loadHostedConfig(goodEnv()));
    const h = new Hub([{ ...cfg, upstream: { ...cfg.upstream!, fetch: stateful.viaHttps } }], {
      hosted: true,
    });
    await h.start("portal");
    assert.equal(h.overview()[0].status, "ready", h.overview()[0].error ?? "");
    assert.deepEqual(stateful.closedSessions, []);
    await h.stopAll();
    assert.equal(stateful.closedSessions.length, 1, "the session was left open upstream");
  } finally {
    await stateful.close();
  }
});

// ── the catalog ─────────────────────────────────────────────────────────────────────────────────
test("catalog: reads the sample package", async () => {
  const c = await readCatalog(PACKAGES);
  assert.deepEqual(c, {
    servers: [
      {
        id: "sample",
        tools: [JSON.parse(readFileSync(join(PACKAGES, "sample/tools/echo.json"), "utf8"))],
        runs: [{ tool: "echo", file: "echo/first.json", recorded: "recorded-run-1" }],
      },
    ],
  });
});

test("catalog: the fixture's views are valid ToolView v1", () => {
  const dir = join(PACKAGES, "sample/views/echo");
  for (const f of readdirSync(dir))
    assert.deepEqual(checkView(JSON.parse(readFileSync(join(dir, f), "utf8"))), [], f);
});

test("catalog: no folder, or a missing one, is an empty catalog", async () => {
  assert.deepEqual(await readCatalog(undefined), { servers: [] });
  assert.deepEqual(await readCatalog(join(tmpdir(), "no-such-packages-dir")), { servers: [] });
});

function treeStamp(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .map((e) => join(e.parentPath, e.name))
    .toSorted()
    .map((p) => `${p}:${statSync(p).mtimeMs}:${statSync(p).size}`);
}

test("catalog: no id or file name reaches outside the folder, and nothing is written", async () => {
  const base = mkdtempSync(join(tmpdir(), "catalog-"));
  const root = join(base, "packages");
  const outside = join(base, "outside");
  cpSync(PACKAGES, root, { recursive: true });
  mkdirSync(join(outside, "tools"), { recursive: true });
  mkdirSync(join(outside, "runs/echo"), { recursive: true });
  const leak = JSON.stringify({ name: "leaked-tool", v: 1, recorded: "leaked-run" });
  writeFileSync(join(outside, "package.json"), "{}");
  writeFileSync(join(outside, "tools/t.json"), leak);
  writeFileSync(join(outside, "runs/echo/r.json"), leak);
  writeFileSync(join(outside, "secret.json"), leak);
  // A package reached by a link, a tools folder reached by a link, a run folder and a run file likewise.
  symlinkSync(outside, join(root, "linked"));
  mkdirSync(join(root, "half/runs"), { recursive: true });
  writeFileSync(join(root, "half/package.json"), "{}");
  symlinkSync(join(outside, "tools"), join(root, "half/tools"));
  symlinkSync(join(outside, "runs/echo"), join(root, "half/runs/echo"));
  symlinkSync(join(outside, "secret.json"), join(root, "sample/tools/escape.json"));
  symlinkSync(join(outside, "secret.json"), join(root, "sample/runs/echo/escape.json"));

  const stampBefore = treeStamp(root);
  for (const id of [
    "..",
    "../outside",
    "../packages/sample",
    "sample/../../outside",
    "/etc",
    outside,
    "sample/",
    "linked",
    "a\0b",
    "",
  ])
    assert.equal(await readPackage(root, id), null, JSON.stringify(id));

  const c = await readCatalog(root);
  assert.deepEqual(
    c.servers.map((s) => s.id),
    ["half", "sample"],
  );
  assert.doesNotMatch(JSON.stringify(c), /leaked/);
  assert.deepEqual(c.servers[0], { id: "half", tools: [], runs: [] });
  assert.deepEqual(c.servers[1].runs, [
    { tool: "echo", file: "echo/first.json", recorded: "recorded-run-1" },
  ]);
  assert.equal(c.servers[1].tools.length, 1);
  assert.deepEqual(treeStamp(root), stampBefore, "reading the catalog changed the folder");
});

// ── the process: refuse to start unsafe ────────────────────────────────────────────────────────
const cli = resolve("dist/src/console/cli.js");
const runCli = (env: Record<string, string>) =>
  spawnSync(process.execPath, [cli], {
    cwd: mkdtempSync(join(tmpdir(), "cli-")),
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 20_000,
  });

test("hosted cli: a non-loopback bind without the Access settings exits non-zero and names them", () => {
  const r = runCli({
    CONSOLE_MODE: "hosted",
    CONSOLE_BIND_ADDRESS: "0.0.0.0",
    CONSOLE_UPSTREAM_URL: PORTAL_URL,
    CONSOLE_UPSTREAM_CLIENT_ID: "id-1",
    CONSOLE_UPSTREAM_CLIENT_SECRET: "secret-1",
    CONSOLE_PUBLIC_ORIGIN: ORIGIN,
  });
  assert.notEqual(r.status, 0);
  for (const name of ["CONSOLE_ACCESS_TEAM_DOMAIN", "CONSOLE_ACCESS_AUD", "CONSOLE_OWNER_EMAIL"])
    assert.match(r.stderr, new RegExp(name));
  assert.doesNotMatch(r.stderr, /secret-1/);
});

test("hosted cli: with nothing set at all it refuses too, naming every variable", () => {
  const r = runCli({ CONSOLE_MODE: "hosted" });
  assert.notEqual(r.status, 0);
  for (const name of ["CONSOLE_UPSTREAM_URL", "CONSOLE_ACCESS_AUD", "CONSOLE_PUBLIC_ORIGIN"])
    assert.match(r.stderr, new RegExp(name));
});

test("hosted cli: a plain http upstream refuses to start", () => {
  const r = runCli({
    ...(goodEnv() as Record<string, string>),
    CONSOLE_UPSTREAM_URL: "http://portal.test/mcp",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CONSOLE_UPSTREAM_URL/);
});

test("laptop cli: refuses a non-loopback bind and an unknown mode", () => {
  const a = runCli({ CONSOLE_BIND_ADDRESS: "0.0.0.0" });
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /127\.0\.0\.1 only/);
  const b = runCli({ CONSOLE_MODE: "public" });
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /CONSOLE_MODE/);
});

test("hosted cli: the running process answers 403 to a request with no Access JWT", async () => {
  const p = 20_000 + Math.floor(Math.random() * 20_000);
  const child = spawn(process.execPath, [cli], {
    cwd: mkdtempSync(join(tmpdir(), "cli-run-")),
    // Nothing listens at this upstream; the console still starts and answers.
    env: {
      PATH: process.env.PATH ?? "",
      ...(goodEnv() as Record<string, string>),
      CONSOLE_UPSTREAM_URL: "https://127.0.0.1:1/mcp",
      CONSOLE_BIND_ADDRESS: "127.0.0.1",
      PORT: String(p),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("the console did not start")), 15_000);
      child.stdout.on("data", (b) => /\(hosted\)/.test(String(b)) && (clearTimeout(t), res()));
      child.on("exit", (c) => (clearTimeout(t), rej(new Error(`exited ${c}`))));
    });
    const status = await new Promise<number>((res, rej) =>
      request(
        { host: "127.0.0.1", port: p, path: "/", headers: { host: "console.test" } },
        (r) => (r.resume(), res(r.statusCode!)),
      )
        .on("error", rej)
        .end(),
    );
    assert.equal(status, 403);
  } finally {
    child.kill("SIGTERM");
  }
});
