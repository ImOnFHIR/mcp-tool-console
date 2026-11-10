// npm run ui:build — the dev console page as one self-contained file: dist/ui/console.html.
// Script and styles are inlined; no external requests (the console serves it with a strict CSP).
import { mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { TOKENS, VIEW_CSS } from "../dist/src/ui/styles.js";

const CONSOLE_CSS = `
/* Layout: top bar; left nav of servers and tools; one full-width tool column; drawer slides over on the right. */
* { box-sizing: border-box; }
/* An element's own display (grid, flex) must never keep a [hidden] element on screen. */
[hidden] { display: none !important; }
html, body { height: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 var(--body); }
a { color: var(--accent); }
.c-top { position: sticky; top: 0; z-index: 5; display: flex; gap: 0.75rem; align-items: center; padding-block: 0.6rem;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: var(--panel); border-bottom: 1px solid var(--rule); }
.c-brand { font: 600 1rem/1 var(--display); white-space: nowrap; color: var(--ink); text-decoration: none; }
.c-brand small { font: 400 0.75rem var(--body); color: var(--muted); margin-left: 0.4rem; }
.c-top input[type=search] { flex: 1; max-width: 28rem; font: inherit; padding: 0.45rem 0.7rem; border: 1px solid var(--rule); border-radius: 6px; background: var(--paper); color: var(--ink); }
#nav-toggle { display: none; }
.c-shell { display: grid; grid-template-columns: 17rem minmax(0, 1fr); min-height: calc(100% - 3.2rem); }
#nav { border-right: 1px solid var(--rule); padding: 1rem; overflow-y: auto; background: var(--panel); }
.c-group + .c-group { margin-top: 1.25rem; }
.c-group-head { display: flex; gap: 0.5rem; align-items: center; margin: 0 0 0.4rem; font: 600 0.78rem/1.2 var(--body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.c-group ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; }
.c-group a { display: grid; gap: 0.1rem; padding: 0.45rem 0.55rem; border-radius: 6px; text-decoration: none; color: var(--ink); }
.c-group a span { font-size: 0.8rem; color: var(--muted); }
.c-group a:hover, .c-group a[aria-current=page] { background: var(--card); }
.c-dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--muted); flex: none; }
.c-dot.c-ready { background: var(--good); } .c-dot.c-stopped { background: var(--bad); } .c-dot.c-starting { background: var(--warn); }
main#main { padding-block: 1.5rem 4rem; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 1.25rem; align-content: start; max-width: 72rem; width: 100%; outline: none; }
.c-title { margin: 0; font: 600 clamp(1.4rem, 3vw, 1.9rem)/1.2 var(--display); text-wrap: balance; }
.c-muted { color: var(--muted); }
.c-card-server { font: 600 0.72rem/1 var(--body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.c-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 0.75rem; }
.c-card { display: grid; gap: 0.35rem; padding: 1rem; background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; text-decoration: none; color: var(--ink); }
.c-card span:last-child { font-size: 0.88rem; color: var(--muted); }
.c-tool-head { display: grid; gap: 0.4rem; }
.c-badges { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.c-badge { font-size: 0.78rem; padding: 0.2rem 0.55rem; border-radius: 999px; background: var(--good-bg); color: var(--good); }
.c-badge-warn { background: var(--warn-bg); color: var(--warn); } .c-badge-bad { background: var(--bad-bg); color: var(--bad); } .c-badge-quiet { background: var(--card); color: var(--muted); }
.c-about { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; padding: 1rem; background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; }
.c-about h3 { margin: 0 0 0.3rem; font: 600 0.78rem/1.2 var(--body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.c-about ul { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; }
.c-about-raw pre { white-space: pre-wrap; font: 0.85rem/1.5 var(--mono); }
.c-presets { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.c-chip { font: inherit; font-size: 0.9rem; padding: 0.45rem 0.85rem; border-radius: 999px; border: 1px solid var(--accent); background: var(--panel); color: var(--accent); cursor: pointer; }
.c-chip:hover { background: var(--info-bg); }
.c-result:empty { display: none; }
.c-settings-line { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; font-size: 0.88rem; color: var(--muted); }
.c-form { display: grid; gap: 1rem; padding: 1rem; background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; }
.f-field { display: grid; gap: 0.35rem; border: 0; padding: 0; margin: 0; min-width: 0; }
.f-field > label, .f-field > legend { font-weight: 600; }
.f-help { margin: 0; font-size: 0.85rem; color: var(--muted); }
.f-req { font-size: 0.75rem; color: var(--warn); font-weight: 400; }
.f-chip-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.f-chip { display: inline-flex; gap: 0.4rem; align-items: center; padding: 0.35rem 0.7rem; border: 1px solid var(--rule); border-radius: 999px; cursor: pointer; font-size: 0.9rem; }
.f-chip:has(input:checked) { border-color: var(--accent); background: var(--info-bg); }
.f-range { display: flex; gap: 0.75rem; align-items: center; } .f-range input[type=range] { flex: 1; max-width: 24rem; }
.f-field input[type=number], .f-field input[type=text], .f-field select, .f-field textarea { font: inherit; padding: 0.45rem 0.6rem; border: 1px solid var(--rule); border-radius: 6px; background: var(--paper); color: var(--ink); max-width: 100%; }
.f-field input[type=number] { width: 7rem; }
.f-field textarea { font: 0.85rem/1.45 var(--mono); width: 100%; min-height: 10rem; resize: vertical; }
.f-paste-tools { display: flex; gap: 0.5rem; }
.f-paste-tools button, .c-link { font: inherit; font-size: 0.9rem; background: none; border: 0; padding: 0.2rem 0.3rem; color: var(--accent); cursor: pointer; text-decoration: underline; }
.f-advanced > summary { cursor: pointer; font-weight: 600; color: var(--accent); }
.f-advanced[open] { display: grid; gap: 1rem; }
.c-cost { font-size: 0.9rem; color: var(--warn); }
.c-run-row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.c-run { font: 600 1rem var(--body); padding: 0.65rem 1.6rem; border-radius: 8px; border: 0; background: var(--accent); color: var(--panel); cursor: pointer; }
.c-run:disabled { opacity: 0.6; cursor: progress; }
.c-error-line { margin: 0; color: var(--bad); font-size: 0.9rem; }
.c-history h2 { font: 600 0.78rem/1.2 var(--body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.4rem; }
.c-history ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
.c-history-item { font: inherit; font-size: 0.88rem; text-align: left; width: 100%; background: none; border: 0; padding: 0.35rem 0.4rem; border-radius: 6px; cursor: pointer; color: var(--ink); }
.c-history-item:hover { background: var(--card); }
.c-pill-good { color: var(--good); } .c-pill-bad, .c-pill-error { color: var(--bad); } .c-pill-warn, .c-pill-info { color: var(--warn); }
#tech-btn { position: fixed; right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 6; font: inherit; font-size: 0.88rem; padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid var(--rule); background: var(--panel); color: var(--ink); cursor: pointer; box-shadow: 0 2px 8px rgb(0 0 0 / 0.12); }
#drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 7; width: min(46rem, 100%); background: var(--panel); border-left: 1px solid var(--rule); padding: 1rem; padding-right: max(1rem, env(safe-area-inset-right, 0px)); display: grid; grid-template-rows: auto auto 1fr auto; gap: 0.75rem; box-shadow: -4px 0 16px rgb(0 0 0 / 0.15); }
#drawer[hidden] { display: none; }
.c-drawer-head { display: flex; justify-content: space-between; align-items: center; } .c-drawer-head h2 { margin: 0; font: 600 1.1rem var(--display); }
.c-tabs { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.c-tabs button { font: inherit; font-size: 0.85rem; padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); cursor: pointer; }
.c-tabs button[aria-selected=true] { border-color: var(--accent); color: var(--accent); }
.c-tab-body { margin: 0; overflow: auto; padding: 0.75rem; background: var(--card); border-radius: 6px; font: 0.8rem/1.45 var(--mono); white-space: pre-wrap; word-break: break-word; }
@media (max-width: 760px) {
  #nav-toggle { display: inline-block; font: inherit; padding: 0.4rem 0.7rem; border-radius: 6px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
  .c-brand small { display: none; }
  .c-shell { grid-template-columns: 1fr; }
  #nav { display: none; position: fixed; inset: 3.2rem 0 0 0; z-index: 8; border-right: 0; }
  body.c-nav-open #nav { display: block; }
  .c-run-row { position: sticky; bottom: 0; background: var(--panel); padding-block: 0.6rem; }
  .c-run { flex: 1; }
}
`;

const out = await build({
  entryPoints: ["src/ui/browser/console-main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  minify: true,
  logLevel: "error",
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ImOnFHIR Dev Console</title>
<style>${TOKENS}${VIEW_CSS}${CONSOLE_CSS}</style>
</head>
<body>
<header class="c-top"><button type="button" id="nav-toggle" aria-controls="nav">Tools</button><a class="c-brand" href="#/">ImOnFHIR Dev Console<small>local only</small></a><input type="search" id="search" placeholder="Find a tool" aria-label="Find a tool"></header>
<div class="c-shell"><nav id="nav" aria-label="Tools"></nav><main id="main" tabindex="-1"><p class="c-muted">Loading tools…</p></main></div>
<button type="button" id="tech-btn" hidden>Technical details</button>
<aside id="drawer" aria-label="Technical details" hidden></aside>
<script>${js}</script>
</body>
</html>
`;
mkdirSync("dist/ui", { recursive: true });
writeFileSync("dist/ui/console.html", html);
console.log(`dist/ui/console.html (${Math.round(html.length / 1024)} KB)`);
