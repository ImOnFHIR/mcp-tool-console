#!/usr/bin/env node
/**
 * mcp-tool-console: start the dev console on 127.0.0.1 and print its link.
 * Run it from a repo that has a console.config.json (and, optionally, a gitignored console.local.json).
 * PORT (default 4317).
 *   mcp-tool-console package [--server <id>] [--out <dir>] [--runs <dir>]   writes a pinnable package
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConsoleConfig } from "./config.js";
import { Hub } from "./hub.js";
import { createConsoleServer } from "./http.js";

// The page ships inside this package (dist/ui/console.html), not in the folder you run it from.
const PAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "console.html");
if (process.argv[2] === "package") {
  const { runPackageCommand } = await import("../package.js");
  process.exit(await runPackageCommand(process.argv.slice(3), process.cwd()));
}
const port = Number(process.env.PORT ?? 4317);
const token = randomBytes(18).toString("base64url");
const hub = new Hub(loadConsoleConfig(process.cwd()));
await hub.startAll();
const server = createConsoleServer({ hub, token, page: () => readFileSync(PAGE, "utf8") });
server.listen(port, "127.0.0.1", () => {
  console.log("ImOnFHIR dev console (local only)\n");
  for (const s of hub.overview())
    console.log(
      `  ${s.status === "ready" ? "●" : "○"} ${s.label}: ${s.status === "ready" ? `${s.tools.length} tool(s)` : s.error}`,
    );
  console.log(`\nOpen: http://127.0.0.1:${port}/#token=${token}\nStop: Ctrl+C`);
});
const shutdown = async () => {
  server.close();
  await hub.stopAll();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
