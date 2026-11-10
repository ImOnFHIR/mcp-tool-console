// The console page's own browser code, driven inside happy-dom (test/helpers/dom-page.ts).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openConsole, type FakeServer } from "./helpers/dom-page.js";

const free = { "com.imonfhir/cost": { free: true } };
const ro = { readOnlyHint: true };
const view = (headline: string) => ({
  ms: 5,
  result: { _meta: { "com.imonfhir/view": { v: 1, status: "good", headline } } },
});
const schema = { type: "object", properties: { text: { type: "string", title: "Text" } } };

const servers = (): FakeServer[] => [
  {
    id: "s1",
    label: "Server one",
    status: "ready",
    error: null,
    command: "node",
    args: ["dist/my server.js", "--name", "O'Brien"],
    cwd: "/work/my repo",
    tools: [
      {
        name: "alpha",
        title: "Alpha",
        inputSchema: schema,
        annotations: ro,
        _meta: {
          ...free,
          "com.imonfhir/presets": [
            { label: "Try one", args: { text: "one" } },
            { label: "Try two", args: { text: "two" } },
          ],
        },
      },
      { name: "beta", title: "Beta", inputSchema: schema, annotations: ro, _meta: free },
      {
        name: "paid",
        title: "Paid",
        inputSchema: schema,
        annotations: ro,
        _meta: {
          "com.imonfhir/cost": { free: false },
          "com.imonfhir/presets": [{ label: "Try it", args: { text: "p" } }],
        },
      },
    ],
  },
];

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

// A failing test must not leave a page's timers running (they would keep the test process alive).
const open: ReturnType<typeof openConsole>[] = [];
afterEach(() => {
  for (const p of open.splice(0)) p.close();
});

async function opened(hash: string, onCall?: Parameters<typeof openConsole>[0]["onCall"]) {
  const p = openConsole({ servers: servers(), onCall });
  open.push(p);
  await p.until(() => p.q(".c-cards") !== null, "the home page"); // the token is read, then the route is free
  await p.go(hash);
  await p.until(() => p.q("#run-form") !== null, "the tool page");
  return p;
}

test("console page: opens a tool page against the fake API", async () => {
  const p = await opened("#/s1/alpha");
  assert.match(p.q("h1").textContent, /Alpha/);
  assert.equal(p.all("[data-preset]").length, 2);
});

test("console page: a preset click adds no listeners; each click is one run", async () => {
  const p = await opened("#/s1/alpha", () => view("done"));
  for (let n = 1; n <= 3; n++) {
    p.click('[data-preset="0"]');
    await p.until(() => p.callsTo("/api/call").length === n, `run ${n}`);
    await p.idle();
  }
  assert.equal(p.callsTo("/api/call").length, 3);
  for (const b of p.all("[data-preset]")) assert.equal(p.listeners(b, "click"), 1, "preset button");
  assert.equal(p.listeners(p.q("#run-form"), "submit"), 1, "form submit");
  assert.equal(p.listeners(p.q("#cancel-btn"), "click"), 1, "cancel button");
});

test("console page: a result never lands in another tool's page", async () => {
  const gate = deferred<unknown>();
  const p = await opened("#/s1/alpha", () => gate.promise);
  p.submit();
  await p.until(() => p.callsTo("/api/call").length === 1, "the call to start");
  await p.go("#/s1/beta");
  await p.until(() => /Beta/.test(p.q("h1").textContent), "beta's page");
  gate.resolve(view("alpha finished"));
  await p.idle();
  assert.equal(p.q("#result").innerHTML, "", "beta's result area stays empty");
  assert.doesNotMatch(p.q("#history").textContent, /alpha finished/);
  assert.equal(p.q("#run-form").hidden, false, "beta's form stays open");
  // Going back to alpha shows the run that finished while away.
  await p.go("#/s1/alpha");
  await p.until(() => /Alpha/.test(p.q("h1").textContent), "alpha's page");
  assert.match(p.q("#result").textContent, /alpha finished/);
});

