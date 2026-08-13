/**
 * Depth-tier extraction gaps that made whole classes of TypeScript dependency
 * invisible: a JSX component use, a `new Foo()`, an `interface X extends Y`. Each
 * of these is the MOST common way its language feature couples two modules, and each
 * produced no edge at all — so the symbol on the receiving end read as an orphan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractFile } from "../src/graph/extract.js";
import { resolveEdges } from "../src/graph/resolve.js";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { tmpRepo } from "./helpers.js";

/** Every raw edge but containment, which is noise for these assertions. */
function wiring(rel: string, src: string, lang: "typescript" | "tsx") {
  return extractFile(rel, src, lang).rawEdges.filter((e) => e.relation !== "contains");
}

test("a JSX component use is a reference, not a declaration name", () => {
  const edges = wiring(
    "page.tsx",
    'import { Button } from "./button.js";\nexport function Page() {\n  return <Button label="go" />;\n}\n',
    "tsx",
  );
  const ref = edges.find((e) => e.relation === "references");
  assert.ok(ref, `<Button/> must produce a reference edge (got ${JSON.stringify(edges)})`);
  assert.equal(ref!.source, "page.tsx#Page");
  assert.equal(ref!.name, "Button");
  assert.equal(ref!.specifier, "./button.js");
});

test("a JSX component use wires the two files end to end", async () => {
  const root = tmpRepo("extract-jsx-");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "button.tsx"), "export function Button(): null {\n  return null;\n}\n");
  writeFileSync(
    join(root, "src", "page.tsx"),
    'import { Button } from "./button.js";\nexport function Page(): null {\n  return <Button />;\n}\n',
  );
  await buildGraph(root, { reuse: false });
  const graph = readGraph(wiringPath(join(root, "graft")))!;
  assert.ok(
    graph.edges.some(
      (e) =>
        e.source === "src/page.tsx#Page" &&
        e.target === "src/button.tsx#Button" &&
        e.relation === "references",
    ),
    // Without this a React/Next app's component graph is entirely empty: `<Button/>`
    // is not a call_expression, so the reference path was the only one available.
    `Page must reference Button (got ${JSON.stringify(graph.edges)})`,
  );
});

test("`new Foo()` in the same file is a call edge to the class", () => {
  const src = "class Repo {\n  find(): number { return 1; }\n}\nexport function make(): Repo {\n  return new Repo();\n}\n";
  const { nodes, rawEdges } = extractFile("b.ts", src, "typescript");
  const edges = resolveEdges(nodes, rawEdges);
  const call = edges.find((e) => e.relation === "calls" && e.source === "b.ts#make");
  assert.ok(call, "`new Repo()` must produce a call edge — it is not a call_expression");
  assert.equal(call!.target, "b.ts#Repo");
  assert.equal(call!.confidence, "extracted");
});

test("`Foo()` in Python is a call edge to the class it constructs", () => {
  const src = "class Repo:\n    def find(self):\n        return 1\n\n\ndef make():\n    return Repo()\n";
  const { nodes, rawEdges } = extractFile("d.py", src, "python");
  const edges = resolveEdges(nodes, rawEdges);
  const call = edges.find((e) => e.relation === "calls" && e.source === "d.py#make");
  assert.ok(call, "Python's `Repo()` IS the constructor call, so it must resolve to the class");
  assert.equal(call!.target, "d.py#Repo");
});

test("a `new Foo()` on an imported class resolves through the import, not by bare name", () => {
  // The import states which module, so a homonym elsewhere in the repo must not make
  // this ambiguous — bare-name resolution would drop the edge outright.
  const files: Record<string, string> = {
    "src/repo.ts": "export class Repo {\n  find(): number { return 1; }\n}\n",
    "other/repo.ts": "export class Repo {\n  find(): number { return 2; }\n}\n",
    "src/use.ts": 'import { Repo } from "./repo.js";\nexport function make(): Repo {\n  return new Repo();\n}\n',
  };
  const nodes = [], raw = [];
  for (const [rel, src] of Object.entries(files)) {
    const r = extractFile(rel, src, "typescript");
    nodes.push(...r.nodes);
    raw.push(...r.rawEdges);
  }
  const edges = resolveEdges(nodes, raw);
  const calls = edges.filter((e) => e.relation === "calls" && e.source === "src/use.ts#make");
  assert.deepEqual(calls.map((e) => e.target), ["src/repo.ts#Repo"]);
  assert.equal(calls[0].confidence, "extracted", "the import names the file — this is certain, not a guess");
});

test("`interface X extends Y` produces an extends edge, generics and all", () => {
  const src = [
    "interface User { id: number }",
    "interface Repo<T> { get(): T }",
    "export interface AdminUser extends User {}",
    "export interface Both extends User, Repo<User> {}",
    "export class Impl implements Repo<User> {}",
    "",
  ].join("\n");
  const { nodes, rawEdges } = extractFile("a.ts", src, "typescript");
  const heritage = rawEdges
    .filter((e) => e.relation === "extends" || e.relation === "implements")
    .map((e) => `${e.source.split("#")[1]} ${e.relation} ${e.name}`)
    .sort();
  assert.deepEqual(heritage, [
    "AdminUser extends User",
    "Both extends Repo",
    "Both extends User",
    "Impl implements Repo",
  ]);

  // …and they resolve to the interface nodes, so the hierarchy is navigable.
  const edges = resolveEdges(nodes, rawEdges);
  assert.ok(
    edges.some((e) => e.source === "a.ts#AdminUser" && e.target === "a.ts#User" && e.relation === "extends"),
  );
  // `implements Repo<User>` used to drop entirely: `generic_type` matched neither
  // `identifier` nor `type_identifier`, so the whole supertype went missing.
  assert.ok(
    edges.some((e) => e.source === "a.ts#Impl" && e.target === "a.ts#Repo" && e.relation === "implements"),
  );
  // The type ARGUMENT is not a supertype and must never become one.
  assert.ok(!edges.some((e) => e.source === "a.ts#Impl" && e.target === "a.ts#User"));
});

test("`chars` on a file node is BYTES, matching types.ts and the breadth tier", () => {
  // The savings estimate divides this by 4 for a token count and compares nodes from
  // both tiers; generic.ts writes Buffer.byteLength, so UTF-16 code units here made an
  // accented .ts file look smaller than an identical .rs one. ASCII hides it entirely.
  const src = "export const gréé = 'ação';\n";
  const file = extractFile("acc.ts", src, "typescript").nodes.find((n) => n.kind === "file")!;
  assert.equal(file.chars, Buffer.byteLength(src));
  assert.notEqual(file.chars, src.length, "the fixture must actually contain multi-byte characters");
});
