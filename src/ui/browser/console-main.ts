/**
 * Dev console page. One full-width tool page; result first after Run; protocol detail only in the
 * technical drawer. All HTML comes from renderView/renderForm (escaped) or templates that use esc().
 */
import { renderView, esc } from "../render.js";
import { renderForm, formToArgs, argsSummary } from "../form.js";
import { checkView, type ToolView } from "../view.js";

const META = {
  about: "com.imonfhir/about",
  presets: "com.imonfhir/presets",
  cost: "com.imonfhir/cost",
  form: "com.imonfhir/form",
  view: "com.imonfhir/view",
};

interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: any;
  annotations?: any;
  _meta?: any;
}
interface ServerInfo {
  id: string;
  label: string;
  status: "starting" | "ready" | "stopped";
  error: string | null;
  tools: Tool[];
  /** How to start the server by hand, e.g. "node dist/mcp.js". */
  launch?: string;
}
interface Run {
  at: Date;
  args: Record<string, unknown>;
  summary: string;
  view: ToolView;
  request: unknown;
  response: unknown;
  ms: number;
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
let token = "";
let servers: ServerInfo[] = [];
const runs = new Map<string, Run[]>();
let shown: Run | null = null;
let busy: { callId: string; timer: number } | null = null;

// ── token and routing ────────────────────────────────────────────────────────
function readToken() {
  const m = location.hash.match(/^#token=([A-Za-z0-9_-]+)/);
  if (m) {
    token = m[1];
    try {
      sessionStorage.setItem("console-token", token);
    } catch {
      /* private window */
    }
    history.replaceState(null, "", "#/");
  } else {
    try {
      token = sessionStorage.getItem("console-token") ?? "";
    } catch {
      token = "";
    }
  }
}
const route = () => {
  const m = location.hash.match(/^#\/([a-z0-9-]+)\/([^/]+)$/);
  return m ? { server: m[1], tool: decodeURIComponent(m[2]) } : null;
};
const key = (s: string, t: string) => `${s}/${t}`;

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-console-token": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `The console answered ${res.status}.`);
  return json;
}

// ── navigation ───────────────────────────────────────────────────────────────
const dot = (s: ServerInfo) =>
  `<span class="c-dot c-${s.status}" aria-label="${s.status === "ready" ? "running" : s.status}"></span>`;
const toolTitle = (t: Tool) => t.title ?? t.name;
const toolLine = (t: Tool) =>
  t._meta?.[META.about]?.whatItIs?.[0] ??
  (t.description ?? "").split("\n").find((l) => l.trim()) ??
  "";

function renderNav(filter = "") {
  const f = filter.trim().toLowerCase();
  const r = route();
  $("#nav").innerHTML =
    servers
      .map((s) => {
        const tools = s.tools.filter(
          (t) => !f || `${toolTitle(t)} ${toolLine(t)} ${t.name}`.toLowerCase().includes(f),
        );
        if (f && !tools.length) return "";
        return `<section class="c-group"><h2 class="c-group-head">${dot(s)}<span>${esc(s.label)}</span>${s.status !== "ready" ? `<button type="button" class="c-link" data-restart="${esc(s.id)}">Restart</button>` : ""}</h2>
      ${s.error ? `<p class="c-error-line">${esc(s.error)}</p>` : ""}
      <ul>${tools.map((t) => `<li><a href="#/${esc(s.id)}/${encodeURIComponent(t.name)}"${r && r.server === s.id && r.tool === t.name ? ' aria-current="page"' : ""}><strong>${esc(toolTitle(t))}</strong><span>${esc(toolLine(t))}</span></a></li>`).join("")}</ul></section>`;
      })
      .join("") || `<p class="c-muted">No tools match “${esc(filter)}”.</p>`;
}

// ── pages ────────────────────────────────────────────────────────────────────
function renderHome() {
  $("#main").innerHTML =
    `<h1 class="c-title">Tools</h1><p class="c-muted">Pick a tool. Each one says what it is, what it does and how to use it.</p>
    <div class="c-cards">${servers.flatMap((s) => s.tools.map((t) => `<a class="c-card" href="#/${esc(s.id)}/${encodeURIComponent(t.name)}"><span class="c-card-server">${esc(s.label)}</span><strong>${esc(toolTitle(t))}</strong><span>${esc(toolLine(t))}</span></a>`)).join("") || `<p>No servers are running. Check the terminal.</p>`}</div>`;
}

function aboutBlock(t: Tool) {
  const a = t._meta?.[META.about];
  if (!a)
    return `<details class="c-about-raw"><summary>About this tool</summary><pre>${esc(t.description ?? "No description.")}</pre></details>`;
  const col = (title: string, items: string[] = []) =>
    items.length
      ? `<div><h3>${title}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`
      : "";
  return `<div class="c-about">${col("What it is", a.whatItIs)}${col("What it does", a.whatItDoes)}${col("How to use", a.howToUse)}</div>`;
}

function badges(t: Tool) {
  const b: string[] = [];
  b.push(
    t.annotations?.readOnlyHint === true
      ? `<span class="c-badge">Read-only</span>`
      : `<span class="c-badge c-badge-bad">Changes things: won't run here</span>`,
  );
  const cost = t._meta?.[META.cost];
  b.push(
    cost?.free === true
      ? `<span class="c-badge">Free</span>`
      : `<span class="c-badge c-badge-warn">May cost money${cost?.note ? `: ${esc(cost.note)}` : ""}</span>`,
  );
  for (const s of t._meta?.[META.about]?.safeToRun ?? [])
    b.push(`<span class="c-badge c-badge-quiet">${esc(s)}</span>`);
  return b.join("");
}

function renderTool(server: ServerInfo, t: Tool) {
  const presets: any[] = t._meta?.[META.presets] ?? [];
  const advanced: string[] = t._meta?.[META.form]?.advanced ?? [];
  const free = t._meta?.[META.cost]?.free === true;
  const k = key(server.id, t.name);
  $("#main").innerHTML = `
    <header class="c-tool-head"><span class="c-card-server">${esc(server.label)}</span><h1 class="c-title">${esc(toolTitle(t))}</h1><div class="c-badges">${badges(t)}</div></header>
    ${aboutBlock(t)}
    ${presets.length ? `<div class="c-presets" role="group" aria-label="Examples">${presets.map((p, i) => `<button type="button" class="c-chip" data-preset="${i}">${esc(p.label)}</button>`).join("")}</div>` : ""}
    <div id="result" class="c-result" aria-live="polite"></div>
    <div id="settings-line" class="c-settings-line" hidden></div>
    <form id="run-form" class="c-form" novalidate>
      ${renderForm(t.inputSchema ?? {}, {}, advanced)}
      ${free ? "" : `<label class="c-cost" for="confirm-cost"><input type="checkbox" id="confirm-cost"> I accept that this run may cost money</label>`}
      <div class="c-run-row"><button type="submit" class="c-run" id="run-btn">Run</button><button type="button" class="c-link" id="cancel-btn" hidden>Cancel</button><span id="run-status" class="c-muted"></span></div>
      <p id="form-problems" class="c-error-line" hidden></p>
    </form>
    <section class="c-history" aria-label="Recent runs"><h2>Recent runs</h2><ol id="history"></ol></section>`;
  wireForm(server, t, presets);
  renderHistory(k);
  const last = runs.get(k)?.[0];
  if (last) showRun(last, t);
}

// ── form and running ─────────────────────────────────────────────────────────
function wireForm(server: ServerInfo, t: Tool, presets: any[]) {
  const form = $<HTMLFormElement>("#run-form");
  form.querySelectorAll<HTMLInputElement>("input[type=range][data-sync]").forEach((sl) => {
    const box = document.getElementById(sl.dataset.sync!) as HTMLInputElement;
    sl.addEventListener("input", () => {
      box.value = sl.value;
    });
    box.addEventListener("input", () => {
      if (box.value) sl.value = box.value;
    });
  });
  form.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((b) =>
    b.addEventListener("click", () => {
      const ta = document.getElementById(b.dataset.target!) as HTMLTextAreaElement;
      if (b.dataset.action === "format") {
        try {
          ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
        } catch {
          problems(["That isn't valid JSON yet."]);
        }
      }
      if (b.dataset.action === "load-file") {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".json,application/json,application/fhir+json";
        inp.onchange = async () => {
          const f = inp.files?.[0];
          if (f) ta.value = await f.text();
        };
        inp.click();
      }
    }),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const entries = [...new FormData(form).entries()].map(
      ([k, v]) => [k, String(v)] as [string, string],
    );
    const { args, problems: p } = formToArgs(t.inputSchema ?? {}, entries);
    if (p.length) return problems(p);
    run(server, t, args);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = presets[Number(b.dataset.preset)];
      fillForm(t, p.args ?? {});
      run(server, t, p.args ?? {});
    }),
  );
  $("#cancel-btn").addEventListener("click", async () => {
    if (busy) await api("/api/cancel", { callId: busy.callId }).catch(() => {});
  });
}

