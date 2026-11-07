/**
 * A tool's inputSchema → a plain form (HTML string), and form entries → tool arguments.
 * Pure: the console's browser script wires it up; tests run in Node.
 * Widgets: labelled multi-choice → chips; single choice → select; number range → slider + box;
 * boolean → switch; object or long string → paste box; anything else → text box.
 */
import { esc } from "./render.js";

type Schema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  examples?: unknown[];
  format?: string;
};

export interface Choice {
  value: string;
  label: string;
}

export type Widget =
  | { kind: "chips"; choices: Choice[] }
  | { kind: "select"; choices: Choice[] }
  | { kind: "range"; min: number; max: number; integer: boolean }
  | { kind: "number"; integer: boolean }
  | { kind: "switch" }
  | { kind: "paste" }
  | { kind: "text" };

const choicesOf = (s?: Schema): Choice[] | null => {
  const alts = s?.anyOf ?? s?.oneOf;
  if (alts?.length && alts.every((a) => a.const !== undefined))
    return alts.map((a) => ({ value: String(a.const), label: a.title ?? String(a.const) }));
  if (s?.enum?.length) return s.enum.map((e) => ({ value: String(e), label: String(e) }));
  return null;
};
const typeOf = (s: Schema) => (Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type);

export function widgetFor(s: Schema): Widget {
  const t = typeOf(s);
  if (t === "array") {
    const c = choicesOf(s.items);
    return c ? { kind: "chips", choices: c } : { kind: "paste" };
  }
  const c = choicesOf(s);
  if (c) return { kind: "select", choices: c };
  if (t === "integer" || t === "number") {
    const integer = t === "integer";
    return s.minimum !== undefined && s.maximum !== undefined
      ? { kind: "range", min: s.minimum, max: s.maximum, integer }
      : { kind: "number", integer };
  }
  if (t === "boolean") return { kind: "switch" };
  if (t === "object" || s.format === "json") return { kind: "paste" };
  return { kind: "text" };
}

const id = (k: string) => `f-${k.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

function field(key: string, s: Schema, value: unknown, required: boolean): string {
  const w = widgetFor(s);
  const label = esc(s.title ?? key);
  const help = s.description
    ? `<p class="f-help" id="${id(key)}-help">${esc(s.description)}</p>`
    : "";
  const aria = s.description ? ` aria-describedby="${id(key)}-help"` : "";
  const req = required ? ' <span class="f-req">required</span>' : "";
  switch (w.kind) {
    case "chips": {
      const sel = new Set(Array.isArray(value) ? value.map(String) : []);
      return `<fieldset class="f-field f-chips" data-key="${esc(key)}" data-widget="chips"><legend>${label}${req}</legend>${help}<div class="f-chip-row">${w.choices.map((c, i) => `<label class="f-chip" for="${id(key)}-${i}"><input type="checkbox" id="${id(key)}-${i}" name="${esc(key)}" value="${esc(c.value)}"${sel.has(c.value) ? " checked" : ""}${aria}><span>${esc(c.label)}</span></label>`).join("")}</div></fieldset>`;
    }
    case "select":
      return `<div class="f-field" data-key="${esc(key)}" data-widget="select"><label for="${id(key)}">${label}${req}</label>${help}<select id="${id(key)}" name="${esc(key)}"${aria}>${required ? "" : `<option value="">Default</option>`}${w.choices.map((c) => `<option value="${esc(c.value)}"${String(value) === c.value ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>`;
    case "range": {
      const v = typeof value === "number" ? value : "";
      return `<div class="f-field" data-key="${esc(key)}" data-widget="range"><label for="${id(key)}">${label}${req}</label>${help}<div class="f-range"><input type="range" id="${id(key)}-slider" min="${w.min}" max="${w.max}" step="${w.integer ? 1 : "any"}" value="${v === "" ? w.min : v}" aria-label="${label} slider" data-sync="${id(key)}"><input type="number" id="${id(key)}" name="${esc(key)}" min="${w.min}" max="${w.max}" step="${w.integer ? 1 : "any"}" value="${v}" placeholder="Default"${aria}></div></div>`;
    }
    case "number":
      return `<div class="f-field" data-key="${esc(key)}" data-widget="number"><label for="${id(key)}">${label}${req}</label>${help}<input type="number" id="${id(key)}" name="${esc(key)}" step="${w.integer ? 1 : "any"}" value="${typeof value === "number" ? value : ""}" placeholder="Default"${aria}></div>`;
    case "switch":
      return `<div class="f-field f-switch" data-key="${esc(key)}" data-widget="switch"><label for="${id(key)}"><input type="checkbox" id="${id(key)}" name="${esc(key)}" value="true"${value === true ? " checked" : ""}${aria}> ${label}</label>${help}</div>`;
    case "paste":
      return `<div class="f-field" data-key="${esc(key)}" data-widget="paste"><label for="${id(key)}">${label}${req}</label>${help}<textarea id="${id(key)}" name="${esc(key)}" rows="8" spellcheck="false" placeholder="Paste JSON here"${aria}>${value === undefined ? "" : esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</textarea><div class="f-paste-tools"><button type="button" data-action="load-file" data-target="${id(key)}">Load file</button><button type="button" data-action="format" data-target="${id(key)}">Format</button></div></div>`;
    case "text":
      return `<div class="f-field" data-key="${esc(key)}" data-widget="text"><label for="${id(key)}">${label}${req}</label>${help}<input type="text" id="${id(key)}" name="${esc(key)}" value="${esc(value ?? "")}"${aria}></div>`;
  }
}

