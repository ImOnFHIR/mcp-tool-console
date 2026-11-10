/**
 * `mcp-tool-console package`: turn a configured MCP server into a folder other sites can pin.
 * Node only (starts servers, runs git, writes files). Not browser-safe, so it is not in `src/index.ts`.
 *
 *   package.json         { id, name, version, tools }
 *   tools/<tool>.json    the tools/list entry, `_meta` included
 *   views/<tool>/<preset>.json   the ToolView a preset produced (free, read-only tools only)
 *   runs/<tool>/<file>.json      recorded runs copied from --runs, exact shape checked
 *   PROVENANCE.json      sha256 of every file, plus packageDigest
 *
 * Output is deterministic: sorted keys, sorted file lists, no timestamps, no commit SHA. A consumer
 * pins `packageDigest`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConsoleConfig, type ServerConfig } from "./console/config.js";
import { Hub } from "./console/hub.js";
import { isFree } from "./console/http.js";
import { META } from "./tool-meta.js";
import { checkView } from "./ui/view.js";

export class PackageError extends Error {}

/** A package file's path (forward slashes, relative to the package folder) and its text. */
export type Files = Map<string, string>;

export interface BuiltPackage {
  id: string;
  files: Files;
  /** `tool/preset` for each preset that was actually run (the free, read-only ones). */
  called: string[];
  /** `tool/preset` for each preset left alone, with the reason. */
  skipped: { preset: string; reason: string }[];
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** Names Windows refuses as a file name, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Leaves room for the ".json" a name gets, under the 255-character limit most disks have. */
const MAX_NAME = 100;

/** A name safe to use as a file or folder name on any disk (plain characters, short, no trailing dot, not reserved). */
export const isSafeName = (n: unknown): n is string =>
  typeof n === "string" &&
  n.length <= MAX_NAME &&
  SAFE.test(n) &&
  !n.endsWith(".") &&
  !WINDOWS_RESERVED.test(n.split(".")[0]);

const RUN_KEYS = [
  "args",
  "costUsd",
  "lockDigest",
  "model",
  "recorded",
  "structuredContent",
  "tool",
  "v",
  "view",
];

const isObj = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** Same data, keys in sorted order at every depth (arrays keep their order). */
export function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (isObj(x))
    return Object.fromEntries(
      Object.keys(x)
        .toSorted()
        .map((k) => [k, sortKeys(x[k])]),
    );
  return x;
}
export const canonical = (x: unknown) => JSON.stringify(sortKeys(x), null, 2) + "\n";
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/**
 * Tracked files with uncommitted changes in the repo at `dir`. Untracked files are not counted: a
 * package must be reproducible from committed content, and the folders this command writes
 * (`package/`, `dist/`) are untracked until you commit them, so counting them would refuse every
 * second run. A folder that is not a git repo is refused: nothing says what the package came from.
 */
export function dirtyFiles(dir: string): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["-C", dir, "status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new PackageError(
      `${dir} is not a git repository, so there is no commit to package from.`,
    );
  }
  return out.split("\n").filter(Boolean);
}

/**
 * Uncommitted tracked changes in the repository that holds each folder, one report per repository.
 * A server can live in another checkout (a local config's `cwd`), and its files are what the package
 * is built from, so its repository must be clean too.
 */
export function dirtyAcross(dirs: string[]): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const dir of dirs) {
    let top: string;
    try {
      top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      throw new PackageError(
        `${dir} is not in a git repository, so there is no commit to package from.`,
      );
    }
    if (seen.has(top)) continue;
    seen.add(top);
    for (const l of dirtyFiles(top)) problems.push(`${top}: ${l}`);
  }
  return problems;
}

export interface RecordedRun {
  file: string;
  text: string;
  tool: string;
}

/** Reads a runs folder and checks every file has exactly the recorded-run shape. */
export function readRuns(dir: string): RecordedRun[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new PackageError(`--runs ${dir} is not a folder`);
  const runs: RecordedRun[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (e.name.startsWith(".")) continue;
    if (!e.isFile() || !e.name.endsWith(".json") || !isSafeName(e.name))
      throw new PackageError(`runs/${e.name}: only plain .json files are allowed`);
    const text = readFileSync(join(dir, e.name), "utf8");
    let r: any;
    try {
      r = JSON.parse(text);
    } catch {
      throw new PackageError(`runs/${e.name}: not valid JSON`);
    }
    const bad = (why: string) => {
      throw new PackageError(`runs/${e.name}: ${why}`);
    };
    if (!isObj(r)) bad("must be an object");
    const keys = Object.keys(r).toSorted();
    if (keys.join() !== RUN_KEYS.join())
      bad(`keys must be exactly { ${RUN_KEYS.join(", ")} }, found { ${keys.join(", ")} }`);
    if (r.v !== 1) bad("v must be 1");
    for (const k of ["recorded", "tool", "model", "lockDigest"])
      if (typeof r[k] !== "string" || !r[k].trim()) bad(`${k} must be a non-empty string`);
    if (!isSafeName(r.tool)) bad("tool is not a usable folder name");
    if (!isObj(r.args)) bad("args must be an object");
    if (!(typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0))
      bad("costUsd must be a number, 0 or more");
    const problems = checkView(r.view);
    if (problems.length) bad(`view is not a valid ToolView: ${problems.join("; ")}`);
    runs.push({ file: e.name, text, tool: r.tool });
  }
  return runs;
}