function fillForm(t: Tool, args: Record<string, unknown>) {
  const form = $<HTMLFormElement>("#run-form");
  const advanced: string[] = t._meta?.[META.form]?.advanced ?? [];
  const keep = form.querySelector(".c-cost")?.outerHTML ?? "";
  const tail =
    form.querySelector(".c-run-row")!.outerHTML + form.querySelector("#form-problems")!.outerHTML;
  form.innerHTML = renderForm(t.inputSchema ?? {}, args, advanced) + keep + tail;
  const s = servers.find((x) => x.tools.includes(t))!;
  wireForm(s, t, t._meta?.[META.presets] ?? []);
}

function problems(p: string[]) {
  const el = $("#form-problems");
  el.hidden = !p.length;
  el.textContent = p.join(" ");
}

async function run(server: ServerInfo, t: Tool, args: Record<string, unknown>) {
  if (busy) return;
  problems([]);
  const confirmCost =
    (document.getElementById("confirm-cost") as HTMLInputElement | null)?.checked === true;
  const callId = crypto.randomUUID();
  const started = Date.now();
  const status = $("#run-status");
  busy = {
    callId,
    timer: window.setInterval(() => {
      status.textContent = `Running… ${Math.round((Date.now() - started) / 1000)} s`;
    }, 500),
  };
  status.textContent = "Running…";
  $<HTMLButtonElement>("#run-btn").disabled = true;
  $("#cancel-btn").hidden = false;
  try {
    const r = await api("/api/call", {
      server: server.id,
      tool: t.name,
      args,
      callId,
      confirmCost,
    });
    const view = toViewOrFallback(r);
    const entry: Run = {
      at: new Date(),
      args,
      summary: argsSummary(t.inputSchema ?? {}, args),
      view,
      request: r.request,
      response: r.result ?? { failure: r.failure },
      ms: r.ms,
    };
    const k = key(server.id, t.name);
    runs.set(k, [entry, ...(runs.get(k) ?? [])].slice(0, 8));
    showRun(entry, t);
    renderHistory(k);
  } catch (e) {
    problems([(e as Error).message]);
  } finally {
    window.clearInterval(busy!.timer);
    busy = null;
    status.textContent = "";
    $<HTMLButtonElement>("#run-btn").disabled = false;
    $("#cancel-btn").hidden = true;
  }
}

