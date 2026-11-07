// Build, then run node:test over compiled tests.
// `npm test` runs everything; `npm test -- converter` runs only test files whose name contains "converter".
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

execFileSync("npx", ["tsc", "-p", "."], { stdio: "inherit" });
// The console page and its browser code: typecheck with DOM types, then build the one-file page.
execFileSync("npx", ["tsc", "-p", "tsconfig.ui.json"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/ui-build.mjs"], { stdio: "pipe" });

const filters = process.argv.slice(2);
const dir = "dist/test";
const files = readdirSync(dir, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".test.js"))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .map((f) => join(dir, f));

if (files.length === 0) {
  console.error(`No test files match: ${filters.join(", ") || "(none)"}`);
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