/**
 * Starts one configured server, lists its tools, runs the presets of free read-only tools and
 * returns every package file in memory. Nothing is written here and no git check is made (the
 * command does that), so tests can call it on a dirty tree.
 */
export async function buildPackage(
  config: ServerConfig,
  opts: { runs?: RecordedRun[] } = {},
): Promise<BuiltPackage> {
  const hub = new Hub([config]);
  try {
    await hub.start(config.id);
    const info = hub.info(config.id);
    if (!info)
      throw new PackageError(`${config.id}: ${hub.error(config.id) ?? "the server did not start"}`);
    const tools = [...hub.overview()[0].tools].toSorted((a, b) => (a.name < b.name ? -1 : 1));
    const files: Files = new Map();
    const called: string[] = [];
    const skipped: BuiltPackage["skipped"] = [];
    const names = new Set<string>();
    for (const t of tools) {
      if (!isSafeName(t.name))
        throw new PackageError(`${config.id}: tool name "${t.name}" is not usable as a file name`);
      if (names.has(t.name)) throw new PackageError(`${config.id}: tool ${t.name} is listed twice`);
      names.add(t.name);
      files.set(`tools/${t.name}.json`, canonical(t));

      const presets = t._meta?.[META.presets];
      if (presets === undefined) continue;
      if (!Array.isArray(presets)) throw new PackageError(`${t.name}: presets must be a list`);
      const ids = new Set<string>();
      for (const p of presets) {
        if (!isObj(p) || !isSafeName(p.id) || !isObj(p.args))
          throw new PackageError(`${t.name}: a preset needs a plain id and an args object`);
        if (ids.has(p.id)) throw new PackageError(`${t.name}: preset ${p.id} is listed twice`);
        ids.add(p.id);
        const label = `${t.name}/${p.id}`;
        // Never call a tool that could write or cost money. A tool with no cost entry is not free.
        if (t.annotations?.readOnlyHint !== true) {
          skipped.push({ preset: label, reason: "tool is not marked read-only" });
          continue;
        }
        if (!isFree(t)) {
          skipped.push({ preset: label, reason: "tool is not declared free" });
          continue;
        }
        if (p.argsFrom !== undefined)
          throw new PackageError(`${label}: presets with argsFrom can't be run by this command`);
        called.push(label);
        const r: any = await hub.call(config.id, t.name, p.args, `package-${label}`);
        if (r.isError) throw new PackageError(`${label}: the tool returned an error`);
        const view = r._meta?.[META.view];
        if (view === undefined) throw new PackageError(`${label}: the result carries no view`);
        const problems = checkView(view);
        if (problems.length)
          throw new PackageError(`${label}: view is not a valid ToolView: ${problems.join("; ")}`);
        files.set(`views/${t.name}/${p.id}.json`, canonical(view));
      }
    }
    files.set(
      "package.json",
      canonical({
        id: config.id,
        name: info.name,
        version: info.version,
        tools: tools.map((t) => t.name),
      }),
    );
    for (const run of opts.runs ?? [])
      if (names.has(run.tool)) files.set(`runs/${run.tool}/${run.file}`, run.text);
    assertDistinctPaths(files);
    files.set("PROVENANCE.json", provenance(files));
    return { id: config.id, files, called, skipped };
  } finally {
    await hub.stopAll();
  }
}

/**
 * Two paths that differ only in case (or Unicode form) are the same file on a default macOS or
 * Windows disk: one would overwrite the other while PROVENANCE kept both hashes.
 */
export function assertDistinctPaths(files: Files) {
  const seen = new Map<string, string>();
  for (const p of files.keys()) {
    const key = p.normalize("NFC").toLowerCase();
    const other = seen.get(key);
    if (other !== undefined)
      throw new PackageError(`${other} and ${p} would be the same file on a case-insensitive disk`);
    seen.set(key, p);
  }
}

/**
 * Per-file sha256 and `packageDigest`: "sha256:" + hex of the sorted `path:hash` lines joined by
 * "\n". There is no commit in it on purpose: a commit SHA changes with every commit, so a committed
 * package would be stale straight away. The digest changes only when the package's content does.
 */
