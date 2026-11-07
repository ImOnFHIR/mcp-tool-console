/**
 * One MCP client per configured server: start, list tools, call with a time limit, cancel,
 * restart, and keep the last 200 lines of each server's error output for the technical drawer.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
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

export class Hub {
  private servers = new Map<string, Live>();
  private calls = new Map<string, AbortController>();

  constructor(configs: ServerConfig[]) {
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
    const env: Record<string, string> = { ...getDefaultEnvironment() };
    for (const k of s.config.env) if (process.env[k] !== undefined) env[k] = process.env[k]!;
    const transport = new StdioClientTransport({
      command: s.config.command,
      args: s.config.args,
      cwd: s.config.cwd,
      env,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (b: Buffer) => {
      s.log.push(...b.toString("utf8").split("\n").filter(Boolean));
      if (s.log.length > LOG_LINES) s.log.splice(0, s.log.length - LOG_LINES);
    });
    const client = new Client({ name: "imonfhir-dev-console", version: "0.1.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      s.client = client;
      s.tools = tools;
      s.status = "ready";
      transport.onclose = () => {
        if (s.client === client) {
          s.status = "stopped";
          s.error = "The server stopped.";
        }
      };
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
