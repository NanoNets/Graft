import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextGraphEngine } from "../src/index.js";
import { fakeProviders } from "./helpers.ts";

function engine() {
  return new ContextGraphEngine({ dbPath: ":memory:", ...fakeProviders() });
}

async function names(e: ContextGraphEngine): Promise<string[]> {
  return (await e.store.allNodes()).map((n) => n.name).sort();
}

test("two machines converge to the same graph after cross-import (Mode A)", async () => {
  // Alice and Bob each learn different facts about a shared entity.
  const alice = engine();
  const bob = engine();
  await alice.ingest("[[Auth Service]] ==uses==> [[OAuth]]", { title: "alice" });
  await bob.ingest("[[Auth Service]] ==rotates==> [[Tokens]]", { title: "bob" });

  const aliceFile = await alice.exportJsonl();
  const bobFile = await bob.exportJsonl();

  // Exchange files.
  await alice.importJsonl(bobFile);
  await bob.importJsonl(aliceFile);

  // Both now know all three entities and both edges.
  const expected = ["Auth Service", "OAuth", "Tokens"].sort();
  assert.deepEqual(await names(alice), expected);
  assert.deepEqual(await names(bob), expected);

  const aStats = await alice.stats();
  const bStats = await bob.stats();
  assert.equal(aStats.nodes, bStats.nodes);
  assert.equal(aStats.edges, bStats.edges);
  assert.equal(aStats.edges, 2);

  // "Auth Service" was observed once on each machine → 2 distinct sources.
  const aAuth = (await alice.store.findNodesByName("auth service"))[0];
  assert.equal(aAuth.observations, 2, "shared entity sums both machines' observations");
  await alice.close();
  await bob.close();
});

test("import order does not change the result (commutativity)", async () => {
  const a = engine();
  const b = engine();
  await a.ingest("[[X]] ==r==> [[Y]]", { title: "a" });
  await b.ingest("[[Y]] ==r==> [[Z]]", { title: "b" });
  const af = await a.exportJsonl();
  const bf = await b.exportJsonl();

  const left = engine();
  await left.importJsonl(af);
  await left.importJsonl(bf);

  const right = engine();
  await right.importJsonl(bf);
  await right.importJsonl(af);

  assert.deepEqual(await names(left), await names(right));
  const ls = await left.stats();
  const rs = await right.stats();
  assert.deepEqual([ls.nodes, ls.edges], [rs.nodes, rs.edges]);
  await a.close();
  await b.close();
  await left.close();
  await right.close();
});