export function provenance(files: Files): string {
  const hashes = [...files.keys()]
    .filter((p) => p !== "PROVENANCE.json")
    .toSorted()
    .map((p) => [p, sha256(files.get(p)!)] as const);
  const digest = sha256(hashes.map(([p, h]) => `${p}:${h}`).join("\n"));
  return canonical({ v: 1, files: Object.fromEntries(hashes), packageDigest: `sha256:${digest}` });
}

/**
 * True when `out` holds exactly an earlier package, untouched: PROVENANCE.json, every file it lists
 * with the hash it records, nothing else, and a packageDigest that recomputes. Anything else in
 * there is someone else's work (or has been edited by hand) and is not ours to delete.
 */
function isEarlierPackage(out: string): boolean {
  try {
    const prov = JSON.parse(readFileSync(join(out, "PROVENANCE.json"), "utf8"));
    if (prov?.v !== 1 || !isObj(prov.files)) return false;
    const walk = (dir: string, pre: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name), `${pre}${e.name}/`) : [pre + e.name],
      );
    // The exact file set, each file as recorded, and the digest recomputed from them.
    const found = walk(out, "").filter((f) => f !== "PROVENANCE.json");
    if (found.toSorted().join("\n") !== Object.keys(prov.files).toSorted().join("\n")) return false;
    const files: Files = new Map(found.map((f) => [f, readFileSync(join(out, f), "utf8")]));
    return provenance(files) === canonical(prov);
  } catch {
    return false;
  }
}

/** Writes a built package. A folder that already holds something must be exactly an earlier package. */
export function writePackage(out: string, files: Files) {
  if (existsSync(out)) {
    if (!statSync(out).isDirectory()) throw new PackageError(`${out} exists and is not a folder`);
    if (readdirSync(out).length && !isEarlierPackage(out))
      throw new PackageError(
        `${out} is not empty and is not an earlier package; won't overwrite it`,
      );
    rmSync(out, { recursive: true, force: true });
  }
  for (const [path, text] of [...files].toSorted((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

const USAGE = "usage: mcp-tool-console package [--server <id>] [--out <dir>] [--runs <dir>]";

/** The `package` subcommand. Returns the exit code; prints its own errors. */
export async function runPackageCommand(argv: string[], cwd: string): Promise<number> {
  try {
    const opt: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 2) {
      const k = argv[i];
      if (!["--server", "--out", "--runs"].includes(k) || argv[i + 1] === undefined)
        throw new PackageError(USAGE);
      opt[k.slice(2)] = argv[i + 1];
    }
    // Before anything starts or is written: a package must come from committed files.
    const all = loadConsoleConfig(cwd);
    const picked = opt.server ? all.filter((s) => s.id === opt.server) : all;
    const dirty = dirtyAcross([cwd, ...picked.map((s) => s.cwd)]);
    if (dirty.length)
      throw new PackageError(
        `Uncommitted changes to tracked files; commit or stash them first. Nothing was written.\n${dirty.map((l) => `  ${l}`).join("\n")}`,
      );
    if (!picked.length)
      throw new PackageError(
        opt.server
          ? `No server "${opt.server}" in the config (have: ${all.map((s) => s.id).join(", ")})`
          : "No servers in the config",
      );
    const runs = opt.runs ? readRuns(resolve(cwd, opt.runs)) : [];
    const built: { out: string; pkg: BuiltPackage }[] = [];
    for (const s of picked) {
      const pkg = await buildPackage(s, { runs });
      const direct = Boolean(opt.server && opt.out);
      if (!direct && !isSafeName(s.id))
        throw new PackageError(`server id "${s.id}" can't be used as a folder name on every disk`);
      const out = direct ? opt.out! : join(opt.out ?? "package", s.id);
      built.push({ out: resolve(cwd, out), pkg });
    }
    // A recording carries no server id: if two packaged servers both have its tool, whose is it?
    for (const r of runs) {
      const owners = built.filter((b) => b.pkg.files.has(`runs/${r.tool}/${r.file}`));
      if (owners.length > 1)
        throw new PackageError(
          `runs/${r.file}: ${owners.map((b) => b.pkg.id).join(" and ")} both have a tool named ${r.tool}; package one with --server`,
        );
    }
    // A run for a tool no packaged server has is a mistake, not something to drop quietly.
    if (!opt.server) {
      const known = new Set(built.flatMap((b) => [...b.pkg.files.keys()].map((p) => p)));
      for (const r of runs)
        if (![...known].some((p) => p.startsWith(`runs/${r.tool}/`)))
          throw new PackageError(`runs/${r.file}: no packaged server has a tool named ${r.tool}`);
    }
    for (const b of built) writePackage(b.out, b.pkg.files);
    for (const b of built) {
      console.log(`${b.pkg.id}: ${b.pkg.files.size} files -> ${b.out}`);
      for (const s of b.pkg.skipped) console.log(`  not run: ${s.preset} (${s.reason})`);
    }
    return 0;
  } catch (e) {
    console.error(`package: ${(e as Error).message}`);
    return 1;
  }
}
