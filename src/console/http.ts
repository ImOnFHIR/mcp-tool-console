/**
 * The dev console's local web server. Loopback only.
 * Guards (each tested in test/console.test.ts):
 *   - binds 127.0.0.1; the Host header must be 127.0.0.1:<port> or localhost:<port> (blocks DNS rebinding)
 *   - a cross-site Origin is refused (blocks other pages calling it)
 *   - every /api call needs the per-launch token (x-console-token header)
 *   - commands come only from config files; the API can't add or change servers
 *   - only tools marked readOnlyHint: true can run
 *   - a tool that isn't declared free needs confirmCost: true on that call (a visible per-run tick)
 *   - request bodies are capped; the page is served with a strict CSP
 * Hosted mode (`hosted` option) swaps the first three guards for these (tested in test/hosted.test.ts):
 *   - the Host header must be the public origin's host
 *   - every request carries an Access JWT that names the owner; anything else is a 403
 *   - on /api: the Origin must be the public origin and x-console-request: 1 must be present
 *   - no write routes: PATCH, PUT and DELETE on /api are a 405
 *   - GET /api/catalog lists the tool packages in a folder, read-only
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Hub } from "./hub.js";
import type { Verdict } from "./access-jwt.js";

export const MAX_BODY = 6 * 1024 * 1024;
export const COST_KEY = "com.imonfhir/cost";

export interface HostedOptions {
  /** The one https origin the page is served from, e.g. https://console.example */
  publicOrigin: string;
  /** Checks the Cf-Access-Jwt-Assertion header; see access-jwt.ts. */
  verifyOwner: (jwt: string | undefined) => Promise<Verdict>;
  /** The /api/catalog body. */
  catalog: () => Promise<unknown>;
  /** Where refusals are logged (a reason code, never a token). Default: stderr. */
  log?: (line: string) => void;
}

export interface ConsoleOptions {
  hub: Hub;
  /** Laptop mode: the per-launch link token. Not used in hosted mode. */
  token?: string;
  page: () => string;
  hosted?: HostedOptions;
}

export const REQUEST_HEADER = "x-console-request";

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
const refuse = (res: ServerResponse, status: number, message: string) =>
  send(res, status, { error: message });

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY)
      throw Object.assign(new Error("That input is too large (6 MB limit)."), { status: 413 });
    chunks.push(c as Buffer);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw Object.assign(new Error("The request wasn't valid JSON."), { status: 400 });
  }
}

const headerValue = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function isFree(tool: any): boolean {
  return tool?._meta?.[COST_KEY]?.free === true;
}

export function createConsoleServer(o: ConsoleOptions): Server {
  const hosted = o.hosted;
  if (!hosted && !o.token) throw new Error("Laptop mode needs a link token.");
  const publicHost = hosted ? new URL(hosted.publicOrigin).host : "";
  const server = createServer(async (req, res) => {
    const port = (server.address() as any)?.port;
    const host = req.headers.host ?? "";
    const origin = req.headers.origin;
    if (hosted) {
      if (host !== publicHost)
        return refuse(res, 403, "This console answers on its own address only.");
      const verdict = await hosted
        .verifyOwner(headerValue(req.headers["cf-access-jwt-assertion"]))
        .catch(() => ({ ok: false as const, reason: "malformed" as const }));
      if (!verdict.ok) {
        (hosted.log ?? ((l) => console.error(l)))(`access refused: ${verdict.reason}`);
        return refuse(res, 403, "This console is for its owner only.");
      }
    } else {
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        return refuse(res, 403, "This console only answers on 127.0.0.1.");
      if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`)
        return refuse(res, 403, "Requests from other sites are refused.");
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      return refuse(res, 400, "Bad request.");
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": CSP,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      return res.end(o.page());
    }
    if (!url.pathname.startsWith("/api/")) return refuse(res, 404, "Not found.");
    if (hosted) {
      // The Access cookie is SameSite=None, so another site's page could ride it: a browser's own
      // same-origin GET has no Origin header, anything that changes state must name ours.
      if (origin === undefined ? req.method !== "GET" : origin !== hosted.publicOrigin)
        return refuse(res, 403, "Requests from other sites are refused.");
      if (req.headers[REQUEST_HEADER] !== "1")
        return refuse(res, 403, "Open the console from its own page.");
      if (!["GET", "POST"].includes(req.method ?? ""))
        return refuse(res, 405, "Hosted mode has no write routes.");
    } else if (req.headers["x-console-token"] !== o.token)
      return refuse(res, 401, "Open the console from the link printed in the terminal.");

    try {
      if (req.method === "GET" && url.pathname === "/api/tools")
        return send(res, 200, { servers: o.hub.overview() });
      if (hosted && req.method === "GET" && url.pathname === "/api/catalog")
        return send(res, 200, await hosted.catalog());
      if (req.method === "GET" && url.pathname === "/api/log")
        return send(res, 200, { lines: o.hub.log(url.searchParams.get("server") ?? "") });
      if (req.method !== "POST") return refuse(res, 405, "Use POST.");
      const b = await body(req);

      if (url.pathname === "/api/restart") {
        if (!o.hub.config(b.server)) return refuse(res, 404, "Unknown server.");
        await o.hub.start(b.server);
        return send(res, 200, { servers: o.hub.overview() });
      }
      if (url.pathname === "/api/cancel")
        return send(res, 200, { cancelled: o.hub.cancel(String(b.callId ?? "")) });
      if (url.pathname === "/api/call") {
        const tool = o.hub.tool(b.server, b.tool);
        if (!tool)
          return refuse(
            res,
            404,
            "That tool isn't available. Restart its server or check the name.",
          );
        if (tool.annotations?.readOnlyHint !== true)
          return refuse(res, 403, "This console only runs read-only tools.");
        if (!isFree(tool) && b.confirmCost !== true)
          return refuse(
            res,
            402,
            "This tool may cost money. Tick “I accept the cost” for this run.",
          );
        const args = b.args && typeof b.args === "object" && !Array.isArray(b.args) ? b.args : {};
        const callId = typeof b.callId === "string" && b.callId ? b.callId : randomUUID();
        const request = {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: b.tool, arguments: args },
        };
        const started = Date.now();
        try {
          const result = await o.hub.call(b.server, b.tool, args, callId);
          return send(res, 200, { callId, ms: Date.now() - started, request, result });
        } catch (e) {
          return send(res, 200, {
            callId,
            ms: Date.now() - started,
            request,
            failure: (e as Error).message,
          });
        }
      }
      return refuse(res, 404, "Not found.");
    } catch (e: any) {
      return refuse(res, e.status ?? 500, e.message ?? "Something went wrong.");
    }
  });
  return server;
}
