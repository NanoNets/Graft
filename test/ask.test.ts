/**
 * Tests for `graft ask` — specifically the `source` option, which turns the
 * pack from a locator (pointers only) into a retriever (source inlined at each
 * span). The retriever behaviour is what makes ask substitutive: the agent
 * reads the span from the pack instead of opening the file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { ask, formatAsk } from "../src/ask/ask.js";

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-ask-"));
  writeFileSync(
    join(dir, "math.ts"),
    `export function addNumbers(a: number, b: number): number {\n` +
      `  return a + b;\n` +
      `}\n`,
  );
  return dir;
}

test("ask without source returns pointers but no inlined code", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir); // $0, structure-only — cards + wiring.json
    const r = ask(dir, "addNumbers");
    const hit = r.hits.find((h) => h.title.startsWith("addNumbers"));
    assert.ok(hit, "should locate the addNumbers symbol");
    assert.match(hit.pointer, /^math\.ts:L\d+-L\d+$/);
    assert.equal(hit.code, undefined, "no source inlined without the option");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ask finds a symbol by a term that appears only in its body (body-indexing)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-ask-body-"));
  try {
    // "stripe" is nowhere in the name/signature — only inside the body.
    writeFileSync(
      join(dir, "pay.ts"),
      `export function checkout(amount: number): string {\n` +
        `  const token = createStripeCharge(amount);\n` +
        `  return token;\n` +
        `}\n`,
    );
    await buildGraph(dir);
    const r = ask(dir, "stripe");
    const hit = r.hits.find((h) => h.title.startsWith("checkout"));
    assert.ok(hit, "checkout is findable via a term that only appears in its body");
    assert.match(hit.pointer, /^pay\.ts:L\d+-L\d+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ask surfaces a file by a term only in its module-level code (file-body indexing)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-ask-file-"));
  try {
    // "telemetry" appears only in a module-level constant — inside no function
    // or class — so only file-level residual indexing can make it findable.
    writeFileSync(
      join(dir, "settings.ts"),
      `export const FEATURE_FLAG_TELEMETRY = false;\n\n` +
        `export function init(): number {\n  return 1;\n}\n`,
    );
    await buildGraph(dir);
    const r = ask(dir, "telemetry");
    const hit = r.hits.find((h) => h.pointer === "settings.ts");
    assert.ok(hit, "the file surfaces via a term that lives only in module-level code");
    assert.ok(hit.title.endsWith("· file"), "it is the file node, pointed at the whole file (no span)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ask indexes a symbol past the 32KB tree-sitter boundary (chunked parse)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-ask-big-"));
  try {
    // Build a >32KB Python file with the distinctive symbol AFTER the 32KB mark,
    // so it is only reachable if the whole file parsed (string parse caps at 32KB).
    let body = "";
    for (let i = 0; body.length < 40000; i++) body += `def filler_${i}():\n    return ${i}\n\n`;
    body += `def zzz_needle_marker():\n    return "found"\n`;
    assert.ok(body.length > 32768, "fixture must exceed the 32KB parse limit");
    writeFileSync(join(dir, "big.py"), body);
    await buildGraph(dir);
    const r = ask(dir, "zzz_needle_marker");
    assert.ok(
      r.hits.find((h) => h.title.startsWith("zzz_needle_marker")),
      "a symbol defined past the 32KB boundary is indexed and findable",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ask with source inlines the actual span from disk", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const r = ask(dir, "addNumbers", { source: true });
    const hit = r.hits.find((h) => h.title.startsWith("addNumbers"));
    assert.ok(hit, "should locate the addNumbers symbol");
    assert.ok(hit.code, "source should be inlined");
    assert.match(hit.code, /return a \+ b;/, "inlined code is the real definition body");
    // formatAsk renders it as a fenced block so it drops into agent context.
    assert.match(formatAsk(r), /```[\s\S]*return a \+ b;[\s\S]*```/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
