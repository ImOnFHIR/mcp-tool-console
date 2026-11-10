#!/usr/bin/env node
/**
 * mcp-tool-console: start the dev console on 127.0.0.1 and print its link.
 * Run it from a repo that has a console.config.json (and, optionally, a gitignored console.local.json).
 * PORT (default 4317).
 *
 * CONSOLE_MODE=hosted starts the hosted console instead: one upstream MCP portal, an Access JWT
 * on every request, configuration from CONSOLE_* variables only (see hosted-config.ts and the README).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConsoleConfig } from "./config.js";
import { Hub } from "./hub.js";
import { createConsoleServer } from "./http.js";
import { createAccessVerifier } from "./access-jwt.js";
import { readCatalog } from "./catalog.js";
import {
  HostedConfigError,
  isHostedMode,
  isLoopback,
  loadHostedConfig,
  upstreamServerConfig,
} from "./hosted-config.js";

// The page ships inside this package (dist/ui/console.html), not in the folder you run it from.
const PAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "console.html");
const port = Number(process.env.PORT ?? 4317);

function refuseToStart(message: string): never {
  console.error(`mcp-tool-console: ${message}`);
  process.exit(1);
}

let hosted: boolean;
try {
  hosted = isHostedMode(process.env);
} catch (e) {
  refuseToStart((e as Error).message);
}

const shutdownWith = (hub: Hub, server: { close: () => unknown }) => {
  const shutdown = async () => {
    server.close();
    await hub.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

if (hosted) {
  const bind = process.env.CONSOLE_BIND_ADDRESS?.trim() || "0.0.0.0";
  let cfg;
  try {
    cfg = loadHostedConfig(process.env);
  } catch (e) {
    if (!(e instanceof HostedConfigError)) throw e;
    refuseToStart(
      isLoopback(bind) ? e.message : `${e.message} It won't listen on ${bind} without them.`,
    );
  }
  const verifyOwner = createAccessVerifier({
    teamDomain: cfg.accessTeamDomain,
    aud: cfg.accessAud,
    ownerEmail: cfg.ownerEmail,
  });
  const hub = new Hub([upstreamServerConfig(cfg)], { hosted: true });
  await hub.startAll();
  const server = createConsoleServer({
    hub,
    page: () => readFileSync(PAGE, "utf8"),
    hosted: {
      publicOrigin: cfg.publicOrigin,
      verifyOwner,
      catalog: () => readCatalog(cfg.packagesDir),
    },
  });
  server.listen(port, cfg.bindAddress, () => {
    const s = hub.overview()[0];
    console.log(
      `ImOnFHIR console (hosted) on ${cfg.bindAddress}:${port}: ${s.status === "ready" ? `${s.tools.length} tool(s) from the portal` : s.error}`,
    );
  });
  shutdownWith(hub, server);
} else {
  if (process.env.CONSOLE_BIND_ADDRESS && !isLoopback(process.env.CONSOLE_BIND_ADDRESS.trim()))
    refuseToStart(
      "laptop mode listens on 127.0.0.1 only. Set CONSOLE_MODE=hosted to serve it beyond this machine.",
    );
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
  shutdownWith(hub, server);
}
