/**
 * ToolView v1: one result shape any tool can return (in result `_meta["com.imonfhir/view"]`) so a
 * single renderer can show it well: the workbench, the dev console and the in-Claude view.
 * Machine-readable copy: docs/tool-view.schema.json. Pure types + a hand-written checker (no ajv).
 */
export type Status = "good" | "bad" | "warn" | "info" | "error";
export const STATUSES: readonly Status[] = ["good", "bad", "warn", "info", "error"];

export interface Bullet {
  text: string;
  status?: Status;
  detail?: string;
}
export type Cell = string | { text: string; status?: Status; mono?: boolean };
export type Block =
  | { kind: "bullets"; items: Bullet[] }
  | {
      kind: "table";
      columns: { key: string; label: string }[];
      rows: Record<string, Cell>[];
      note?: string;
    }
  | { kind: "kv"; items: { label: string; value: string; mono?: boolean }[] }
  | { kind: "text"; text: string }
  | { kind: "code"; lang: "json" | "text"; text: string };

export interface Section {
  id: string;
  title: string;
  hint?: string;
  open?: boolean;
  blocks: Block[];
}

export interface ToolView {
  v: 1;
  status: Status;
  /** One sentence. */
  headline: string;
  banner?: string;
  stats?: { label: string; value: string; status?: Status }[];
  /** ≤ 110 characters each; the detail opens on click. */
  bullets?: Bullet[];
  /** Collapsed unless open: true. */
  sections?: Section[];
  /** Follow-up runs: the same tool with these arguments changed. */
  next?: { label: string; patch: Record<string, unknown> }[];
  footnote?: string;
}

export const LIMITS = { bulletChars: 110, tableRows: 200, viewBytes: 50_000 } as const;

/** Problems with a view, as plain sentences. Empty means valid. */
export function checkView(v: unknown): string[] {
  const p: string[] = [];
  const isObj = (x: unknown): x is Record<string, any> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  const str = (x: unknown) => typeof x === "string" && x.trim().length > 0;
  const status = (x: unknown, where: string) => {
    if (x !== undefined && !STATUSES.includes(x as Status))
      p.push(`${where}: status must be one of ${STATUSES.join(", ")}`);
  };
  if (!isObj(v)) return ["the view is not an object"];
  if (v.v !== 1) p.push("v must be 1");
  if (!STATUSES.includes(v.status)) p.push(`status must be one of ${STATUSES.join(", ")}`);
  if (!str(v.headline)) p.push("headline is required");
  else if (/\n/.test(v.headline)) p.push("headline must be one line");
  for (const [i, s] of (v.stats ?? []).entries()) {
    if (!str(s?.label) || typeof s?.value !== "string") p.push(`stats[${i}] needs label and value`);
    status(s?.status, `stats[${i}]`);
  }
  const bullets = (items: unknown, where: string) => {
    if (!Array.isArray(items)) {
      p.push(`${where} must be a list`);
      return;
    }
    for (const [i, b] of items.entries()) {
      if (!str(b?.text)) p.push(`${where}[${i}] needs text`);
      else if (b.text.length > LIMITS.bulletChars)
        p.push(
          `${where}[${i}] is ${b.text.length} characters; keep bullets to ${LIMITS.bulletChars}`,
        );
      status(b?.status, `${where}[${i}]`);
    }
  };
  if (v.bullets !== undefined) bullets(v.bullets, "bullets");
  const ids = new Set<string>();
  for (const [i, s] of (v.sections ?? []).entries()) {
    const w = `sections[${i}]`;
    if (!str(s?.id) || !str(s?.title)) p.push(`${w} needs id and title`);
    if (ids.has(s?.id)) p.push(`${w}: duplicate id ${s.id}`);
    ids.add(s?.id);
    if (!Array.isArray(s?.blocks)) {
      p.push(`${w} needs blocks`);
      continue;
    }
    for (const [j, b] of s.blocks.entries()) {
      const bw = `${w}.blocks[${j}]`;
      if (b?.kind === "bullets") bullets(b.items, `${bw}.items`);
      else if (b?.kind === "table") {
        if (!Array.isArray(b.columns) || !b.columns.length) p.push(`${bw} needs columns`);
        if (!Array.isArray(b.rows)) p.push(`${bw} needs rows`);
        else if (b.rows.length > LIMITS.tableRows)
          p.push(`${bw} has ${b.rows.length} rows; cut to ${LIMITS.tableRows} and add a note`);
      } else if (b?.kind === "kv") {
        if (!Array.isArray(b.items)) p.push(`${bw} needs items`);
      } else if (b?.kind === "text" || b?.kind === "code") {
        if (typeof b.text !== "string") p.push(`${bw} needs text`);
      }
      // Unknown kinds are allowed (forward compatible): renderers show them as code.
    }
  }
  for (const [i, n] of (v.next ?? []).entries())
    if (!str(n?.label) || !isObj(n?.patch)) p.push(`next[${i}] needs label and patch`);
  const size = new TextEncoder().encode(JSON.stringify(v)).length; // works in Node and the browser
  if (size > LIMITS.viewBytes)
    p.push(`the view is ${size} bytes; keep it under ${LIMITS.viewBytes}`);
  return p;
}
