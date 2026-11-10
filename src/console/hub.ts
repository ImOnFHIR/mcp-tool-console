/**
 * One MCP client per configured server: start, list tools, call with a time limit, cancel,
 * restart, and keep the last 200 lines of each server's error output for the technical drawer.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerConfig } from "./config.js";

export type ServerStatus = "starting" | "ready" | "stopped";

interface Live {
  config: ServerConfig;
  client?: Client;
  status: ServerStatus;
  error?: string;
  log: string[];
  tools: any[];
}

const LOG_LINES = 200;
const MAX_TOOL_PAGES = 100;

/** tools/list is paged: follow nextCursor until it runs out (or repeats, or gets silly). */
async function listAllTools(client: Client): Promise<any[]> {
  const tools: any[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    pages++;
    const r = await client.listTools(cursor === undefined ? undefined : { cursor });
    tools.push(...r.tools);
    cursor = r.nextCursor;
    if (!cursor || seen.has(cursor)) break;
    seen.add(cursor);
  }
  // Each listTools() call makes the SDK forget the output-schema checks of every earlier page, so
  // with several pages only the last page's tools would still have their results validated. Give
  // it the whole list again. (The method is the SDK's own; it isn't in its public types.)
  if (pages > 1)
    (client as unknown as { cacheToolMetadata?: (t: any[]) => void }).cacheToolMetadata?.(tools);
  return tools;
}

/** Hosted mode never starts a command: the only thing it may connect to is one https upstream. */
function assertHostedUpstream(c: ServerConfig) {
  if (!c.upstream || c.command || c.args.length)
    throw new Error("Hosted mode never starts a command; it connects to one upstream only.");
  let u: URL;
  try {
    u = new URL(c.upstream.url);
  } catch {
    throw new Error("The upstream must be a URL.");
  }
  if (u.protocol !== "https:") throw new Error("The upstream must be an https: URL.");
}

export class Hub {
  private servers = new Map<string, Live>();
  private calls = new Map<string, AbortController>();

  /**
   * `hosted: true` makes this hub an MCP client of exactly one https upstream. It then refuses
   * any config that would start a command, here and again at start().
   */
  constructor(
    configs: ServerConfig[],
    private opts: { hosted?: boolean } = {},
  ) {
    if (opts.hosted) {
      if (configs.length !== 1)
        throw new Error("Hosted mode talks to exactly one upstream server.");
      for (const c of configs) assertHostedUpstream(c);
    }
    for (const c of configs)
      this.servers.set(c.id, { config: c, status: "stopped", log: [], tools: [] });
  }

  ids() {
    return [...this.servers.keys()];
  }
  config(id: string) {
    return this.servers.get(id)?.config;
  }

  async start(id: string): Promise<void> {
    const s = this.servers.get(id);
    if (!s) throw new Error(`unknown server ${id}`);
    await this.stop(id);
    s.status = "starting";
    s.error = undefined;
    let transport: Transport;
    if (this.opts.hosted) {
      assertHostedUpstream(s.config);
      transport = new StreamableHTTPClientTransport(new URL(s.config.upstream!.url), {
        requestInit: { headers: s.config.upstream!.headers },
        fetch: s.config.upstream!.fetch,
        redirectPolicy: "same-origin",
      });
    } else {
      const env: Record<string, string> = { ...getDefaultEnvironment() };
      for (const k of s.config.env) if (process.env[k] !== undefined) env[k] = process.env[k]!;
      const stdio = new StdioClientTransport({
        command: s.config.command,
        args: s.config.args,
        cwd: s.config.cwd,
        env,
        stderr: "pipe",
      });
      stdio.stderr?.on("data", (b: Buffer) => {
        s.log.push(...b.toString("utf8").split("\n").filter(Boolean));
        if (s.log.length > LOG_LINES) s.log.splice(0, s.log.length - LOG_LINES);
      });
      transport = stdio;
    }
    const client = new Client({ name: "imonfhir-dev-console", version: "0.1.0" });
    try {
      await client.connect(transport);
      // connect() has already given the transport the SDK's own close handler, which is what fails
      // a call in flight the moment the server dies. Wrap it; replacing it would leave that call
      // waiting for its time limit.
      const sdkOnClose = transport.onclose;
      transport.onclose = () => {
        sdkOnClose?.();
        if (s.client === client) {
          s.status = "stopped";
          s.error = "The server stopped.";
        }
      };
      const tools = await listAllTools(client);
      s.client = client;
      s.tools = tools;
      s.status = "ready";
    } catch (e) {
      s.status = "stopped";
      s.error = `Couldn't start: ${(e as Error).message}`;
      await client.close().catch(() => {});
    }
  }

  async startAll() {
    await Promise.all(this.ids().map((id) => this.start(id)));
  }

  async stop(id: string) {
    const s = this.servers.get(id);
    if (s?.client) {
      const c = s.client;
      s.client = undefined;
      await c.close().catch(() => {});
    }
    if (s) s.status = "stopped";
  }

  async stopAll() {
    await Promise.all(this.ids().map((id) => this.stop(id)));
  }

  overview() {
    return [...this.servers.values()].map((s) => ({
      id: s.config.id,
      label: s.config.label,
      status: s.status,
      error: s.error ?? null,
      tools: s.tools,
      /** How to start this server by hand (for the drawer's Inspector command). */
      command: s.config.command === process.execPath ? "node" : s.config.command,
      args: s.config.args,
      /** The folder the server runs in; relative paths in `args` are relative to it. */
      cwd: s.config.cwd,
      launch: [
        s.config.command === process.execPath ? "node" : s.config.command,
        ...s.config.args,
      ].join(" "),
    }));
  }

  tool(id: string, name: string) {
    return this.servers.get(id)?.tools.find((t) => t.name === name);
  }

  log(id: string) {
    return this.servers.get(id)?.log ?? [];
  }

  /** Calls a tool; aborted by cancel(callId) or by the server's time limit. */
  async call(id: string, name: string, args: Record<string, unknown>, callId: string) {
    const s = this.servers.get(id);
    if (!s?.client || s.status !== "ready")
      throw new Error(`${s?.config.label ?? id} isn't running. Restart it from the console.`);
    const ac = new AbortController();
    this.calls.set(callId, ac);
    try {
      return await s.client.callTool({ name, arguments: args }, undefined, {
        signal: ac.signal,
        timeout: s.config.timeoutSeconds * 1000,
      });
    } finally {
      this.calls.delete(callId);
    }
  }

  cancel(callId: string): boolean {
    const ac = this.calls.get(callId);
    if (!ac) return false;
    ac.abort(new Error("Cancelled."));
    return true;
  }
}
