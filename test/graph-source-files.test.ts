/**
 * Which files a build parses — specifically, that excluding the output directory does
 * not also exclude its neighbours.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listSourceFiles } from "../src/graph/source-files.js";
import { buildGraph } from "../src/graph/build.js";
import { checkGraph } from "../src/graph/check.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { tmpRepo } from "./helpers.js";

/**
 * `!f.startsWith(outDir)` has no segment boundary, so with the default outDir
 * `<root>/graft` it also swallowed `graft-tools/`, `graftlib/`, `graft.config.ts` —
 * silently, with no error and no warning. `util/paths.ts#pathUnderPrefix` documents
 * exactly this class of bug ("'frontend' would match 'frontend-utils'") and fixes it
 * there; it had simply never reached here.
 */
test("the output dir is excluded, but not a sibling whose name merely starts with it", () => {
  const root = resolve("/repo");
  const outDir = join(root, "graft");
  const files = [
    join(outDir, "wiring.ts"),
    join(root, "graft-tools", "a.ts"),
    join(root, "graftlib", "b.ts"),
    join(root, "src", "c.ts"),
  ];
  assert.deepEqual(listSourceFiles(root, outDir, files), [
    join(root, "graft-tools", "a.ts"),
    join(root, "graftlib", "b.ts"),
    join(root, "src", "c.ts"),
  ]);
});

test("a relative outDir still excludes the output dir, and only it", () => {
  // `contextDirFor` resolves its override now, but this stays the defence in depth
  // for the value arriving relative anyway (a direct library caller, a future path
  // that skips contextDirFor): compared unresolved against the walker's absolute
  // paths it never matches, and the output directory becomes part of the source set.
  const root = process.cwd();
  const files = [join(root, "graft", "wiring.ts"), join(root, "graft-tools", "a.ts")];
  assert.deepEqual(listSourceFiles(root, "graft", files), [join(root, "graft-tools", "a.ts")]);
});

/**
 * `-e/--extensions` says "only include these code extensions". It reached the concept
 * pass only, so the wiring graph — the thing every query actually answers from — kept
 * indexing every language graft has a grammar for, and a user who narrowed a build to
 * `.ts` still got Python nodes back from `ask`/`grep`/`callers`.
 */
test("-e narrows the file set, normalizing a bare/upper-case extension", () => {
  const root = resolve("/repo");
  const outDir = join(root, "graft");
  const files = [join(root, "a.ts"), join(root, "b.py"), join(root, "c.rs")];
  assert.deepEqual(listSourceFiles(root, outDir, files, [".ts"]), [join(root, "a.ts")]);
  assert.deepEqual(listSourceFiles(root, outDir, files, ["py", ".RS"]).sort(), [
    join(root, "b.py"),
    join(root, "c.rs"),
  ].sort());
  // Absent and empty both mean "everything": commander hands `[]` for a variadic
  // option nobody passed, and reading that as "index nothing" would turn a missing
  // flag into an empty graph.
  assert.equal(listSourceFiles(root, outDir, files, []).length, 3);
  assert.equal(listSourceFiles(root, outDir, files).length, 3);
});

test("a build under -e indexes only those extensions, and a check under the same -e sees no drift", async () => {
  const d = tmpRepo("sourcefiles-ext-");
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "app.ts"), "export function fromTs(): number {\n  return 1;\n}\n");
  writeFileSync(join(d, "src", "app.py"), "def from_py():\n    return 2\n");

  await buildGraph(d, { reuse: false, extensions: [".ts"] });
  const graph = readGraph(wiringPath(join(d, "graft")))!;
  assert.ok(graph.nodes.some((n) => n.id === "src/app.ts#fromTs"), "the named extension is indexed");
  assert.ok(!graph.nodes.some((n) => n.path.endsWith(".py")), "and nothing else is");

  // The two halves have to agree: a check that enumerated every language would find
  // the .py definitions missing from the committed graph and report them as `added`
  // — permanent phantom drift on a build the user narrowed deliberately.
  const narrowed = await checkGraph(d, { extensions: [".ts"] });
  assert.equal(narrowed.ok, true, JSON.stringify(narrowed));
  const wide = await checkGraph(d);
  assert.ok(wide.added.some((id) => id.startsWith("src/app.py")), "…and without the flag the drift is real");
});

test("a directory next to the output dir is really indexed by a build", async () => {
  const d = tmpRepo("sourcefiles-sibling-");
  mkdirSync(join(d, "graft-tools"), { recursive: true });
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "graft-tools", "gen.ts"), "export function fromSibling(): number {\n  return 1;\n}\n");
  writeFileSync(join(d, "src", "app.ts"), "export function fromSrc(): number {\n  return 2;\n}\n");

  await buildGraph(d, { reuse: false });
  const graph = readGraph(wiringPath(join(d, "graft")))!;
  assert.ok(
    graph.nodes.some((n) => n.id === "graft-tools/gen.ts#fromSibling"),
    "a sibling of the output dir must be indexed like any other directory",
  );
  assert.ok(!graph.nodes.some((n) => n.path.startsWith("graft/")), "the output dir itself is still excluded");
});
