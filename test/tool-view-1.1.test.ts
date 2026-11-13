// Contract 1.1: a view can say who wrote it and what it cites, and a 1.0 renderer still shows both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  AI_LABEL,
  aiOrDeterministic,
  checkView,
  SOURCES_SECTION_ID,
  type ToolView,
} from "../src/ui/view.js";
import { esc, provenanceLine, renderView, requiredText } from "../src/ui/render.js";
import { renderView as renderView10 } from "./helpers/render-1.0.js";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const VIEWS = resolve("test/views");
const NEG = resolve("test/fixtures/tool-view/negative");
const view = (f: string) => json(join(VIEWS, f)) as ToolView;
const views = readdirSync(VIEWS).map((f) => [f, view(f)] as const);
const machine = () => view("machine-written.json");
const deterministic = () => view("deterministic-provenance.json");

function schema() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(json(resolve("docs/tool-view.schema.json")));
}

/**
 * Each negative breaks one rule: the schema path it must fail on (null when only checkView can
 * express the rule, so the schema must pass it), and the checkView problem it must raise.
 */
const NEGATIVE: Record<string, { schemaPath: string | null; problem: RegExp }> = {
  "ai-no-banner": { schemaPath: "", problem: /banner must start with "Machine-written"/ },
  "ai-banner-without-label": {
    schemaPath: "/banner",
    problem: /banner must start with "Machine-written"/,
  },
  "unknown-mode-no-label": {
    schemaPath: "/banner",
    problem: /banner must start with "Machine-written"/,
  },
  "ai-no-model": { schemaPath: "/provenance", problem: /needs provenance\.model/ },
  "ai-banner-without-model-or-date": {
    schemaPath: null,
    problem: /banner must name provenance\.model/,
  },
  "deterministic-sent-to-model": {
    schemaPath: "/provenance/egress",
    problem: /deterministic view can't have sent its input to a model provider/,
  },
  "bad-base-digest": { schemaPath: "/provenance/baseDigest", problem: /baseDigest must be/ },
  "ai-impossible-date": { schemaPath: null, problem: /provenance\.at must be an ISO date/ },
  "passage-not-in-sources": {
    schemaPath: null,
    problem: /no bullet in the "sources" section that cites it/,
  },
  "ref-unresolved": { schemaPath: null, problem: /which provenance\.passageIds doesn't list/ },
  "refs-without-provenance": {
    schemaPath: null,
    problem: /refs need provenance\.passageIds to resolve against/,
  },
};

test("tool-view schema: every conformance view passes it", () => {
  const validate = schema();
  for (const [f, v] of views)
    assert.equal(validate(v), true, `${f}: ${JSON.stringify(validate.errors)}`);
});

test("tool-view schema: the negative fixtures are exactly the ones listed", () => {
  const files = readdirSync(NEG)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  assert.deepEqual(files.toSorted(), Object.keys(NEGATIVE).toSorted());
});

for (const [id, { schemaPath, problem }] of Object.entries(NEGATIVE)) {
  test(`contract 1.1: negative ${id} fails checkView${schemaPath === null ? " (the schema can't tell)" : ` and the schema at "${schemaPath}"`}`, () => {
    const fx = json(join(NEG, `${id}.json`));
    const problems = checkView(fx);
    assert.ok(
      problems.some((p) => problem.test(p)),
      `${id}: expected ${problem}, got ${JSON.stringify(problems)}`,
    );
    const validate = schema();
    const ok = validate(fx);
    if (schemaPath === null) {
      assert.equal(ok, true, `${id} should pass the schema: ${JSON.stringify(validate.errors)}`);
    } else {
      assert.equal(ok, false, `${id} passed the schema`);
      const paths = (validate.errors ?? []).map((e) => e.instancePath);
      assert.ok(
        paths.includes(schemaPath),
        `${id}: expected an error at "${schemaPath}", got ${JSON.stringify(paths)}`,
      );
    }
  });
}

test("checkView: a machine-written view must carry the label, the model and the date in its banner", () => {
  assert.deepEqual(checkView(machine()), []);
  const v = machine();
  v.banner = "Synthetic data only.";
  assert.ok(checkView(v).some((p) => p.includes(`must start with "${AI_LABEL}"`)));
  // An unknown mode is a model, so it can't skip the label.
  const u = machine();
  (u.provenance as { mode: string }).mode = "agent";
  u.banner = "Synthetic data only.";
  assert.ok(checkView(u).some((p) => p.includes(`must start with "${AI_LABEL}"`)));
  // A deterministic view needs no label.
  assert.deepEqual(checkView(deterministic()), []);
});

test("requiredText: the provenance line, every ref and every cited passage; the renderer shows them", () => {
  const v = machine();
  const req = requiredText(v);
  const line = provenanceLine(v.provenance!);
  assert.ok(req.includes(line), "requiredText lacks the provenance line");
  for (const id of v.provenance!.passageIds)
    assert.ok(req.includes(id), `requiredText lacks ref ${id}`);
  const sources = v.sections!.find((s) => s.id === SOURCES_SECTION_ID)!;
  for (const b of sources.blocks)
    if (b.kind === "bullets")
      for (const i of b.items) assert.ok(req.includes(i.text), `requiredText lacks "${i.text}"`);
  const html = renderView(v);
  for (const t of req) assert.ok(html.includes(esc(t)), `renderView lacks "${t}"`);
  assert.match(html, /class="tv-provenance"/);
  assert.match(html, /class="tv-refs">\[syn-guide@1\.0\.0#req-1\]/);
});

test("provenance line: plain words for who wrote it, the evidence and where the input went", () => {
  assert.equal(
    provenanceLine(machine().provenance!),
    "Machine-written by example-model-1 on 2026-11-12 · prompt explain-v1 · evidence: spec-text · your input went to no one outside the tool · cost US$0.0021",
  );
  assert.equal(
    provenanceLine(deterministic().provenance!),
    "Worked out by the tool; no model wrote it · evidence: validator-output · your input went to no one outside the tool",
  );
  const sent = { ...machine().provenance!, egress: "model-provider" as const, costUsd: undefined };
  assert.match(provenanceLine(sent), /your input was sent to the model's provider$/);
});

test("a 1.0 renderer still shows the machine-written label and every cited passage", () => {
  for (const [f, v] of views) {
    if (!v.provenance || v.provenance.mode === "deterministic") continue;
    const html = renderView10(v);
    assert.ok(v.banner?.startsWith(AI_LABEL), `${f}: the label is not in the banner`);
    assert.ok(html.includes(esc(v.banner)), `${f}: a 1.0 renderer drops the banner`);
    const sources = v.sections?.find((s) => s.id === SOURCES_SECTION_ID);
    assert.ok(sources, `${f}: no sources section`);
    for (const b of sources.blocks)
      if (b.kind === "bullets")
        for (const i of b.items)
          assert.ok(html.includes(esc(i.text)), `${f}: a 1.0 renderer drops "${i.text}"`);
  }
  assert.ok(
    views.some(([, v]) => v.provenance && v.provenance.mode !== "deterministic"),
    "no machine-written conformance view",
  );
});

test("render: hostile refs and provenance come out escaped", () => {
  const evil = `<img src=x onerror=alert(1)>`;
  const v = machine();
  v.bullets![0].refs = [evil];
  v.provenance = { ...v.provenance!, model: evil, evidenceType: evil, promptVersion: evil };
  const html = renderView(v);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /\[&lt;img src=x onerror=alert\(1\)&gt;\]/);
});

test("abstain: a model-written view that fails any check gives back the deterministic result alone", () => {
  const base = deterministic();
  // A valid explanation of this exact result is returned as is.
  const ok = aiOrDeterministic(machine(), base);
  assert.equal(ok.abstained, false);
  assert.deepEqual(ok.view, machine());
  // Key order is not a change: the package writer sorts keys.
  const reordered = machine();
  reordered.stats = reordered.stats!.map(({ label, value, status }) => ({ status, value, label }));
  assert.equal(aiOrDeterministic(reordered, base).abstained, false, "reordered stat keys");
  const cases: [string, (v: ToolView) => unknown, RegExp][] = [
    ["no label", (v) => ({ ...v, banner: undefined }), /banner must start/],
    ["not an object", () => "explanation", /not an object/],
    [
      "no provenance",
      (v) => ({ v: 1, status: v.status, headline: v.headline, stats: v.stats }),
      /no provenance/,
    ],
    [
      "says deterministic",
      (v) => ({ ...v, provenance: { ...v.provenance!, mode: "deterministic" } }),
      /no model wrote it/,
    ],
    [
      "other result",
      (v) => ({ ...v, provenance: { ...v.provenance!, baseDigest: `sha256:${"0".repeat(64)}` } }),
      /different result/,
    ],
    ["changes the status", (v) => ({ ...v, status: "good" }), /changes the status/],
    [
      "changes the headline",
      (v) => ({ ...v, headline: "No rule failed." }),
      /changes the headline/,
    ],
    [
      "changes the stats",
      (v) => ({ ...v, stats: [{ label: "Rules failed", value: "0" }] }),
      /changes the stats/,
    ],
  ];
  for (const [name, change, why] of cases) {
    const r = aiOrDeterministic(change(machine()), base);
    assert.equal(r.abstained, true, name);
    assert.ok(
      r.problems.some((p) => why.test(p)),
      `${name}: ${JSON.stringify(r.problems)}`,
    );
    // The base, untouched: nothing from the candidate is repaired, clamped or merged in.
    assert.equal(r.view, base, name);
    assert.deepEqual(r.view, deterministic(), name);
  }
  // A base that isn't a valid deterministic view is the producer's bug: it throws, it doesn't pick.
  assert.throws(() => aiOrDeterministic(machine(), machine()), /not a valid deterministic view/);
});
