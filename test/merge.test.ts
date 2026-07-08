import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextGraphEngine, confidenceFromObservations } from "../src/index.js";
import { fakeProviders } from "./helpers.ts";

function engine() {
  return new ContextGraphEngine({ dbPath: ":memory:", ...fakeProviders() });
}

async function nodeByName(e: ContextGraphEngine, name: string) {
  const nodes = await e.store.findNodesByName(name.toLowerCase());
  return nodes[0];
}

test("confidence is a pure, saturating function of observations", () => {
  assert.equal(Math.round(confidenceFromObservations(1) * 1000), 600);
  assert.equal(Math.round(confidenceFromObservations(2) * 1000), 680);
  assert.equal(Math.round(confidenceFromObservations(3) * 1000), 744);
  assert.ok(confidenceFromObservations(50) <= 0.99);
  // Monotonic non-decreasing.
  assert.ok(confidenceFromObservations(5) > confidenceFromObservations(4));
});

test("live re-observation reinforces; confidence tracks the count", async () => {
  const e = engine();
  await e.ingest("[[Billing Service]] ==depends_on==> [[Payments Gateway]]", { title: "one" });
  let n = await nodeByName(e, "billing service");
  assert.equal(n.observations, 1);
  assert.equal(Math.round(n.confidence * 1000), 600);

  // A distinct document observing the same entity bumps the counter.
  await e.ingest("[[Billing Service]] charges customers", { title: "two" });
  n = await nodeByName(e, "billing service");
  assert.equal(n.observations, 2);
  assert.equal(Math.round(n.confidence * 1000), 680);
  // Two distinct observation sources are tracked.
  assert.equal(Object.keys(n.observationSources).length, 2);
  await e.close();
});

test("re-importing the same graph file is idempotent (no double-counting)", async () => {
  const source = engine();
  await source.ingest("[[Alpha]] ==relates_to==> [[Beta]]", { title: "doc-a" });
  await source.ingest("[[Alpha]] again", { title: "doc-b" }); // Alpha now observed twice
  const jsonl = await source.exportJsonl();

  const alphaSource = await nodeByName(source, "alpha");
  assert.equal(alphaSource.observations, 2);

  const target = engine();
  const first = await target.importJsonl(jsonl);
  assert.equal(first.nodesCreated, 2); // Alpha, Beta
  const alpha1 = await nodeByName(target, "alpha");
  assert.equal(alpha1.observations, 2);
  const conf1 = alpha1.confidence;

  // Import the exact same file again — must change nothing.
  const second = await target.importJsonl(jsonl);
  assert.equal(second.nodesCreated, 0);
  const alpha2 = await nodeByName(target, "alpha");
  assert.equal(alpha2.observations, 2, "re-import must not inflate observations");
  assert.equal(alpha2.confidence, conf1, "re-import must not inflate confidence");

  const stats = await target.stats();
  assert.equal(stats.nodes, 2);
  assert.equal(stats.edges, 1);
  await source.close();
  await target.close();
});

test("later summaries win by timestamp on merge", async () => {
  const e = engine();
  await e.ingest("[[Widget]] summary", { title: "one" });
  const jsonl = await e.exportJsonl();
  const older = JSON.parse(
    jsonl.split("\n").find((l) => l.includes('"kind":"node"')) as string,
  );
  // Craft an incoming record with a newer summary + timestamp.
  older.summary = "a much longer and newer widget description";
  older.summaryUpdatedAt = "2999-01-01T00:00:00.000Z";
  const target = engine();
  await target.importJsonl(jsonl); // seed original
  await target.importJsonl([JSON.stringify({ kind: "meta", format: 1, embeddingDimensions: 16 }), JSON.stringify({ kind: "node", ...older })].join("\n"));
  const n = await nodeByName(target, "widget");
  assert.equal(n.summary, "a much longer and newer widget description");
  await e.close();
  await target.close();
});
