/**
 * ToolView v1: one result shape any tool can return (in result `_meta["com.imonfhir/view"]`) so a
 * single renderer can show it well: the workbench, the dev console and the in-Claude view.
 * Machine-readable copy: docs/tool-view.schema.json. Pure types + a hand-written checker (no ajv).
 *
 * Contract 1.1 (still `v: 1`, optional fields only) lets a view say who wrote it and what it cites,
 * in a way a 1.0 renderer still shows: the machine-written label rides in `banner`, and the cited
 * passages are bullets in a section with id "sources". `provenance` and `refs` are extras for
 * newer renderers and machines; they are never the only place a reader can learn either fact.
 */
export type Status = "good" | "bad" | "warn" | "info" | "error";
export const STATUSES: readonly Status[] = ["good", "bad", "warn", "info", "error"];

/**
 * The fixed start of the banner on any view a model helped write. It follows the site's
 * existing label for model-written text ("machine summary · unreviewed · <model> · <date>").
 */
export const AI_LABEL = "Machine-written";
/** The section that lists every cited passage, so a 1.0 renderer shows them as ordinary bullets. */
export const SOURCES_SECTION_ID = "sources";
export const EGRESS = ["none", "model-provider"] as const;
export type Egress = (typeof EGRESS)[number];
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** An ISO date or date-time whose date is a real calendar day (Date.parse rolls 02-30 into March). */
function isIsoDate(s: unknown): boolean {
  const m = typeof s === "string" ? ISO_DATE.exec(s) : null;
  if (!m || Number.isNaN(Date.parse(s as string))) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
}

/** An object's keys, sorted, without those set to undefined: JSON drops them, so they aren't data. */
const definedKeys = (o: Record<string, any>) =>
  Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .toSorted();

/** The same data, whatever order object keys are in (arrays keep their order). */
function sameData(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameData(x, b[i]))
    );
  if (isObj(a) && isObj(b)) {
    const ka = definedKeys(a);
    const kb = definedKeys(b);
    return ka.join("\0") === kb.join("\0") && ka.every((k) => sameData(a[k], b[k]));
  }
  return a === b;
}

/** Who wrote a view's words, from what, and where its input went. Contract 1.1. */
export interface Provenance {
  /**
   * "deterministic": the tool computed every word. "model": a language model wrote some of them.
   * Any value other than "deterministic" is treated as "model", so a newer mode can't skip the label.
   */
  mode: "deterministic" | "model";
  /**
   * Who outside the tool received this run's input. It describes the run, not who wrote the words:
   * a deterministic result returned after a model was tried still says "model-provider".
   */
  egress: Egress;
  /** sha256 of the deterministic result this view reports or explains: "sha256:<64 hex>". */
  baseDigest: string;
  /** sha256 of the committed corpus or pack the cited passages come from, or "none". */
  corpusDigest: string;
  /** Every passage this view cites; each is a bullet in the "sources" section. */
  passageIds: string[];
  /** What backs the words, e.g. "validator-output", "spec-text", "recorded-run". */
  evidenceType: string;
  /** The model that wrote the words. Required when mode isn't "deterministic". */
  model?: string;
  promptVersion?: string;
  /** What writing the words cost, in US dollars. */
  costUsd?: number;
  /** When the words were written: an ISO date or date-time. Required when mode isn't "deterministic". */
  at?: string;
}

export interface Bullet {
  text: string;
  status?: Status;
  detail?: string;
  /** Contract 1.1: ids of the passages this line rests on; each must be in `provenance.passageIds`. */
  refs?: string[];
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
  /** Contract 1.1: who wrote the words and what they cite. A 1.0 renderer ignores it. */
  provenance?: Provenance;
}

export const LIMITS = { bulletChars: 110, tableRows: 200, viewBytes: 50_000 } as const;

