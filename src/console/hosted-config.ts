/**
 * Hosted mode's configuration. It comes only from environment variables, all of them this
 * console's own. A command, a local server config or another service's credentials is never read.
 *
 *   CONSOLE_MODE                    "hosted" selects this mode (anything else, or nothing, is laptop mode)
 *   CONSOLE_UPSTREAM_URL            the one MCP server portal: a single https: URL
 *   CONSOLE_UPSTREAM_CLIENT_ID      this console's service token, sent as CF-Access-Client-Id
 *   CONSOLE_UPSTREAM_CLIENT_SECRET  ... and CF-Access-Client-Secret
 *   CONSOLE_ACCESS_TEAM_DOMAIN      <team>.cloudflareaccess.com (a bare team name also works)
 *   CONSOLE_ACCESS_AUD              the Access application's audience tag
 *   CONSOLE_OWNER_EMAIL             the one person allowed in
 *   CONSOLE_PUBLIC_ORIGIN           https origin the page is served from
 *   CONSOLE_PACKAGES_DIR            optional: folder of tool packages for /api/catalog
 *   CONSOLE_BIND_ADDRESS            optional: default 0.0.0.0
 */
import { statSync } from "node:fs";
import type { ServerConfig } from "./config.js";

export class HostedConfigError extends Error {}

export interface HostedConfig {
  upstreamUrl: string;
  upstreamClientId: string;
  upstreamClientSecret: string;
  accessTeamDomain: string;
  accessAud: string;
  ownerEmail: string;
  publicOrigin: string;
  packagesDir?: string;
  bindAddress: string;
}

export const ACCESS_ENV = [
  "CONSOLE_ACCESS_TEAM_DOMAIN",
  "CONSOLE_ACCESS_AUD",
  "CONSOLE_OWNER_EMAIL",
] as const;
const REQUIRED = [
  "CONSOLE_UPSTREAM_URL",
  "CONSOLE_UPSTREAM_CLIENT_ID",
  "CONSOLE_UPSTREAM_CLIENT_SECRET",
  ...ACCESS_ENV,
  "CONSOLE_PUBLIC_ORIGIN",
] as const;

export function isHostedMode(env: NodeJS.ProcessEnv): boolean {
  const m = env.CONSOLE_MODE;
  if (m === undefined || m === "" || m === "laptop") return false;
  if (m === "hosted") return true;
  throw new HostedConfigError(`CONSOLE_MODE must be "hosted" or "laptop", not "${m}".`);
}

export function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

/** `team` or `team.cloudflareaccess.com`; anything else is refused so JWKS is only ever fetched from Cloudflare. */
export function normalizeTeamDomain(raw: string): string {
  const d = raw.trim().toLowerCase();
  const full = d.includes(".") ? d : `${d}.cloudflareaccess.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(full))
    throw new HostedConfigError("CONSOLE_ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com.");
  return full;
}

const bad = (why: string) => new HostedConfigError(`CONSOLE_UPSTREAM_URL ${why}.`);

/** One https: URL, no credentials in it, nothing after it. */
export function parseUpstreamUrl(raw: string): string {
  if (/[\s,;]/.test(raw)) throw bad("must be a single URL");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad("must be a URL");
  }
  if (u.protocol !== "https:") throw bad("must start with https://");
  if (u.username || u.password) throw bad("must not carry a user name or password");
  return u.toString();
}

function parseOrigin(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HostedConfigError("CONSOLE_PUBLIC_ORIGIN must be an origin such as https://host.");
  }
  if (u.protocol !== "https:" || u.origin !== raw.replace(/\/$/, ""))
    throw new HostedConfigError(
      "CONSOLE_PUBLIC_ORIGIN must be an https origin only (no path), such as https://host.",
    );
  return u.origin;
}

/** Throws HostedConfigError naming every variable that is missing or wrong. */
export function loadHostedConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  if (missing.length)
    throw new HostedConfigError(`Hosted mode needs these set: ${missing.join(", ")}.`);
  const dir = env.CONSOLE_PACKAGES_DIR?.trim() || undefined;
  if (dir) {
    let ok = false;
    try {
      ok = statSync(dir).isDirectory();
    } catch {
      /* not there */
    }
    if (!ok) throw new HostedConfigError("CONSOLE_PACKAGES_DIR must be an existing folder.");
  }
  return {
    upstreamUrl: parseUpstreamUrl(env.CONSOLE_UPSTREAM_URL!.trim()),
    upstreamClientId: env.CONSOLE_UPSTREAM_CLIENT_ID!.trim(),
    upstreamClientSecret: env.CONSOLE_UPSTREAM_CLIENT_SECRET!.trim(),
    accessTeamDomain: normalizeTeamDomain(env.CONSOLE_ACCESS_TEAM_DOMAIN!),
    accessAud: env.CONSOLE_ACCESS_AUD!.trim(),
    ownerEmail: env.CONSOLE_OWNER_EMAIL!.trim(),
    publicOrigin: parseOrigin(env.CONSOLE_PUBLIC_ORIGIN!.trim()),
    packagesDir: dir,
    bindAddress: env.CONSOLE_BIND_ADDRESS?.trim() || "0.0.0.0",
  };
}

/** The hub's one server in hosted mode: the portal. Its headers are the console's own service token. */
export function upstreamServerConfig(h: HostedConfig): ServerConfig {
  return {
    id: "portal",
    label: "Tool portal",
    command: "",
    args: [],
    cwd: "",
    env: [],
    timeoutSeconds: 60,
    upstream: {
      url: h.upstreamUrl,
      headers: {
        "CF-Access-Client-Id": h.upstreamClientId,
        "CF-Access-Client-Secret": h.upstreamClientSecret,
      },
    },
  };
}
