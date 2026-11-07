// A fake MCP server for the console's tests: one tool per rule the console must enforce.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake", version: "0" });
const ro = { readOnlyHint: true };
const free = { "com.imonfhir/cost": { free: true } };

server.registerTool(
  "echo",
  { title: "Echo", inputSchema: { text: z.string().optional() }, annotations: ro, _meta: free },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text ?? ""}` }],
    _meta: {
      "com.imonfhir/view": { v: 1, status: "good", headline: `You said ${text ?? "nothing"}.` },
    },
  }),
);

server.registerTool(
  "write_thing",
  { title: "Write a thing", inputSchema: {}, annotations: { readOnlyHint: false }, _meta: free },
  async () => ({ content: [{ type: "text", text: "wrote" }] }),
);

server.registerTool(
  "paid",
  {
    title: "Paid",
    inputSchema: {},
    annotations: ro,
    _meta: { "com.imonfhir/cost": { free: false, note: "about $0.01" } },
  },
  async () => ({ content: [{ type: "text", text: "spent" }] }),
);

server.registerTool(
  "hang",
  { title: "Hang", inputSchema: {}, annotations: ro, _meta: free },
  async () => {
    await new Promise((r) => setTimeout(r, 30_000));
    return { content: [{ type: "text", text: "late" }] };
  },
);

server.registerTool(
  "env_probe",
  { title: "Env probe", inputSchema: {}, annotations: ro, _meta: free },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          anthropic: process.env.ANTHROPIC_API_KEY !== undefined,
          allowed: process.env.CONSOLE_TEST_ALLOWED ?? null,
        }),
      },
    ],
  }),
);

console.error("fake server started"); // goes to the console's server log
await server.connect(new StdioServerTransport());