const isObj = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** Problems with a view, as plain sentences. Empty means valid. */
export function checkView(v: unknown): string[] {
  const p: string[] = [];
  const status = (x: unknown, where: string) => {
    if (x !== undefined && !STATUSES.includes(x as Status))
      p.push(`${where}: status must be one of ${STATUSES.join(", ")}`);
  };
  if (!isObj(v)) return ["the view is not an object"];
  if (v.v !== 1) p.push("v must be 1");
  if (!STATUSES.includes(v.status)) p.push(`status must be one of ${STATUSES.join(", ")}`);
  if (!str(v.headline)) p.push("headline is required");
  else if (/\n/.test(v.headline)) p.push("headline must be one line");
  // An optional list that isn't a list is a problem to report, never a crash.
  const list = (x: unknown, where: string): any[] => {
    if (x === undefined || x === null) return [];
    if (Array.isArray(x)) return x;
    p.push(`${where} must be a list`);
    return [];
  };
  for (const [i, s] of list(v.stats, "stats").entries()) {
    if (!str(s?.label) || typeof s?.value !== "string") p.push(`stats[${i}] needs label and value`);
    status(s?.status, `stats[${i}]`);
  }
  // Every passage id a bullet cites, and whether that bullet is in the "sources" section.
  const cited: { ref: string; where: string; inSources: boolean }[] = [];
  const bullets = (items: unknown, where: string, inSources = false) => {
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
      if (b?.refs === undefined) continue;
      if (!Array.isArray(b.refs) || !b.refs.every(str))
        p.push(`${where}[${i}].refs must be a list of passage ids`);
      else for (const ref of b.refs) cited.push({ ref, where: `${where}[${i}]`, inSources });
    }
  };
  if (v.bullets !== undefined) bullets(v.bullets, "bullets");
  const ids = new Set<string>();
  for (const [i, s] of list(v.sections, "sections").entries()) {
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
      if (b?.kind === "bullets") bullets(b.items, `${bw}.items`, s?.id === SOURCES_SECTION_ID);
      else if (b?.kind === "table") {
        if (!Array.isArray(b.columns) || !b.columns.length) p.push(`${bw} needs columns`);
        if (!Array.isArray(b.rows)) p.push(`${bw} needs rows`);
        else if (b.rows.length > LIMITS.tableRows)
          p.push(`${bw} has ${b.rows.length} rows; cut to ${LIMITS.tableRows} and add a note`);
        if (Array.isArray(b.rows))
          for (const [r, row] of b.rows.entries())
            for (const [k, c] of Object.entries(isObj(row) ? row : {}))
              if (isObj(c)) status(c.status, `${bw}.rows[${r}].${k}`);
      } else if (b?.kind === "kv") {
        if (!Array.isArray(b.items)) p.push(`${bw} needs items`);
      } else if (b?.kind === "text" || b?.kind === "code") {
        if (typeof b.text !== "string") p.push(`${bw} needs text`);
      }
      // Unknown kinds are allowed (forward compatible): renderers show them as code.
    }
  }
  for (const [i, n] of list(v.next, "next").entries())
    if (!str(n?.label) || !isObj(n?.patch)) p.push(`next[${i}] needs label and patch`);
  checkProvenance(v, cited, p);
  const size = new TextEncoder().encode(JSON.stringify(v)).length; // works in Node and the browser
  if (size > LIMITS.viewBytes)
    p.push(`the view is ${size} bytes; keep it under ${LIMITS.viewBytes}`);
  return p;
}

