/**
 * ToolView → HTML string. Shared by the dev console and the in-Claude view.
 * Every string from a tool passes through esc(); nothing from a result is ever inserted raw.
 * Pure: no DOM, testable in Node.
 */
import type { Block, Bullet, Cell, Status, ToolView } from "./view.js";

export const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Status in words as well as colour, so it never depends on colour alone. */
export const STATUS_WORD: Record<Status, string> = {
  good: "All right",
  bad: "Problem",
  warn: "Check",
  info: "Note",
  error: "Error",
};
const MARK: Record<Status, string> = { good: "✓", bad: "✗", warn: "!", info: "i", error: "✗" };

const pill = (s?: Status) =>
  s
    ? `<span class="tv-pill tv-${s}"><span aria-hidden="true">${MARK[s]}</span> ${STATUS_WORD[s]}</span>`
    : "";

function bullets(items: Bullet[]): string {
  return `<ul class="tv-bullets">${items
    .map((b) => {
      const mark = b.status
        ? `<span class="tv-mark tv-${b.status}" aria-label="${esc(STATUS_WORD[b.status])}">${MARK[b.status]}</span>`
        : `<span class="tv-mark" aria-hidden="true">•</span>`;
      return b.detail
        ? `<li>${mark}<details class="tv-more"><summary>${esc(b.text)}</summary><p class="tv-detail">${esc(b.detail).replace(/\n/g, "<br>")}</p></details></li>`
        : `<li>${mark}<span>${esc(b.text)}</span></li>`;
    })
    .join("")}</ul>`;
}

const cellText = (c: Cell) => (typeof c === "string" ? c : c.text);
const cellHtml = (c: Cell) => {
  if (typeof c === "string") return esc(c);
  const cls = [c.status ? `tv-${c.status}` : "", c.mono ? "tv-mono" : ""].filter(Boolean).join(" ");
  return cls ? `<span class="${cls}">${esc(c.text)}</span>` : esc(c.text);
};

function block(b: Block): string {
  switch (b.kind) {
    case "bullets":
      return bullets(b.items);
    case "text":
      return `<p class="tv-text">${esc(b.text)}</p>`;
    case "code":
      return `<pre class="tv-code"><code>${esc(b.text)}</code></pre>`;
    case "kv":
      return `<dl class="tv-kv">${b.items.map((i) => `<dt>${esc(i.label)}</dt><dd${i.mono ? ' class="tv-mono"' : ""}>${esc(i.value)}</dd>`).join("")}</dl>`;
    case "table": {
      // Wide screens get a real table; phones get one card per row (label: value), via CSS.
      const head = b.columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join("");
      const rows = b.rows
        .map(
          (r) =>
            `<tr>${b.columns.map((c) => `<td data-label="${esc(c.label)}">${cellHtml(r[c.key] ?? "")}</td>`).join("")}</tr>`,
        )
        .join("");
      return `<div class="tv-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${b.note ? `<p class="tv-note">${esc(b.note)}</p>` : ""}`;
    }
    default: {
      // Unknown kinds (from a newer tool) are shown as data, never dropped.
      return `<pre class="tv-code"><code>${esc(JSON.stringify(b, null, 2))}</code></pre>`;
    }
  }
}

export interface RenderOptions {
  /** Show the follow-up buttons (data-patch holds the argument change). */
  withNext?: boolean;
}

export function renderView(v: ToolView, o: RenderOptions = {}): string {
  const parts: string[] = [];
  parts.push(`<div class="tv" data-status="${esc(v.status)}">`);
  parts.push(
    `<p class="tv-headline tv-${esc(v.status)}" role="status">${pill(v.status)} <span>${esc(v.headline)}</span></p>`,
  );
  if (v.banner) parts.push(`<p class="tv-banner">${esc(v.banner)}</p>`);
  if (v.stats?.length)
    parts.push(
      `<ul class="tv-stats">${v.stats.map((s) => `<li class="tv-stat${s.status ? ` tv-${s.status}` : ""}"><span class="tv-stat-label">${esc(s.label)}</span><span class="tv-stat-value">${esc(s.value)}</span>${s.status && s.status !== "good" ? `<span class="tv-stat-word">${esc(STATUS_WORD[s.status])}</span>` : ""}</li>`).join("")}</ul>`,
    );
  if (v.bullets?.length) parts.push(bullets(v.bullets));
  for (const s of v.sections ?? []) {
    parts.push(
      `<details class="tv-section" id="tv-${esc(s.id)}"${s.open ? " open" : ""}><summary><span>${esc(s.title)}</span>${s.hint ? `<span class="tv-hint">${esc(s.hint)}</span>` : ""}</summary><div class="tv-section-body">${s.blocks.map(block).join("")}</div></details>`,
    );
  }
  if (o.withNext && v.next?.length)
    parts.push(
      `<div class="tv-next">${v.next.map((n) => `<button type="button" class="tv-next-btn" data-patch="${esc(JSON.stringify(n.patch))}">${esc(n.label)}</button>`).join("")}</div>`,
    );
  if (v.footnote) parts.push(`<p class="tv-footnote">${esc(v.footnote)}</p>`);
  parts.push(`</div>`);
  return parts.join("\n");
}

/** Every visible string a renderer must show for this view (used by conformance tests in every repo). */
export function requiredText(v: ToolView): string[] {
  const out = [
    v.headline,
    ...(v.stats ?? []).flatMap((s) => [s.label, s.value]),
    ...(v.bullets ?? []).map((b) => b.text),
    ...(v.sections ?? []).map((s) => s.title),
  ];
  if (v.banner) out.push(v.banner);
  for (const s of v.sections ?? [])
    for (const b of s.blocks)
      if (b.kind === "table")
        for (const r of b.rows) for (const c of Object.values(r)) out.push(cellText(c));
  return out.filter(Boolean);
}
