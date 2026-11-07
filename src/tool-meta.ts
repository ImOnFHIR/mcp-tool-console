/**
 * Tool metadata conventions shared by every ImOnFHIR MCP tool (see "The contract" in README.md).
 * Standard JSON Schema carries field names, help, choices and examples. These `_meta` keys carry
 * what JSON Schema can't: the plain "what it is / does / how to use" text, presets, cost and form
 * layout on the tool, and a ready-to-show result view on each result.
 */
import type { ToolView } from "./ui/view.js";

export const META = {
  about: "com.imonfhir/about",
  presets: "com.imonfhir/presets",
  cost: "com.imonfhir/cost",
  form: "com.imonfhir/form",
  view: "com.imonfhir/view",
} as const;

/** Short bullets, no narrative. Each line ≤ 110 characters. */
export interface About {
  whatItIs: string[];
  whatItDoes: string[];
  howToUse: string[];
  safeToRun: string[];
}

/** A one-click example run: "Try: the borrowed card". `args` must validate against the tool's inputSchema. */
export interface Preset {
  id: string;
  label: string;
  args: Record<string, unknown>;
  argsFrom?: Record<string, { resource: string }>;
}

/** A tool with no cost entry is treated as not free. */
export type Cost = { free: true } | { free: false; note: string };

/** Which inputs sit behind "More settings". */
export interface FormHints {
  advanced?: string[];
}

export interface ToolMeta {
  about: About;
  presets?: Preset[];
  cost: Cost;
  form?: FormHints;
}

/** The `_meta` object for registerTool. */
export function toolMeta(m: ToolMeta): Record<string, unknown> {
  return {
    [META.about]: m.about,
    [META.cost]: m.cost,
    ...(m.presets ? { [META.presets]: m.presets } : {}),
    ...(m.form ? { [META.form]: m.form } : {}),
  };
}

/** The `_meta` object for a tool result. */
export function resultMeta(view: ToolView): Record<string, unknown> {
  return { [META.view]: view };
}

/**
 * The tool description as plain text, built from `about` so there is one source. Clients that
 * know nothing of `_meta` (Claude, the Inspector) still get the same sections.
 */
export function describe(
  about: About,
  extra: { settings?: string[]; lists?: { title: string; items: string[] }[] } = {},
): string {
  const block = (title: string, items: string[]) => [title, ...items.map((i) => `• ${i}`)];
  const parts: string[][] = [
    block("WHAT IT IS", about.whatItIs),
    block("WHAT IT DOES", about.whatItDoes),
    ...(extra.settings ? [block("SETTINGS (all optional)", extra.settings)] : []),
    block("HOW TO USE", about.howToUse),
    ...(extra.lists ?? []).map((l) => block(l.title, l.items)),
    block("SAFE TO RUN", about.safeToRun),
  ];
  return parts.map((p) => p.join("\n")).join("\n\n");
}
