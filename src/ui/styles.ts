/**
 * Design tokens and ToolView styles, shared by the dev console and the in-Claude view.
 * Tokens match report/scoreboard.html. System font stacks only: the in-Claude view's CSP blocks web fonts.
 */
export const TOKENS = `
:root {
  --paper: #f6f7f9; --panel: #ffffff; --ink: #18212b; --muted: #5b6672; --rule: #d9dee4;
  --accent: #1f5f8b; --good: #1d7a46; --good-bg: #e6f4ec; --bad: #b3261e; --bad-bg: #fbe9e7;
  --warn: #8a5a00; --warn-bg: #fdf3e1; --info: #1f5f8b; --info-bg: #e8f0f7; --card: #eef3f8;
  --body: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --display: "Avenir Next Condensed", "Arial Narrow", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #11161c; --panel: #171e26; --ink: #e6ebf0; --muted: #9aa6b2; --rule: #2a343f;
  --accent: #7fb6dd; --good: #6fcf97; --good-bg: #13291d; --bad: #ff8a80; --bad-bg: #331917;
  --warn: #f2c063; --warn-bg: #2e2412; --info: #7fb6dd; --info-bg: #15222e; --card: #1c2631; color-scheme: dark; } }
:root[data-theme="dark"] {
  --paper: #11161c; --panel: #171e26; --ink: #e6ebf0; --muted: #9aa6b2; --rule: #2a343f;
  --accent: #7fb6dd; --good: #6fcf97; --good-bg: #13291d; --bad: #ff8a80; --bad-bg: #331917;
  --warn: #f2c063; --warn-bg: #2e2412; --info: #7fb6dd; --info-bg: #15222e; --card: #1c2631; color-scheme: dark; }
`;

export const VIEW_CSS = `
.tv { display: grid; gap: 1rem; min-width: 0; }
.tv-headline { margin: 0; font: 600 clamp(1.15rem, 2.6vw, 1.5rem)/1.3 var(--display); display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; text-wrap: balance; }
.tv-pill { font: 600 0.75rem/1 var(--body); letter-spacing: 0.04em; text-transform: uppercase; padding: 0.3rem 0.5rem; border-radius: 999px; white-space: nowrap; }
.tv-pill.tv-good { background: var(--good-bg); color: var(--good); } .tv-pill.tv-bad, .tv-pill.tv-error { background: var(--bad-bg); color: var(--bad); }
.tv-pill.tv-warn { background: var(--warn-bg); color: var(--warn); } .tv-pill.tv-info { background: var(--info-bg); color: var(--info); }
.tv-headline.tv-bad span:last-child, .tv-headline.tv-error span:last-child { color: var(--bad); }
.tv-banner { margin: 0; font-size: 0.85rem; color: var(--muted); border-left: 3px solid var(--accent); padding-left: 0.6rem; }
.tv-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.6rem; }
.tv-stat { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 0.7rem 0.8rem; display: grid; gap: 0.15rem; min-width: 0; }
.tv-stat-label { font-size: 0.82rem; color: var(--muted); } .tv-stat-value { font: 600 1.15rem/1.2 var(--display); font-variant-numeric: tabular-nums; }
.tv-stat.tv-bad { border-color: var(--bad); background: var(--bad-bg); } .tv-stat.tv-bad .tv-stat-value, .tv-stat.tv-bad .tv-stat-word { color: var(--bad); }
.tv-stat.tv-warn .tv-stat-word { color: var(--warn); } .tv-stat-word { font-size: 0.78rem; font-weight: 600; }
.tv-bullets { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.tv-bullets li { display: grid; grid-template-columns: 1.4rem 1fr; gap: 0.4rem; align-items: start; min-width: 0; }
.tv-mark { font-weight: 700; text-align: center; color: var(--muted); } .tv-mark.tv-good { color: var(--good); } .tv-mark.tv-bad, .tv-mark.tv-error { color: var(--bad); } .tv-mark.tv-warn { color: var(--warn); }
.tv-more > summary { cursor: pointer; } .tv-detail { margin: 0.3rem 0 0; font-size: 0.88rem; color: var(--muted); }
.tv-section { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; }
.tv-section > summary { cursor: pointer; padding: 0.75rem 1rem; font-weight: 600; display: flex; gap: 1rem; justify-content: space-between; list-style: none; }
.tv-section > summary::-webkit-details-marker { display: none; }
.tv-section > summary::after { content: "+"; color: var(--muted); font-weight: 400; } .tv-section[open] > summary::after { content: "–"; }
.tv-hint { margin-left: auto; color: var(--muted); font-weight: 400; font-size: 0.85rem; }
.tv-section-body { padding: 0 1rem 1rem; display: grid; gap: 0.75rem; min-width: 0; }
.tv-table { overflow-x: auto; } .tv-table table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
.tv-table th, .tv-table td { text-align: left; vertical-align: top; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); }
.tv-table th { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
.tv-good { color: var(--good); } .tv-bad, .tv-error { color: var(--bad); } .tv-warn { color: var(--warn); }
.tv-kv { display: grid; grid-template-columns: minmax(8rem, auto) 1fr; gap: 0.35rem 0.9rem; margin: 0; font-size: 0.9rem; } .tv-kv dt { font-weight: 600; } .tv-kv dd { margin: 0; color: var(--muted); }
.tv-code { margin: 0; padding: 0.75rem; background: var(--card); border-radius: 6px; overflow-x: auto; font: 0.8rem/1.45 var(--mono); }
.tv-mono { font-family: var(--mono); font-size: 0.85em; }
.tv-text, .tv-note, .tv-footnote { margin: 0; } .tv-note, .tv-footnote { font-size: 0.8rem; color: var(--muted); }
.tv-next { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.tv-next-btn { font: inherit; padding: 0.45rem 0.8rem; border-radius: 6px; border: 1px solid var(--accent); background: var(--panel); color: var(--accent); cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 640px) {
  .tv-table table, .tv-table thead, .tv-table tbody, .tv-table tr, .tv-table td { display: block; width: 100%; }
  .tv-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .tv-table tr { border: 1px solid var(--rule); border-radius: 6px; margin-bottom: 0.5rem; padding: 0.3rem 0; }
  .tv-table td { border: 0; padding: 0.25rem 0.7rem; display: grid; grid-template-columns: 7rem 1fr; gap: 0.5rem; }
  .tv-table td::before { content: attr(data-label); font-size: 0.78rem; color: var(--muted); font-weight: 600; }
  .tv-kv { grid-template-columns: 1fr; } .tv-kv dd { margin-bottom: 0.4rem; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
