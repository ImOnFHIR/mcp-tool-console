/**
 * Hosted mode's read-only tool catalog. It reads tool packages from one folder and never writes there.
 *
 *   <dir>/<server-id>/package.json
 *                    /tools/*.json            one tools/list entry each, with _meta
 *                    /views/**\/*.json         ToolView conformance views (not served yet)
 *                    /runs/<tool>/*.json      recorded runs { v: 1, recorded, tool, args, ... }
 *                    /PROVENANCE.json         (not served yet)
 *
 * Nothing a name says can leave the folder: ids and file names are matched against a short
 * pattern, symbolic links are skipped, and every path is checked against the folder's real path.
 */
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";

export interface CatalogServer {
  id: string;
  tools: unknown[];
  runs: { tool: string; file: string; recorded: string }[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// 100 characters, so a long tool name fits both its `runs/<tool>/` folder and its `<tool>.json` file.
const TOOL_DIR = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const JSON_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\.json$/;
const MAX_FILE = 2 * 1024 * 1024;

/**
 * The names the catalog will read, exported so the `package` command writes only names it can read.
 * One rule, in one place.
 */
export const isCatalogId = (n: unknown): n is string => typeof n === "string" && ID.test(n);
export const isCatalogToolDir = (n: unknown): n is string =>
  typeof n === "string" && TOOL_DIR.test(n);

/** The real path of root/parts, only if it is a plain (non-link) entry that stays inside root. */
async function inside(rootReal: string, ...parts: string[]): Promise<string | null> {
  const path = join(rootReal, ...parts);
  try {
    if ((await lstat(path)).isSymbolicLink()) return null;
    const real = await realpath(path);
    return real === rootReal || real.startsWith(rootReal + sep) ? real : null;
  } catch {
    return null;
  }
}

async function names(rootReal: string, ...parts: string[]): Promise<string[]> {
  const dir = await inside(rootReal, ...parts);
  if (!dir) return [];
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function readJson(rootReal: string, ...parts: string[]): Promise<any | undefined> {
  const file = await inside(rootReal, ...parts);
  if (!file) return undefined;
  try {
    const st = await lstat(file);
    if (!st.isFile() || st.size > MAX_FILE) return undefined;
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** One package, or null when the id is not a plain id, or the package isn't there. */
export async function readPackage(root: string, id: string): Promise<CatalogServer | null> {
  if (!ID.test(id)) return null;
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return null;
  }
  const pkgDir = await inside(rootReal, id);
  if (!pkgDir || !(await readJson(rootReal, id, "package.json"))) return null;

  const tools: unknown[] = [];
  for (const f of await names(rootReal, id, "tools")) {
    if (!JSON_FILE.test(f)) continue;
    const t = await readJson(rootReal, id, "tools", f);
    if (t && typeof t === "object" && typeof t.name === "string") tools.push(t);
  }
  const runs: CatalogServer["runs"] = [];
  for (const tool of await names(rootReal, id, "runs")) {
    if (!TOOL_DIR.test(tool)) continue;
    for (const f of await names(rootReal, id, "runs", tool)) {
      if (!JSON_FILE.test(f)) continue;
      const r = await readJson(rootReal, id, "runs", tool, f);
      if (r?.v === 1 && typeof r.recorded === "string")
        runs.push({ tool, file: `${tool}/${f}`, recorded: r.recorded });
    }
  }
  return { id, tools, runs };
}

export async function readCatalog(root: string | undefined): Promise<{ servers: CatalogServer[] }> {
  if (!root) return { servers: [] };
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return { servers: [] };
  }
  const servers: CatalogServer[] = [];
  for (const id of await names(rootReal)) {
    const p = await readPackage(rootReal, id);
    if (p) servers.push(p);
  }
  return { servers };
}
