// The matcher behind the "no AI SDK and no spending code" rule (AGENTS.md).
// test/console.test.ts runs it over package.json, package-lock.json and the repo's code, and
// proves it against a positive twin (every listed vendor, every import form) and a negative twin.
//
// Layers, because each misses something the others catch:
// - declared dependencies, including npm alias targets ("model-client": "npm:openai@6");
// - installed packages in package-lock.json, which also names transitive and aliased packages;
// - import specifiers in the code, parsed by esbuild, so comments and prose never count. A
//   type-only import is erased before it can be seen here; it needs the package installed, which
//   the two layers above catch. A specifier with a scheme other than node: (https:, data:, blob:,
//   file:) is refused: it loads code no dependency check can see;
// - fail closed: an import() or require() whose argument isn't one plain string literal
//   (`import(url)`, `import("./x" + y)`) is refused, since no layer can see what it loads. It is
//   checked on esbuild's output, which has no comments, so a comment can neither hide nor fake one;
// - the scoped vendor names anywhere in the text, as the ban before this one did.
//
// What it is for: noticing an SDK added the ordinary ways. It is not a sandbox against code that
// sets out to hide one (eval, new Function, a Worker script, a string assembled at run time).
import { build, transform } from "esbuild";

/**
 * Model-vendor SDK packages. An entry ending in "/" is a scope; any other entry is an
 * exact package name that also covers its subpaths ("openai/resources").
 * This is a denylist: a vendor not named here passes.
 */
export const AI_SDK_PACKAGES = [
  "@anthropic-ai/",
  "openai",
  "@google/genai",
  "@google/generative-ai",
  "ai", // Vercel AI SDK
  "@ai-sdk/", // its provider packages
  "@mistralai/",
  "cohere-ai",
  "@langchain/",
  "langchain",
  "ollama",
  "groq-sdk",
  "@aws-sdk/client-bedrock-runtime",
  "@huggingface/inference",
] as const;

/** Spend code, by the file names the shared spend ledger and model matchers use elsewhere. */
export const SPEND_CODE = /spend\.js|alert\.js|matchers\/llm/;

/** True when a module specifier names a banned package or a subpath of one. */
export function isAiSdk(specifier: string): boolean {
  return AI_SDK_PACKAGES.some((p) =>
    p.endsWith("/") ? specifier.startsWith(p) : specifier === p || specifier.startsWith(`${p}/`),
  );
}

/**
 * A specifier with a URL scheme other than node: (https:, data:, blob:, file:), or protocol-relative.
 * Such code is never installed, so no dependency check can see what it is.
 */
export const isUrlImport = (specifier: string): boolean =>
  specifier.startsWith("//") ||
  (/^[a-z][a-z0-9+.-]*:/i.test(specifier) && !specifier.startsWith("node:"));

/** The loader esbuild needs for a source file, or undefined when the file isn't JS or TS. */
export function loaderFor(file: string): "ts" | "js" | undefined {
  if (/\.(ts|mts|cts)$/.test(file)) return "ts";
  if (/\.(js|mjs|cjs)$/.test(file)) return "js";
  return undefined;
}

/**
 * Every module specifier a source imports or requires with a literal: static import, export-from,
 * side-effect import, dynamic import, require. Parsed, not pattern-matched.
 */
export async function moduleSpecifiers(source: string, loader: "ts" | "js"): Promise<string[]> {
  const found: string[] = [];
  await build({
    stdin: { contents: source, loader, resolveDir: "/" },
    bundle: true,
    write: false,
    logLevel: "silent",
    platform: "neutral",
    format: "esm",
    // Keep value imports whose bindings are unused; TypeScript semantics would drop them.
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
    plugins: [
      {
        name: "collect-specifiers",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            found.push(a.path);
            return { path: a.path, external: true };
          });
        },
      },
    ],
  });
  return found;
}

const CALL = /\b(?:import|require)\s*\(/g;
/**
 * What may follow `import(` or `require(` in esbuild's output: one plain string literal, then `)` or
 * `,`. esbuild keeps bundler directive comments (webpackIgnore, @vite-ignore) there, so those may come
 * first.
 */
const LITERAL_ARG = /^\s*(?:\/\*[^*]*\*\/\s*)*(?:"[^"\\\n]*"|'[^'\\\n]*'|`[^`\\$]*`)\s*[,)]/;

/** The code without comments or types, as esbuild prints it. */
export async function codeOnly(source: string, loader: "ts" | "js"): Promise<string> {
  const out = await transform(source, {
    loader,
    legalComments: "none",
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
  return out.code;
}

/** Each import() or require() call in comment-free code whose argument isn't a plain string literal. */
export function computedImports(code: string): string[] {
  return [...code.matchAll(CALL)]
    .filter((m) => !LITERAL_ARG.test(code.slice(m.index + m[0].length)))
    .map((m) => `computed import: ${code.slice(m.index).split("\n")[0].slice(0, 60)}`);
}

/** The scoped vendor names (every "@…" entry), matched anywhere in the text. */
const SCOPED = AI_SDK_PACKAGES.filter((p) => p.startsWith("@"));

/** Every banned, URL or computed import, scoped vendor name and spend-code reference in a source. */
export async function aiSdkFindings(source: string, loader: "ts" | "js" = "ts"): Promise<string[]> {
  let specs: string[] = [];
  let code = "";
  let unreadable: string[] = [];
  try {
    code = await codeOnly(source, loader);
    specs = await moduleSpecifiers(source, loader);
  } catch (e) {
    // A file the parser can't read is a finding, not a crash: the ban must go red, not throw.
    unreadable = [`unreadable: ${String((e as Error).message).split("\n")[0]}`];
  }
  const spend = source.match(SPEND_CODE);
  return [
    ...unreadable,
    ...specs.filter((s) => isAiSdk(s) || isUrlImport(s)),
    ...computedImports(code),
    ...SCOPED.filter((p) => source.includes(p)),
    ...(spend ? [spend[0]] : []),
  ];
}

/** The real package behind an npm alias ("npm:openai@6.0.0" → "openai"), or undefined. */
export function aliasTarget(version: unknown): string | undefined {
  if (typeof version !== "string" || !version.startsWith("npm:")) return undefined;
  const rest = version.slice(4);
  const at = rest.indexOf("@", rest.startsWith("@") ? 1 : 0);
  return at === -1 ? rest : rest.slice(0, at);
}

/** Every package a package.json declares, across all four maps, with npm alias targets. */
export function declaredDependencies(pkg: Record<string, unknown>): string[] {
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(
    (k) =>
      Object.entries((pkg[k] as Record<string, unknown> | undefined) ?? {}).flatMap(([name, v]) => {
        const target = aliasTarget(v);
        return target ? [name, target] : [name];
      }),
  );
}

/** Every package package-lock.json installs, transitive and aliased ones included, by real name. */
export function installedPackages(lock: Record<string, unknown>): string[] {
  const packages = (lock.packages as Record<string, { name?: unknown }> | undefined) ?? {};
  return Object.entries(packages)
    .filter(([path]) => path.includes("node_modules/"))
    .map(([path, entry]) =>
      typeof entry?.name === "string"
        ? entry.name
        : path.slice(path.lastIndexOf("node_modules/") + 13),
    );
}
