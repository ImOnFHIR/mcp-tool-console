// The matcher behind the "no AI SDK and no spending code" rule (AGENTS.md).
// test/console.test.ts runs it over package.json and the repo's code, and proves it
// against a positive twin (every listed vendor, every import form) and a negative twin.

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

/** Module specifiers in static import, export-from, side-effect import, dynamic import and require. */
export function moduleSpecifiers(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])([^"'`\n]+)\1/g;
  return [...source.matchAll(re)].map((m) => m[2]!);
}

/** Every banned import, and any spend-code reference, in one source text. */
export function aiSdkFindings(source: string): string[] {
  const spend = source.match(SPEND_CODE);
  return [...moduleSpecifiers(source).filter(isAiSdk), ...(spend ? [spend[0]] : [])];
}

/** Every dependency name a package.json declares, across all four dependency maps. */
export function declaredDependencies(pkg: Record<string, unknown>): string[] {
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(
    (k) => Object.keys((pkg[k] as Record<string, string> | undefined) ?? {}),
  );
}
