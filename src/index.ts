/**
 * mcp-tool-console: the tool contract and the ToolView result shape.
 * Safe to import anywhere (Node, the browser, an MCP App): no Node APIs, no network, no dependencies.
 *   import { toolMeta, resultMeta, describe, checkView, type ToolView } from "mcp-tool-console";
 * Renderer: "mcp-tool-console/render". Form: "mcp-tool-console/form". Styles: "mcp-tool-console/styles".
 * Dev console (Node only): "mcp-tool-console/console", or run the `mcp-tool-console` command.
 */
export * from "./tool-meta.js";
export * from "./ui/view.js";
