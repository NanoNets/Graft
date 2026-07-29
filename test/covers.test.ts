/**
 * Tests for `covers:` — the backlink written onto concept nodes from the wiring
 * graph. After a wiring build, each concept node's frontmatter should list the
 * symbols (with `path:span`) in the files it cites, and re-runs stay stable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";
import { buildContext } from "../src/context/build.js";
import { buildGraph } from "../src/graph/build.js";
import { fakeProviders } from "./helpers.js";

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-covers-"));
  writeFileSync(
    join(dir, "auth.ts"),
    `// [[Auth Service]] ==depends_on==> [[Token Store]]\n` +
      `export function login(user: string): boolean {\n  return user.length > 0;\n}\n`,
  );
  return dir;
}

test("wiring build backfills covers: onto concept nodes", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, { model: "fake", ...fakeProviders() });
    await buildGraph(dir); // $0, no LLM — still writes cards + covers

    const fm = matter(readFileSync(join(dir, "graft", "auth-service.md"), "utf8")).data;
    assert.ok(Array.isArray(fm.covers), "covers should be an array");
    const login = fm.covers.find((c: { symbol: string }) => c.symbol === "login");
    assert.ok(login, "covers should include the login function");
    assert.equal(login.kind, "function");
    assert.match(login.at, /^auth\.ts:L\d+-L\d+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("patching covers preserves the node's body and other frontmatter", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, { model: "fake", ...fakeProviders() });
    const path = join(dir, "graft", "auth-service.md");
    const before = matter(readFileSync(path, "utf8"));
    await buildGraph(dir);
    const after = matter(readFileSync(path, "utf8"));

    // Body (Summary + Related + human notes) is untouched.
    assert.equal(after.content, before.content);
    // Existing frontmatter survives; only covers is added.
    assert.equal(after.data.slug, before.data.slug);
    assert.deepEqual(after.data.sources, before.data.sources);
    assert.deepEqual(after.data.links, before.data.links);
    assert.ok("covers" in after.data && !("covers" in before.data));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-running the wiring build leaves covers byte-stable", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, { model: "fake", ...fakeProviders() });
    await buildGraph(dir);
    const first = readFileSync(join(dir, "graft", "auth-service.md"), "utf8");
    await buildGraph(dir);
    const second = readFileSync(join(dir, "graft", "auth-service.md"), "utf8");
    assert.equal(second, first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Concept nodes are the one thing under `graft/` a human writes by hand, and a
 * rebuild now runs before every *query* rather than only on an explicit build. So
 * the projection has to leave alone anything it isn't actually changing, and refuse
 * to touch what it can't round-trip.
 */
test("a rebuild leaves untouched concept nodes and INDEX.md alone", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, { model: "fake", ...fakeProviders() });
    await buildGraph(dir);

    const node = join(dir, "graft", "auth-service.md");
    const index = join(dir, "graft", "INDEX.md");
    const before = { node: statSync(node).mtimeMs, index: statSync(index).mtimeMs };

    // Nothing about the repo changed, so nothing under graft/ should be rewritten:
    // every rewrite wakes editors and file watchers, once per query.
    await new Promise((r) => setTimeout(r, 12)); // let the clock move
    await buildGraph(dir);

    assert.equal(statSync(node).mtimeMs, before.node, "concept node was rewritten with identical bytes");
    assert.equal(statSync(index).mtimeMs, before.index, "INDEX.md was rewritten with identical bytes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a concept node whose frontmatter does not parse is reported, not overwritten", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, { model: "fake", ...fakeProviders() });
    await buildGraph(dir);

    // Frontmatter delimiters, but YAML that yields no keys. gray-matter reports that
    // by handing back zero data and folding the whole block into the content, so
    // re-stringifying would stack a SECOND `---` block on top of the author's text.
    const broken = join(dir, "graft", "hand-written.md");
    const raw = "---\nname: [unclosed\n  bad: : :\n---\n\nSome prose I wrote myself.\n";
    writeFileSync(broken, raw);

    const built = await buildGraph(dir);

    assert.equal(readFileSync(broken, "utf8"), raw, "the author's file must come back byte-identical");
    assert.ok(
      built.errors.some((e) => e.startsWith("hand-written.md:") && /did not parse/.test(e)),
      `and the skip must be reported: ${JSON.stringify(built.errors)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
