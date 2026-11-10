// A fake MCP server whose tools/list comes in pages (nextCursor), as the protocol allows.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Every tool promises structured output with a number in it; the server below breaks that promise.
const tool = (name: string) => ({
  name,
  inputSchema: { type: "object" as const, properties: {} },
  outputSchema: {
    type: "object" as const,
    properties: { n: { type: "number" } },
    required: ["n"],
  },
  annotations: { readOnlyHint: true },
});
const pages: Record<string, { tools: ReturnType<typeof tool>[]; next?: string }> = {
  "": { tools: [tool("first_page_tool")], next: "p2" },
  p2: { tools: [tool("second_page_tool")], next: "p3" },
  p3: { tools: [tool("third_page_tool")] },
};

const server = new Server({ name: "fake-paged", version: "0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async (req) => {
  const page = pages[req.params?.cursor ?? ""] ?? { tools: [] };
  return { tools: page.tools, ...(page.next ? { nextCursor: page.next } : {}) };
});
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: "text", text: "bad" }],
  structuredContent: { n: "not a number" },
}));
await server.connect(new StdioServerTransport());
