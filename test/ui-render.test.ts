import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { renderView, requiredText, esc } from "../src/ui/render.js";
import { renderForm, formToArgs, widgetFor, argsSummary } from "../src/ui/form.js";
import { checkView, type ToolView } from "../src/ui/view.js";
import { inspectorCommand, shellQuote } from "../src/ui/inspector.js";

const views = readdirSync("test/views").map(
  (f) => [f, JSON.parse(readFileSync(`test/views/${f}`, "utf8")) as ToolView] as const,
);

test("render: every conformance view shows all its required text", () => {
  for (const [f, v] of views) {
    const html = renderView(v);
    for (const t of requiredText(v)) assert.ok(html.includes(esc(t)), `${f}: missing "${t}"`);
    assert.match(html, /role="status"/, `${f}: headline isn't announced`);
  }
});

test("render: status is shown in words, not colour alone", () => {
  const html = renderView(views.find(([f]) => f === "default.json")![1]);
  assert.match(html, /Problem<\/span>/);
});

test("render: hostile tool output comes out escaped", () => {
  const evil = `<img src=x onerror=alert(1)>"'&`;
  const v: ToolView = {
    v: 1,
    status: "bad",
    headline: evil,
    banner: evil,
    stats: [{ label: evil, value: evil }],
    bullets: [{ text: evil, detail: evil }],
    sections: [
      {
        id: `x"><script>`,
        title: evil,
        blocks: [
          {
            kind: "table",
            columns: [{ key: "a", label: evil }],
            rows: [{ a: { text: evil, status: "bad" } }],
          },
          { kind: "kv", items: [{ label: evil, value: evil }] },
          { kind: "code", lang: "text", text: evil },
          { kind: "text", text: evil },
          { kind: "surprise", evil } as any,
        ],
      },
    ],
    next: [{ label: evil, patch: { x: evil } }],
    footnote: evil,
  };
  const html = renderView(v, { withNext: true });
  // Escaped text may still contain the word "onerror"; what must never appear is a live tag.
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("render: unknown block kinds are shown, not dropped; sections start collapsed", () => {
  const html = renderView({
    v: 1,
    status: "info",
    headline: "h",
    sections: [{ id: "s", title: "S", blocks: [{ kind: "chart", series: [1, 2] } as any] }],
  });
  assert.match(html, /&quot;chart&quot;/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test("render: tables carry data-label for phone cards", () => {
  const html = renderView(views[0][1]);
  assert.match(html, /<td data-label="Test">/);
});

// A real tool's inputSchema, saved as listed by member-match-decoy-lab's score_member_match
// (see PROVENANCE.md). That repo also checks its live schema against this form.
const schema = JSON.parse(readFileSync("test/schemas/score-member-match.input.json", "utf8"));

test("form: picks the right widget for each input and labels every one", () => {
  assert.equal(widgetFor(schema.properties.matchers).kind, "chips");
  assert.equal(widgetFor(schema.properties.cases).kind, "chips");
  assert.equal(widgetFor(schema.properties.relaxed_confidence).kind, "range");
  assert.equal(widgetFor(schema.properties.detail).kind, "select");
  const html = renderForm(schema, {}, ["relaxed_confidence", "detail"]);
  for (const [k, s] of Object.entries<any>(schema.properties))
    assert.ok(html.includes(esc(s.title)), `${k} label`);
  assert.match(html, /Identity matcher, strict/);
  assert.match(html, /John&#39;s demographics, Jon&#39;s card/);
  assert.match(html, /<details class="f-advanced"><summary>More settings<\/summary>/);
  // every input has a label pointing at it
  for (const m of html.matchAll(/<(input|select|textarea)[^>]*id="([^"]+)"/g)) {
    if (m[2].endsWith("-slider")) continue; // the slider is labelled by aria-label
    assert.ok(html.includes(`for="${m[2]}"`), `no label for ${m[2]}`);
  }
});

test("form: entries become tool arguments; blanks fall back to defaults; bad values explained", () => {
  assert.deepEqual(
    formToArgs(schema, [
      ["cases", "D4-card-mixup"],
      ["relaxed_confidence", "90"],
      ["detail", ""],
    ]).args,
    { cases: ["D4-card-mixup"], relaxed_confidence: 90 },
  );
  assert.deepEqual(formToArgs(schema, []).args, {});
  assert.deepEqual(formToArgs(schema, [["relaxed_confidence", "50"]]).problems, [
    "Relaxed matcher confidence (%): choose from 75 to 100",
  ]);
  assert.deepEqual(formToArgs(schema, [["relaxed_confidence", "88.5"]]).problems, [
    "Relaxed matcher confidence (%): enter a whole number",
  ]);
  const paste = { type: "object", properties: { bundle: { type: "object", title: "PAS Bundle" } } };
  assert.deepEqual(formToArgs(paste, [["bundle", "{oops"]]).problems, [
    "PAS Bundle: this isn't valid JSON",
  ]);
});

test("form: the one-line settings summary uses plain names", () => {
  assert.equal(argsSummary(schema, {}), "Default settings");
  assert.equal(
    argsSummary(schema, { cases: ["D4-card-mixup"], relaxed_confidence: 90 }),
    "Test requests to run: John's demographics, Jon's card · Relaxed matcher confidence (%): 90",
  );
});

test("form: schema bounds that aren't numbers can't inject HTML", () => {
  const hostile = { type: "integer", minimum: '0" onfocus="alert(1)', maximum: 9 } as any;
  assert.equal(widgetFor(hostile).kind, "number");
  const html = renderForm({ type: "object", properties: { n: hostile } } as any, {});
  assert.doesNotMatch(html, /onfocus/);
  assert.equal(widgetFor({ type: "number", minimum: 0, maximum: Infinity } as any).kind, "number");
});

test("render: a status that isn't one of the five can't inject HTML anywhere", () => {
  const bad = '"><img src=x onerror=alert(1)>' as any;
  const v = {
    v: 1,
    status: "bad",
    headline: "h",
    stats: [{ label: "s", value: "1", status: bad }],
    bullets: [{ text: "b", status: bad }],
    sections: [
      {
        id: "t",
        title: "T",
        blocks: [
          {
            kind: "table",
            columns: [{ key: "a", label: "A" }],
            rows: [{ a: { text: "x", status: bad } }],
          },
        ],
      },
    ],
  } as ToolView;
  assert.doesNotMatch(renderView(v), /onerror|<img/);
  const problems = checkView(v).join("\n");
  assert.match(problems, /rows\[0\]\.a: status must be one of/);
  assert.match(problems, /stats\[0\]: status/);
  assert.match(problems, /bullets\[0\]: status/);
});

test("form: an unticked yes/no sends false; a tool whose default is false is left to it", () => {
  const sch = {
    type: "object",
    properties: {
      strict: { type: "boolean", title: "Strict" },
      quiet: { type: "boolean", title: "Quiet", default: false },
      verbose: { type: "boolean", title: "Verbose", default: true },
    },
  };
  assert.deepEqual(formToArgs(sch, []).args, { strict: false, verbose: false });
  assert.deepEqual(
    formToArgs(sch, [
      ["strict", "true"],
      ["quiet", "true"],
    ]).args,
    {
      strict: true,
      quiet: true,
      verbose: false,
    },
  );
  // A default-true switch is drawn ticked, so leaving it alone still means "yes".
  assert.match(renderForm(sch, {}), /id="f-verbose"[^>]*checked/);
  assert.doesNotMatch(renderForm(sch, {}), /id="f-strict"[^>]*checked/);
});

test("form: number and boolean choices come back as numbers and booleans", () => {
  const sch = {
    type: "object",
    properties: {
      level: { enum: [1, 2, 3] },
      exact: {
        oneOf: [
          { const: true, title: "Yes" },
          { const: false, title: "No" },
        ],
      },
      sizes: { type: "array", items: { enum: [10, 20] } },
      mode: { enum: ["a", "b"] },
    },
  };
  assert.deepEqual(
    formToArgs(sch, [
      ["level", "2"],
      ["exact", "false"],
      ["sizes", "10"],
      ["sizes", "20"],
      ["mode", "b"],
    ]).args,
    { level: 2, exact: false, sizes: [10, 20], mode: "b" },
  );
});

test("checkView: stats, sections or next that aren't lists are problems, not crashes", () => {
  const base = { v: 1, status: "good", headline: "h" };
  for (const field of ["stats", "sections", "next"]) {
    for (const bad of [{ a: 1 }, "text", 7, true]) {
      let problems: string[] = [];
      assert.doesNotThrow(() => (problems = checkView({ ...base, [field]: bad })), field);
      assert.deepEqual(problems, [`${field} must be a list`]);
    }
  }
  assert.deepEqual(checkView({ ...base, stats: [], sections: [], next: [] }), []);
});

test("inspector command: starts from the server's own folder", () => {
  const cmd = inspectorCommand(
    { command: "node", args: ["dist/mcp.js"], cwd: "/work/tools" },
    "echo",
    { text: "hi" },
  );
  assert.equal(
    cmd,
    `cd /work/tools && npx @modelcontextprotocol/inspector --cli node dist/mcp.js --method tools/call --tool-name echo --tool-arg 'text="hi"'`,
  );
  assert.match(inspectorCommand(undefined, "echo", {}), /--cli <server command> --method/);
});

test("inspector command: every word is shell-quoted", () => {
  assert.equal(shellQuote("plain-word_1.js"), "plain-word_1.js");
  assert.equal(shellQuote("two words"), "'two words'");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  assert.equal(shellQuote("$(rm -rf ~); `x` & y"), "'$(rm -rf ~); `x` & y'");
  const cmd = inspectorCommand(
    { command: "node", args: ["my server.js", "--name", "O'Brien; echo hi"], cwd: "/a b/c" },
    "t",
    { q: "it's $HOME" },
  );
  assert.equal(
    cmd,
    `cd '/a b/c' && npx @modelcontextprotocol/inspector --cli node 'my server.js' --name 'O'\\''Brien; echo hi' --method tools/call --tool-name t --tool-arg 'q="it'\\''s $HOME"'`,
  );
});

test('form: choices that read the same as text (1 and "1") still come back as picked', () => {
  const sch = {
    type: "object",
    properties: {
      pick: {
        oneOf: [
          { const: 1, title: "Number" },
          { const: "1", title: "Text" },
        ],
      },
      many: { type: "array", items: { enum: [2, "2"] } },
    },
  };
  const html = renderForm(sch, { pick: "1", many: [2, "2"] });
  const values = [
    ...html.matchAll(/<option value="([^"]*)"|<input type="checkbox"[^>]*value="([^"]*)"/g),
  ].map((m) => m[1] ?? m[2]);
  values.splice(values.indexOf(""), 1); // the select's "Default" option
  assert.equal(new Set(values).size, 4, "every option has its own value");
  // The page posts each option's value; decoding gives back exactly what was picked.
  const post = (pick: string, ...many: string[]) =>
    formToArgs(sch, [["pick", pick], ...many.map((m) => ["many", m] as [string, string])]).args;
  const [numberValue, textValue] = values;
  assert.deepEqual(post(numberValue).pick, 1);
  assert.deepEqual(post(textValue).pick, "1");
  assert.deepEqual(post("x", values[2], values[3]).many, [2, "2"]);
  // Shown back as the settings summary and as the pre-selected option.
  assert.match(html, new RegExp(`<option value="${textValue}" selected>Text`));
  assert.equal(argsSummary(sch, { pick: "1" }), "pick: Text");
});

test("form: an encoded choice never takes the place of a real text choice", () => {
  const sch = { type: "object", properties: { pick: { enum: [1, "1", "json:1"] } } };
  const html = renderForm(sch, {});
  const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(values).size, 3);
  const pick = (v: string) => formToArgs(sch, [["pick", v]]).args.pick;
  assert.deepEqual(
    values.map(pick),
    [1, "1", "json:1"],
    "each option decodes to the value it stands for",
  );
});