/** Use the tool's own view; otherwise build a plain one from what came back. */
function toViewOrFallback(r: any): ToolView {
  if (r.failure)
    return {
      v: 1,
      status: "error",
      headline: r.failure,
      bullets: [{ text: "Open Technical details for the server log." }],
    };
  const res = r.result ?? {};
  const v = res._meta?.[META.view];
  if (v && checkView(v).length === 0) return v;
  const text: string = (res.content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    v: 1,
    status: res.isError ? "error" : "info",
    headline: lines[0]?.slice(0, 200) ?? (res.isError ? "The tool reported an error." : "Done."),
    bullets: lines.slice(1, 9).map((l) => ({
      text: l.length > 110 ? l.slice(0, 109) + "…" : l,
      ...(l.length > 110 ? { detail: l } : {}),
    })),
    sections: res.structuredContent
      ? [
          {
            id: "data",
            title: "Data",
            blocks: [
              { kind: "code", lang: "json", text: JSON.stringify(res.structuredContent, null, 2) },
            ],
          },
        ]
      : [],
  };
}

function showRun(entry: Run, t: Tool) {
  shown = entry;
  $("#result").innerHTML = renderView(entry.view, { withNext: true });
  $("#result")
    .querySelectorAll<HTMLButtonElement>("[data-patch]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        const s = servers.find((x) => x.tools.includes(t))!;
        const args = { ...entry.args, ...JSON.parse(b.dataset.patch!) };
        fillForm(t, args);
        run(s, t, args);
      }),
    );
  // Result first: fold the form into one line.
  const line = $("#settings-line");
  line.hidden = false;
  line.innerHTML = `<span>Settings: ${esc(entry.summary)} · ${(entry.ms / 1000).toFixed(1)} s</span><button type="button" class="c-link" id="change-btn">Change</button>`;
  $("#run-form").hidden = true;
  $("#change-btn").addEventListener("click", () => {
    $("#run-form").hidden = false;
    line.hidden = true;
    ($("#run-form").querySelector("input,select,textarea") as HTMLElement | null)?.focus();
  });
  $("#tech-btn").hidden = false;
}

function renderHistory(k: string) {
  const list = runs.get(k) ?? [];
  const ol = $("#history");
  ol.innerHTML = list.length
    ? list
        .map(
          (r, i) =>
            `<li><button type="button" class="c-history-item" data-run="${i}"><span class="c-pill-${esc(r.view.status)}">${esc(r.view.status === "good" ? "✓" : r.view.status === "bad" || r.view.status === "error" ? "✗" : "!")}</span> ${esc(r.at.toLocaleTimeString())} · ${esc(r.summary)}<span class="c-muted"> · ${esc(r.view.headline)}</span></button></li>`,
        )
        .join("")
    : `<li class="c-muted">No runs yet. Try an example above.</li>`;
  ol.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = route();
      const s = servers.find((x) => x.id === r?.server);
      const t = s?.tools.find((x) => x.name === r?.tool);
      if (t) showRun(list[Number(b.dataset.run)], t);
    }),
  );
}

