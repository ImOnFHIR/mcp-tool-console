// A fake MCP server for the console's tests: one tool per rule the console must enforce.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake", version: "0" });
const ro = { readOnlyHint: true };
const free = { "com.imonfhir/cost": { free: true } };
const preset = (id: string, args: Record<string, unknown>) => ({
  "com.imonfhir/presets": [{ id, label: `Try ${id}`, args }],
});

server.registerTool(
  "echo",
  {
    title: "Echo",
    inputSchema: { text: z.string().optional() },
    annotations: ro,
    _meta: { ...free, ...preset("hello", { text: "hello" }) },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text ?? ""}` }],
    _meta: {
      "com.imonfhir/view": { v: 1, status: "good", headline: `You said ${text ?? "nothing"}.` },
    },
  }),
);

server.registerTool(
  "write_thing",
  {
    title: "Write a thing",
    inputSchema: {},
    annotations: { readOnlyHint: false },
    _meta: { ...free, ...preset("write", {}) },
  },
  async () => ({ content: [{ type: "text", text: "wrote" }] }),
);

server.registerTool(
  "paid",
  {
    title: "Paid",
    inputSchema: {},
    annotations: ro,
    _meta: { "com.imonfhir/cost": { free: false, note: "about $0.01" }, ...preset("spend", {}) },
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

server.registerTool(
  "die",
  { title: "Die", inputSchema: {}, annotations: ro, _meta: free },
  async () => {
    // The server process ends while this call is still unanswered.
    setTimeout(() => process.exit(1), 50);
    await new Promise(() => {});
    return { content: [] };
  },
);

console.error("fake server started"); // goes to the console's server log
await server.connect(new StdioServerTransport());
