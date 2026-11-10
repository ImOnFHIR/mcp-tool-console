// Runs the built console page (dist/ui/console.html) inside happy-dom, with a fake /api behind it,
// so the page's own browser code is what the tests drive.
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

export interface FakeTool {
  name: string;
  title?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  _meta?: unknown;
}
export interface FakeServer {
  id: string;
  label: string;
  status: "starting" | "ready" | "stopped";
  error: string | null;
  tools: FakeTool[];
  command?: string;
  args?: string[];
  cwd?: string;
}
export interface ApiCall {
  path: string;
  body: any;
}
export type CallHandler = (body: any) => Promise<any> | any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function openConsole(o: { servers: FakeServer[]; onCall?: CallHandler }) {
  const html = readFileSync("dist/ui/console.html", "utf8");
  const js = html.match(/<script>([\s\S]*)<\/script>/)![1];
  const w: any = new Window({ url: `http://127.0.0.1:4317/#token=test` });
  const doc = w.document;
  doc.write(html.replace(/<script>[\s\S]*<\/script>/, ""));

  // Count the listeners the page adds to each element, by event type. happy-dom hands out a proxy
  // for a <form>, so an element with an id is also tracked by that id (reset when a new element
  // takes the id), which is how the form is found again.
  const counts = new WeakMap<object, Map<string, number>>();
  const byId = new Map<string, { owner: object; counts: Map<string, number> }>();
  const bump = (m: Map<string, number>, type: string) => m.set(type, (m.get(type) ?? 0) + 1);
  let proto = Object.getPrototypeOf(doc.body);
  while (proto && !Object.hasOwn(proto, "addEventListener")) proto = Object.getPrototypeOf(proto);
  const add = proto.addEventListener;
  proto.addEventListener = function (this: any, type: string, ...rest: unknown[]) {
    const m = counts.get(this) ?? new Map<string, number>();
    counts.set(this, m);
    bump(m, type);
    if (typeof this.id === "string" && this.id) {
      let e = byId.get(this.id);
      if (!e || e.owner !== this) byId.set(this.id, (e = { owner: this, counts: new Map() }));
      bump(e.counts, type);
    }
    return add.call(this, type, ...rest);
  };

  const state = { servers: o.servers, calls: [] as ApiCall[], inflight: 0 };
  w.fetch = async (path: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ path, body });
    state.inflight++;
    try {
      let json: any = {};
      if (path === "/api/tools") json = { servers: state.servers };
      else if (path === "/api/call") json = await (o.onCall?.(body) ?? { ms: 1, result: {} });
      else if (path === "/api/restart") json = { servers: state.servers };
      else if (path.startsWith("/api/log")) json = { lines: ["a log line"] };
      return { ok: true, status: 200, json: async () => json };
    } finally {
      state.inflight--;
    }
  };
  w.eval(js);

  const page = {
    window: w,
    document: doc,
    state,
    q: <T = any>(sel: string): T => doc.querySelector(sel),
    all: <T = any>(sel: string): T[] => [...doc.querySelectorAll(sel)],
    display: (sel: string) => w.getComputedStyle(doc.querySelector(sel)).display as string,
    listeners: (el: any, type: string) =>
      counts.get(el)?.get(type) ?? byId.get(el.id)?.counts.get(type) ?? 0,
    callsTo: (path: string) => state.calls.filter((c) => c.path === path),
    /** Navigate the way a browser does: the hashchange arrives a moment after the hash is set. */
    async go(hash: string) {
      const changed = new Promise((r) => w.addEventListener("hashchange", r, { once: true }));
      w.location.hash = hash;
      await changed;
    },
    submit() {
      page.q("#run-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    },
    click: (sel: string) => page.q(sel).dispatchEvent(new w.Event("click", { bubbles: true })),
    /** Wait until `cond` holds (the page's async work is real promises, so poll). */
    async until(cond: () => boolean, what: string, ms = 3000) {
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`);
        await sleep(5);
      }
    },
    /** Wait until no request is in flight and the page has had time to react. */
    async idle() {
      do await sleep(15);
      while (state.inflight > 0);
      await sleep(15);
    },
    close: () => w.happyDOM.abort(),
  };
  return page;
}