// ── technical drawer ─────────────────────────────────────────────────────────
async function openDrawer() {
  const r = route();
  const s = servers.find((x) => x.id === r?.server);
  const t = s?.tools.find((x) => x.name === r?.tool);
  if (!s || !t) return;
  const log = await api(`/api/log?server=${encodeURIComponent(s.id)}`)
    .then((x) => x.lines as string[])
    .catch(() => []);
  const cli = `npx @modelcontextprotocol/inspector --cli ${s.launch || "<server command>"} --method tools/call --tool-name ${t.name}${Object.entries(
    shown?.args ?? {},
  )
    .map(([k, v]) => ` --tool-arg '${k}=${JSON.stringify(v)}'`)
    .join("")}`;
  const tabs: [string, string][] = [
    ["Request", JSON.stringify(shown?.request ?? null, null, 2)],
    ["Response", JSON.stringify(shown?.response ?? null, null, 2)],
    ["Tool definition", JSON.stringify(t, null, 2)],
    ["Server log", log.join("\n") || "(empty)"],
    ["Inspector command", cli],
  ];
  const d = $("#drawer");
  d.innerHTML = `<div class="c-drawer-head"><h2>Technical details</h2><button type="button" class="c-link" id="drawer-close">Close</button></div>
    <div class="c-tabs" role="tablist">${tabs.map(([n], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${i}">${esc(n)}</button>`).join("")}</div>
    ${tabs.map(([, body], i) => `<pre class="c-tab-body" data-body="${i}"${i ? " hidden" : ""}>${esc(body)}</pre>`).join("")}
    <button type="button" class="c-link" id="copy-tab">Copy this tab</button>`;
  d.hidden = false;
  d.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      d.querySelectorAll("[data-tab]").forEach((x) =>
        x.setAttribute("aria-selected", String(x === b)),
      );
      d.querySelectorAll<HTMLElement>("[data-body]").forEach((x) => {
        x.hidden = x.dataset.body !== b.dataset.tab;
      });
    }),
  );
  $("#drawer-close").addEventListener("click", () => {
    d.hidden = true;
    $("#tech-btn").focus();
  });
  $("#copy-tab").addEventListener("click", () => {
    const body = d.querySelector<HTMLElement>("[data-body]:not([hidden])")!;
    navigator.clipboard?.writeText(body.textContent ?? "").catch(() => {
      const sel = getSelection();
      const rg = document.createRange();
      rg.selectNodeContents(body);
      sel?.removeAllRanges();
      sel?.addRange(rg);
    });
  });
  $("#drawer-close").focus();
}

// ── boot ─────────────────────────────────────────────────────────────────────
async function load() {
  try {
    servers = (await api("/api/tools")).servers;
  } catch (e) {
    $("#main").innerHTML =
      `<h1 class="c-title">Can't reach the console</h1><p>${esc((e as Error).message)}</p>`;
    return;
  }
  renderNav(($("#search") as HTMLInputElement).value);
  show();
}

function show() {
  const r = route();
  $("#drawer").hidden = true;
  $("#tech-btn").hidden = true;
  document.body.classList.remove("c-nav-open");
  if (!r) return renderHome();
  const s = servers.find((x) => x.id === r.server);
  const t = s?.tools.find((x) => x.name === r.tool);
  if (!s || !t) {
    $("#main").innerHTML =
      `<h1 class="c-title">Tool not found</h1><p><a href="#/">Back to all tools</a></p>`;
    return;
  }
  renderTool(s, t);
  renderNav(($("#search") as HTMLInputElement).value);
  $("#main").focus();
}

readToken();
window.addEventListener("hashchange", show);
$("#search").addEventListener("input", (e) => renderNav((e.target as HTMLInputElement).value));
$("#nav").addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-restart]");
  if (b) {
    b.textContent = "Starting…";
    servers = (await api("/api/restart", { server: b.dataset.restart }).catch(() => ({ servers })))
      .servers;
    renderNav();
    show();
  }
  if ((e.target as HTMLElement).closest("a")) document.body.classList.remove("c-nav-open");
});
$("#nav-toggle").addEventListener("click", () => document.body.classList.toggle("c-nav-open"));
$("#tech-btn").addEventListener("click", openDrawer);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !$("#run-form")?.hidden)
    ($("#run-form") as HTMLFormElement | null)?.requestSubmit();
  if (e.key === "Escape" && !$("#drawer").hidden) {
    $("#drawer").hidden = true;
  }
});
load();