/** Contract 1.1 rules: provenance's shape, the machine-written label, and citations that resolve. */
function checkProvenance(
  v: Record<string, any>,
  cited: { ref: string; where: string; inSources: boolean }[],
  p: string[],
): void {
  const pv = v.provenance;
  if (pv === undefined) {
    if (cited.length) p.push("refs need provenance.passageIds to resolve against");
    return;
  }
  if (!pv || typeof pv !== "object" || Array.isArray(pv)) {
    p.push("provenance must be an object");
    return;
  }
  if (!str(pv.mode)) p.push("provenance.mode is required");
  if (!EGRESS.includes(pv.egress)) p.push(`provenance.egress must be one of ${EGRESS.join(", ")}`);
  if (typeof pv.baseDigest !== "string" || !DIGEST.test(pv.baseDigest))
    p.push('provenance.baseDigest must be "sha256:" and 64 lowercase hex characters');
  if (
    pv.corpusDigest !== "none" &&
    !(typeof pv.corpusDigest === "string" && DIGEST.test(pv.corpusDigest))
  )
    p.push('provenance.corpusDigest must be a sha256 digest or "none"');
  const ids: string[] | undefined =
    Array.isArray(pv.passageIds) && pv.passageIds.every(str) ? pv.passageIds : undefined;
  if (!ids) p.push("provenance.passageIds must be a list of passage ids");
  else if (new Set(ids).size !== ids.length) p.push("provenance.passageIds lists a passage twice");
  if (!str(pv.evidenceType)) p.push("provenance.evidenceType is required");
  for (const k of ["model", "promptVersion"])
    if (pv[k] !== undefined && !str(pv[k])) p.push(`provenance.${k} must be text`);
  if (
    pv.costUsd !== undefined &&
    !(typeof pv.costUsd === "number" && Number.isFinite(pv.costUsd) && pv.costUsd >= 0)
  )
    p.push("provenance.costUsd must be a number, 0 or more");
  if (pv.at !== undefined && !isIsoDate(pv.at))
    p.push("provenance.at must be an ISO date or date-time");

  if (pv.mode !== "deterministic") {
    // A model wrote some of this. Say so, with the model and the date, where a 1.0 renderer shows it.
    if (!str(pv.model)) p.push("a machine-written view needs provenance.model");
    if (pv.at === undefined) p.push("a machine-written view needs provenance.at");
    if (typeof v.banner !== "string" || !v.banner.startsWith(AI_LABEL)) {
      p.push(`a machine-written view's banner must start with "${AI_LABEL}"`);
    } else {
      if (str(pv.model) && !v.banner.includes(pv.model))
        p.push("a machine-written view's banner must name provenance.model");
      if (typeof pv.at === "string" && !v.banner.includes(pv.at.slice(0, 10)))
        p.push("a machine-written view's banner must give the date in provenance.at");
    }
  }

  if (!ids) return;
  // Every cited passage is a bullet in "sources" (so a 1.0 renderer lists it), and every ref resolves.
  const listed = new Set(cited.filter((c) => c.inSources).map((c) => c.ref));
  for (const id of ids)
    if (!listed.has(id))
      p.push(`passage ${id} has no bullet in the "${SOURCES_SECTION_ID}" section that cites it`);
  for (const c of cited)
    if (!ids.includes(c.ref))
      p.push(`${c.where} cites ${c.ref}, which provenance.passageIds doesn't list`);
}

/** What `aiOrDeterministic` chose, and why it abstained if it did. */
export interface Chosen {
  view: ToolView;
  abstained: boolean;
  problems: string[];
}

/**
 * Abstain means: return the deterministic result alone. A model-written view is returned only when
 * it passes every check, explains this exact base result (same `baseDigest`), keeps its verdict
 * (status, headline and stats unchanged) and says where this run's input went (`runEgress`).
 * Otherwise the base comes back, with nothing from the candidate repaired, clamped to a default or
 * merged in. One thing changes on the way back: when a model provider received the input, the
 * base's `egress` says so, because abstaining can't take the input back.
 */
export function aiOrDeterministic(candidate: unknown, base: ToolView, runEgress: Egress): Chosen {
  if (!EGRESS.includes(runEgress))
    throw new Error(`aiOrDeterministic: runEgress must be one of ${EGRESS.join(", ")}`);
  const baseProblems = checkView(base);
  const bp = base.provenance;
  if (bp?.mode !== "deterministic")
    baseProblems.push("the base needs provenance with mode deterministic");
  if (baseProblems.length || !bp)
    throw new Error(
      `aiOrDeterministic: the base is not a valid deterministic view: ${baseProblems.join("; ")}`,
    );
  const problems = checkView(candidate);
  const c = candidate as ToolView;
  if (!problems.length) {
    if (!c.provenance) problems.push("the candidate has no provenance");
    else if (c.provenance.mode === "deterministic")
      problems.push("the candidate says no model wrote it");
    else {
      if (c.provenance.egress !== runEgress)
        problems.push("the candidate's egress is not where this run's input went");
      if (c.provenance.baseDigest !== bp.baseDigest)
        problems.push("the candidate explains a different result (baseDigest differs)");
      if (c.status !== base.status) problems.push("the candidate changes the status");
      if (c.headline !== base.headline) problems.push("the candidate changes the headline");
      if (!sameData(c.stats ?? [], base.stats ?? []))
        problems.push("the candidate changes the stats");
    }
  }
  const fallback =
    bp.egress === runEgress ? base : { ...base, provenance: { ...bp, egress: runEgress } };
  return problems.length
    ? { view: fallback, abstained: true, problems }
    : { view: c, abstained: false, problems };
}