test("console page: filling a preset leaves the cost tick as it was", async () => {
  const p = await opened("#/s1/paid", () => view("done"));
  p.q("#confirm-cost").checked = true;
  p.click('[data-preset="0"]');
  await p.until(() => p.callsTo("/api/call").length === 1, "the first run");
  await p.idle();
  assert.equal(p.callsTo("/api/call")[0].body.confirmCost, true, "a ticked box stays ticked");
  // The run used the tick, so the next preset click starts unticked and says so.
  p.click('[data-preset="0"]');
  await p.until(() => p.callsTo("/api/call").length === 2, "the second run");
  assert.equal(p.callsTo("/api/call")[1].body.confirmCost, false, "an unticked box stays unticked");
});

test("console page: [hidden] wins over display: grid and flex", async () => {
  const p = await opened("#/s1/alpha", () => view("done"));
  // Before any run there is nothing to summarise, so the settings line is not on screen.
  assert.equal(p.q("#settings-line").hidden, true);
  assert.equal(p.display("#settings-line"), "none", "settings line before a run");
  p.submit();
  await p.until(() => /done/.test(p.q("#result").textContent), "the result");
  assert.equal(p.q("#run-form").hidden, true);
  assert.equal(p.display("#run-form"), "none", "the form folds away after a run");
  assert.notEqual(p.display("#settings-line"), "none", "the settings line shows after a run");
  p.click("#change-btn");
  assert.notEqual(p.display("#run-form"), "none", "Change opens the form again");
  assert.equal(p.display("#settings-line"), "none", "and the line folds away");
});

test("console page: after a server stops, the next run shows its Restart button", async () => {
  const p = await opened("#/s1/alpha", () => {
    // The server dies during this call.
    p.state.servers[0].status = "stopped";
    p.state.servers[0].error = "The server stopped.";
    return { ms: 1, failure: "Connection closed" };
  });
  assert.equal(p.q("[data-restart]"), null, "no Restart while it runs");
  p.submit();
  await p.until(() => p.q("[data-restart]") !== null, "the Restart button");
  assert.equal(p.q("[data-restart]").dataset.restart, "s1");
  assert.match(p.q("#nav").textContent, /The server stopped\./);
  // The page still works on the refreshed list: a preset fills and runs.
  p.state.servers[0].status = "ready";
  p.click('[data-preset="1"]');
  await p.until(() => p.callsTo("/api/call").length === 2, "a run after the refresh");
});

test("console page: the Inspector command starts in the server's folder and is quoted", async () => {
  const p = await opened("#/s1/alpha", () => view("done"));
  p.q("#f-text").value = "it's";
  p.submit();
  await p.until(() => /done/.test(p.q("#result").textContent), "the result");
  p.click("#tech-btn");
  await p.until(() => p.q("#drawer").hidden === false, "the drawer");
  const cmd = p.q('[data-body="4"]').textContent;
  assert.equal(
    cmd,
    `cd '/work/my repo' && npx @modelcontextprotocol/inspector --cli node 'dist/my server.js' --name 'O'\\''Brien' --method tools/call --tool-name alpha --tool-arg 'text="it'\\''s"'`,
  );
});

test("console page: a Try click on a folded page unfolds the form to show progress and problems", async () => {
  const gate = deferred<unknown>();
  let n = 0;
  const p = await opened("#/s1/paid", () => (++n === 1 ? view("first") : gate.promise));
  p.q("#confirm-cost").checked = true;
  p.submit();
  await p.until(() => /first/.test(p.q("#result").textContent), "the first result");
  assert.equal(p.display("#run-form"), "none", "folded after a run");
  p.click('[data-preset="0"]');
  await p.until(() => p.callsTo("/api/call").length === 2, "the second run to start");
  assert.notEqual(p.display("#run-form"), "none", "the form is open while it runs");
  assert.equal(p.display("#settings-line"), "none");
  assert.match(p.q("#run-status").textContent, /Running/);
  assert.equal(p.q("#cancel-btn").hidden, false, "Cancel is in view");
  gate.resolve(view("second"));
  await p.until(() => /second/.test(p.q("#result").textContent), "the second result");
  assert.equal(p.display("#run-form"), "none", "folded again once the result is in");
});
