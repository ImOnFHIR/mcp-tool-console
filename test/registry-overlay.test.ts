import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Ajv } from "ajv";

const FIX = resolve("test/fixtures/registry-overlay");
const read = (p: string) => readFileSync(p, "utf8");
const json = (p: string) => JSON.parse(read(p));

// sha256 of the MCP Registry's published server.json schema, as fetched from its static host.
const PUBLISHED_SHA256 = "3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0";
const PUBLISHED_ID = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

function validators() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addFormat("uri", (s: string) => URL.canParse(s));
  const published = ajv.compile(json(join(FIX, "server.schema.2025-12-11.json")));
  const overlay = ajv.compile(json(resolve("docs/registry-overlay.schema.json")));
  return { published, overlay };
}

/** The one path each negative fixture must fail on. */
const NEGATIVE: Record<string, string> = {
  "internal-url": "/remotes/0/url",
  "ip-literal": "/remotes/0/url",
  localhost: "/remotes/0/url",
  "plain-http": "/remotes/0/url",
  "env-key": "/_meta/com.imonfhir~1registry/local",
  "package-env": "/packages/0/environmentVariables",
  "absolute-cwd": "/_meta/com.imonfhir~1registry/local/cwd",
  "tool-raises-public": "/_meta/com.imonfhir~1registry/tools/a_tool/public",
  "unknown-tier": "/_meta/com.imonfhir~1registry/tier",
  "never-public-but-public": "/_meta/com.imonfhir~1registry/public",
  "ipv4-shorthand": "/remotes/0/url",
  "ipv4-hex": "/remotes/0/url",
  "package-headers": "/packages/0/transport/headers",
  "tool-never-public-but-public": "/_meta/com.imonfhir~1registry/tools/a_tool/public",
  "tool-never-public-inherits-public": "/_meta/com.imonfhir~1registry/tools/a_tool",
  "cwd-unc": "/_meta/com.imonfhir~1registry/local/cwd",
  "cwd-backslash-traversal": "/_meta/com.imonfhir~1registry/local/cwd",
  "browser-without-package": "/_meta/com.imonfhir~1registry",
};

test("registry overlay: the published schema copy is byte for byte the pinned one", () => {
  const raw = read(join(FIX, "server.schema.2025-12-11.json"));
  assert.equal(createHash("sha256").update(raw).digest("hex"), PUBLISHED_SHA256);
  assert.equal(JSON.parse(raw).$id, PUBLISHED_ID);
});

test("registry overlay: the valid entry passes the published schema and the overlay", () => {
  const { published, overlay } = validators();
  const entry = json(join(FIX, "valid.json"));
  assert.equal(published(entry), true, JSON.stringify(published.errors));
  assert.equal(overlay(entry), true, JSON.stringify(overlay.errors));
});

test("registry overlay: the negative fixtures are exactly the ones listed", () => {
  const files = readdirSync(join(FIX, "negative"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  assert.deepEqual(files.sort(), Object.keys(NEGATIVE).sort());
});

for (const [id, path] of Object.entries(NEGATIVE)) {
  test(`registry overlay: negative ${id} is a valid server.json that fails the overlay at ${path}`, () => {
    const { published, overlay } = validators();
    const fx = json(join(FIX, "negative", `${id}.json`));
    assert.equal(
      published(fx),
      true,
      `${id} should be a valid server.json: ${JSON.stringify(published.errors)}`,
    );
    assert.equal(overlay(fx), false, `${id} passed the overlay`);
    const paths = (overlay.errors ?? []).map((e) => e.instancePath);
    assert.ok(
      paths.includes(path),
      `${id}: expected an error at ${path}, got ${JSON.stringify(paths)}`,
    );
  });
}
