/**
 * Which MCP servers the dev console starts. Commands come only from these files, never from a request.
 *   console.config.json  committed: relative paths only (this repo's own server)
 *   console.local.json   gitignored: other servers on this machine (e.g. agent-vs-validator)
 * A server's child process gets the MCP SDK's default environment plus only the variables named in
 * `env` — so API keys never reach a tool unless a local config asks for them by name.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export interface ServerConfig {
  id: string;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  /** Extra environment variable names to pass through (default: none). */
  env: string[];
  /** Per-call time limit in seconds (default 60). */
  timeoutSeconds: number;
}

export class ConfigError extends Error {}

function parse(file: string, local: boolean): ServerConfig[] {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(raw.servers)) throw new ConfigError(`${file}: "servers" must be a list`);
  return raw.servers.map((s: any, i: number) => {
    const where = `${file} servers[${i}]`;
    if (!/^[a-z0-9-]{1,40}$/.test(s?.id ?? ""))
      throw new ConfigError(`${where}: id must be lowercase letters, digits or dashes`);
    if (typeof s.label !== "string" || !s.label)
      throw new ConfigError(`${where}: label is required`);
    if (typeof s.command !== "string" || !s.command)
      throw new ConfigError(`${where}: command is required`);
    const args = s.args ?? [];
    if (!Array.isArray(args) || args.some((a: unknown) => typeof a !== "string"))
      throw new ConfigError(`${where}: args must be a list of strings`);
    const cwdRaw = s.cwd ?? ".";
    if (!local && isAbsolute(cwdRaw))
      throw new ConfigError(
        `${where}: the committed config may use relative paths only (put machine paths in console.local.json)`,
      );
    const env = s.env ?? [];
    if (
      !Array.isArray(env) ||
      env.some((e: unknown) => typeof e !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(e as string))
    )
      throw new ConfigError(`${where}: env must be a list of variable names`);
    return {
      id: s.id,
      label: s.label,
      command: s.command === "node" ? process.execPath : s.command,
      args,
      cwd: resolve(dirname(file), cwdRaw),
      env,
      timeoutSeconds: Number(s.timeoutSeconds ?? 60),
    };
  });
}

export function loadConsoleConfig(dir = "."): ServerConfig[] {
  const committed = resolve(dir, "console.config.json");
  const local = resolve(dir, "console.local.json");
  if (!existsSync(committed)) throw new ConfigError(`missing ${committed}`);
  const all = [...parse(committed, false), ...(existsSync(local) ? parse(local, true) : [])];
  const ids = new Set<string>();
  for (const s of all) {
    if (ids.has(s.id)) throw new ConfigError(`server id "${s.id}" is used twice`);
    ids.add(s.id);
  }
  return all;
}