/** The form fields. Fields listed in `advanced` go under "More settings". */
export function renderForm(
  schema: Schema & { required?: string[] },
  values: Record<string, unknown> = {},
  advanced: string[] = [],
): string {
  const props = Object.entries(schema.properties ?? {});
  const req = new Set(schema.required ?? []);
  const html = (keys: [string, Schema][]) =>
    keys.map(([k, s]) => field(k, s, values[k], req.has(k))).join("");
  const simple = props.filter(([k]) => !advanced.includes(k));
  const adv = props.filter(([k]) => advanced.includes(k));
  return (
    html(simple) +
    (adv.length
      ? `<details class="f-advanced"><summary>More settings</summary>${html(adv)}</details>`
      : "")
  );
}

/** Form entries (name, value) → tool arguments. Empty fields are left out so tool defaults apply. */
export function formToArgs(
  schema: Schema,
  entries: [string, string][],
): { args: Record<string, unknown>; problems: string[] } {
  const args: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [key, s] of Object.entries(schema.properties ?? {})) {
    const vals = entries.filter(([k]) => k === key).map(([, v]) => v);
    const w = widgetFor(s);
    const label = s.title ?? key;
    if (w.kind === "chips") {
      if (vals.length) args[key] = vals;
      continue;
    }
    const v = vals[0];
    if (w.kind === "switch") {
      if (v === "true") args[key] = true;
      continue;
    }
    if (v === undefined || v.trim() === "") continue;
    if (w.kind === "range" || w.kind === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) problems.push(`${label}: enter a number`);
      else if (w.kind === "range" && (n < w.min || n > w.max))
        problems.push(`${label}: choose from ${w.min} to ${w.max}`);
      else if (w.integer && !Number.isInteger(n)) problems.push(`${label}: enter a whole number`);
      else args[key] = n;
    } else if (w.kind === "paste") {
      try {
        args[key] = typeOf(s) === "string" ? v : JSON.parse(v);
      } catch {
        problems.push(`${label}: this isn't valid JSON`);
      }
    } else args[key] = v;
  }
  return { args, problems };
}

/** A one-line summary of the settings used, shown after Run ("Settings: … · Change"). */
export function argsSummary(schema: Schema, args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, s] of Object.entries(schema.properties ?? {})) {
    const label = s.title ?? key;
    const v = args[key];
    if (v === undefined) continue;
    const w = widgetFor(s);
    const name = (x: unknown) =>
      ("choices" in w ? w.choices.find((c) => c.value === String(x))?.label : undefined) ??
      String(x);
    parts.push(
      `${label}: ${Array.isArray(v) ? v.map(name).join(", ") : typeof v === "object" ? "pasted" : name(v)}`,
    );
  }
  return parts.length ? parts.join(" · ") : "Default settings";
}
