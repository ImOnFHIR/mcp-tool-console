// A fake portal for hosted-mode tests: an MCP server over Streamable HTTP (stateless) on 127.0.0.1.
// It records the headers each request carried. `viaHttps` is a fetch that sends a call addressed to
// https://portal.test/mcp to it, so the Hub can be given the https URL it insists on.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const PORTAL_URL = "https://portal.test/mcp";
const ro = { readOnlyHint: true };
const free = { "com.imonfhir/cost": { free: true } };

function build() {
  const s = new McpServer({ name: "fake-portal", version: "0" });
  s.registerTool(
    "echo",
    { title: "Echo", inputSchema: { text: z.string().optional() }, annotations: ro, _meta: free },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text ?? ""}` }] }),
  );
  s.registerTool(
    "write_thing",
    { title: "Write", inputSchema: {}, annotations: { readOnlyHint: false }, _meta: free },
    async () => ({ content: [{ type: "text", text: "wrote" }] }),
  );
  s.registerTool(
    "paid",
    {
      title: "Paid",
      inputSchema: {},
      annotations: ro,
      _meta: { "com.imonfhir/cost": { free: false, note: "about $0.01" } },
    },
    async () => ({ content: [{ type: "text", text: "spent" }] }),
  );
  return s;
}

export async function startFakeUpstream(o: { stateful?: boolean } = {}) {
  const closedSessions: string[] = [];
  const sessionTransport = o.stateful
    ? new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessionclosed: (id) => void closedSessions.push(id),
      })
    : undefined;
  if (sessionTransport) await build().connect(sessionTransport);
  const state = { sessionLost: false };
  const seen: Record<string, string | string[] | undefined>[] = [];
  const server: Server = createServer(async (req, res) => {
    seen.push({ ...req.headers });
    if (state.sessionLost) {
      res.writeHead(404, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ error: "session not found" }));
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : undefined;
    if (sessionTransport) return void (await sessionTransport.handleRequest(req, res, body));
    const mcp = build();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => void transport.close());
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const viaHttps: typeof fetch = (input, init) => {
    const u = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (u.origin !== "https://portal.test") throw new Error(`unexpected upstream ${u.origin}`);
    return fetch(`http://127.0.0.1:${port}${u.pathname}`, init);
  };
  return {
    seen,
    state,
    closedSessions,
    viaHttps,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
