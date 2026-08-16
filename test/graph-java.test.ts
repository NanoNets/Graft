/**
 * Tests for Java extraction in the Tier-1 code graph. Builds a small Java source
 * tree in a temp dir and asserts the emitted nodes (classes, interfaces, enums,
 * records, methods, constructors) and edges (calls, heritage, package imports)
 * match the AST walk in extract.ts.
 *
 * Three of these pin decisions that are Java-specific and easy to regress, because
 * each one is invisible to the other languages' fixtures:
 *
 *   - `method_invocation` has NO `function` field (it splits the callee into
 *     `object` + `name`), unlike every other grammar graft parses.
 *   - Java has no free functions, so an implicit-`this` call (`decorate(x)`) is a
 *     METHOD call. Resolved against the function index it would vanish — and it is
 *     the most common intra-class edge there is.
 *   - `new Foo()` targets a TYPE, so a constructor call resolved against the
 *     function index would vanish too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const PKG = "src/main/java/com/acme";

const GREETER = `package com.acme;

public interface Greeter {
  String greet(String name);
}
`;

const BASE = `package com.acme;

public abstract class Base {
  protected void audit(String event) {}
}
`;

const POINT = `package com.acme;

public record Point(int x, int y) {}
`;

const COLOR = `package com.acme;

public enum Color {
  RED,
  GREEN
}
`;

const STORE = `package com.acme;

public final class Store {
  public void save(Point point) {}
}
`;

const APP = `package com.acme;

import com.acme.Store;
import java.util.List;

public final class App extends Base implements Greeter {

  private final Store store;

  public App(Store store) {
    this.store = store;
  }

  @Override
  public String greet(String name) {
    return decorate(name);
  }

  private String decorate(String raw) {
    return raw;
  }

  public void persist() {
    store.save(new Point(1, 2));
  }

  public void inferred() {
    var local = new Store();
    local.save(new Point(3, 4));
  }

  void packagePrivate() {}
}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-java-"));
  mkdirSync(join(dir, PKG), { recursive: true });
  writeFileSync(join(dir, PKG, "Greeter.java"), GREETER);
  writeFileSync(join(dir, PKG, "Base.java"), BASE);
  writeFileSync(join(dir, PKG, "Point.java"), POINT);
  writeFileSync(join(dir, PKG, "Color.java"), COLOR);
  writeFileSync(join(dir, PKG, "Store.java"), STORE);
  writeFileSync(join(dir, PKG, "App.java"), APP);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

const APP_JAVA = `${PKG}/App.java`;

test("Java extraction: classes, interfaces, enums, records, methods, constructors", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir); // $0, Tier-1 only
    assert.ok(result.languages.includes("java"), "languages should include java");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    assert.equal(nodeById(graph!, `${APP_JAVA}#App`)?.kind, "class");
    assert.equal(nodeById(graph!, `${PKG}/Greeter.java#Greeter`)?.kind, "interface");
    assert.equal(nodeById(graph!, `${PKG}/Color.java#Color`)?.kind, "enum");

    // A record is a nominal data carrier, so it takes "struct" — not "class", which
    // would make a DTO and a service indistinguishable in a Java repo where DTOs are
    // most of the type surface.
    assert.equal(nodeById(graph!, `${PKG}/Point.java#Point`)?.kind, "struct");

    // Methods nest under their type; a constructor is a method named for its class.
    assert.equal(nodeById(graph!, `${APP_JAVA}#App.greet`)?.kind, "method");
    assert.equal(nodeById(graph!, `${APP_JAVA}#App.App`)?.kind, "method");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: visibility comes from the modifier list, not the name", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    assert.equal(nodeById(graph, `${APP_JAVA}#App`)?.exported, true, "public class");
    assert.equal(nodeById(graph, `${APP_JAVA}#App.greet`)?.exported, true, "public method");
    assert.equal(
      nodeById(graph, `${PKG}/Base.java#Base.audit`)?.exported,
      true,
      "protected is still API surface to a subclass",
    );
    assert.equal(
      nodeById(graph, `${APP_JAVA}#App.decorate`)?.exported,
      false,
      "private method is not API surface",
    );
    assert.equal(
      nodeById(graph, `${APP_JAVA}#App.packagePrivate`)?.exported,
      false,
      "package-private (no modifier) is not API surface",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: call edges — implicit `this`, typed field receiver, constructor", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const calls = graph.edges.filter((e) => e.relation === "calls");

    // Implicit-`this`: `decorate(name)` names no receiver but IS a method call.
    // Java has no free functions, so resolving this against the function index
    // would silently drop the commonest edge in the language.
    assert.ok(
      calls.some((e) => e.source === `${APP_JAVA}#App.greet` && e.target === `${APP_JAVA}#App.decorate`),
      "greet should call decorate via implicit-this resolution",
    );

    // Typed field receiver: `store.save(...)` resolves through the declared field
    // type `private final Store store`.
    assert.ok(
      calls.some(
        (e) => e.source === `${APP_JAVA}#App.persist` && e.target === `${PKG}/Store.java#Store.save`,
      ),
      "persist should call Store.save via the field's declared type",
    );

    // `new Point(1, 2)` targets a TYPE, not a function.
    assert.ok(
      calls.some(
        (e) => e.source === `${APP_JAVA}#App.persist` && e.target === `${PKG}/Point.java#Point`,
      ),
      "persist should have a constructor edge to Point",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: a `var` local states no type, so its member call stays unresolved", async () => {
  // Not a defect to fix by guessing — it is the documented limit of a deterministic,
  // single-file binding pass. `var local = new Store()` would need return-type
  // inference to know `local` is a Store. The constructor edge still lands, so the
  // dependency is not lost entirely; only the member call through it is.
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const calls = graph.edges.filter((e) => e.relation === "calls");

    assert.ok(
      !calls.some(
        (e) => e.source === `${APP_JAVA}#App.inferred` && e.target === `${PKG}/Store.java#Store.save`,
      ),
      "a var-typed receiver must not be guessed into a resolved edge",
    );
    assert.ok(
      calls.some(
        (e) => e.source === `${APP_JAVA}#App.inferred` && e.target === `${PKG}/Store.java#Store`,
      ),
      "the constructor edge still resolves, so the dependency is still visible",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: extends and implements", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "extends" &&
          e.source === `${APP_JAVA}#App` &&
          e.target === `${PKG}/Base.java#Base`,
      ),
      "App extends Base",
    );
    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "implements" &&
          e.source === `${APP_JAVA}#App` &&
          e.target === `${PKG}/Greeter.java#Greeter`,
      ),
      "App implements Greeter",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: imports resolve by package path; external types stay strings", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const imports = graph.edges.filter((e) => e.relation === "imports" && e.source === APP_JAVA);

    // A Java import names a TYPE and states no source root, so resolution matches the
    // fully-qualified name against a path suffix — root-agnostic, no build-file parsing.
    assert.ok(
      imports.some((e) => e.target === `${PKG}/Store.java`),
      "com.acme.Store should resolve to the in-repo file under src/main/java/",
    );

    // The JDK is not in the repo; the specifier is kept verbatim rather than guessed at.
    assert.ok(
      imports.some((e) => e.target === "java.util.List"),
      "java.util.List should remain an external type string",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: a static-member import resolves to its enclosing type", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-java-static-"));
  try {
    mkdirSync(join(dir, PKG), { recursive: true });
    writeFileSync(
      join(dir, PKG, "Util.java"),
      "package com.acme;\n\npublic final class Util {\n  public static int twice(int n) {\n    return n * 2;\n  }\n}\n",
    );
    writeFileSync(
      join(dir, PKG, "Caller.java"),
      "package com.acme;\n\nimport static com.acme.Util.twice;\n\npublic final class Caller {\n  public int run() {\n    return twice(2);\n  }\n}\n",
    );

    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // `com.acme.Util.twice` names a member; the file is the enclosing type's.
    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "imports" &&
          e.source === `${PKG}/Caller.java` &&
          e.target === `${PKG}/Util.java`,
      ),
      "a static-member import should fall back to its enclosing type's file",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: an ambiguous package suffix stays unresolved rather than guessing", async () => {
  // The same fully-qualified name under two source roots (main and a duplicated test
  // tree) gives one suffix two files. Picking one would invent an edge the source
  // does not state, so the specifier is kept.
  const dir = mkdtempSync(join(tmpdir(), "graft-java-ambig-"));
  try {
    const main = "src/main/java/com/acme";
    const test2 = "src/test/java/com/acme";
    mkdirSync(join(dir, main), { recursive: true });
    mkdirSync(join(dir, test2), { recursive: true });
    const dup = "package com.acme;\n\npublic final class Dup {\n  public void run() {}\n}\n";
    writeFileSync(join(dir, main, "Dup.java"), dup);
    writeFileSync(join(dir, test2, "Dup.java"), dup);
    writeFileSync(
      join(dir, main, "Uses.java"),
      "package com.acme;\n\nimport com.acme.Dup;\n\npublic final class Uses {\n  public void go() {}\n}\n",
    );

    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "imports" && e.source === `${main}/Uses.java` && e.target === "com.acme.Dup",
      ),
      "an ambiguous suffix must stay an unresolved specifier",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Overload fixture: a 2-arg convenience method delegating to the 3-arg one — the
 * commonest shape in Java, and the one that produced a self-loop before arity was
 * recorded. `log` adds a variadic pair; `render` a same-arity pair. */
const OVERLOADS = `package com.acme;

public final class Svc {

  public String join(String left, String right) {
    return join(left, right, "-");
  }

  public String join(String left, String right, String separator) {
    return left + separator + right;
  }

  public void log(String msg) {
    log(msg, "a", "b");
  }

  public void log(String msg, String... rest) {}

  public String render(String s) {
    return render(s.length());
  }

  public String render(int n) {
    return String.valueOf(n);
  }
}
`;

function overloadFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-java-overload-"));
  mkdirSync(join(dir, PKG), { recursive: true });
  writeFileSync(join(dir, PKG, "Svc.java"), OVERLOADS);
  return dir;
}

test("Java overloads: a delegating call resolves to the other overload, not itself", async () => {
  // Before arity was recorded, both `join` nodes were candidates, the same-file
  // tiebreak picked the first, and the 2-arg method got a `calls` edge to ITSELF —
  // marked `extracted`, i.e. confidently wrong. Overloading exists in none of the
  // other languages graft parses, so no existing fixture could have caught this.
  const dir = overloadFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const svc = `${PKG}/Svc.java`;
    const calls = graph.edges.filter((e) => e.relation === "calls");

    assert.ok(
      calls.some((e) => e.source === `${svc}#Svc.join` && e.target === `${svc}#Svc.join~2`),
      "the 2-arg join should call the 3-arg overload",
    );
    assert.ok(
      !calls.some((e) => e.source === `${svc}#Svc.join` && e.target === `${svc}#Svc.join`),
      "and must not call itself",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java overloads: a variadic candidate is never filtered out by argument count", async () => {
  // `log(String, String...)` has arity 2 but accepts 1..n arguments. Filtering on
  // equality would exclude it from a 3-argument call and drop a real edge.
  const dir = overloadFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const svc = `${PKG}/Svc.java`;

    const variadic = graph.nodes.find((n) => n.id === `${svc}#Svc.log~2`);
    assert.equal(variadic?.arity, 2, "declared arity counts the vararg parameter");
    assert.equal(variadic?.variadic, true, "and it is flagged variadic");

    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === `${svc}#Svc.log` && e.target === `${svc}#Svc.log~2`,
      ),
      "a 3-argument call should still reach the variadic overload",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java overloads: same-arity overloads stay unresolved rather than guessing", async () => {
  // `render(String)` and `render(int)` both have arity 1 — they differ only by
  // parameter TYPE, which this pass does not model. The documented limit: narrowing
  // cannot separate them, so the same-file tiebreak applies and no type-based guess
  // is made. Pinned so a future type-aware change is a deliberate one.
  const dir = overloadFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const svc = `${PKG}/Svc.java`;

    const a = graph.nodes.find((n) => n.id === `${svc}#Svc.render`);
    const b = graph.nodes.find((n) => n.id === `${svc}#Svc.render~2`);
    assert.equal(a?.arity, 1);
    assert.equal(b?.arity, 1, "both render overloads have arity 1, so count cannot separate them");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Construction fixture. `Box` is built raw, with explicit type arguments, and with the
 * diamond — three spellings of one node. `File` and the nested `Alpha`/`Beta` builders
 * exist so the negative half can be pinned: a qualified `new` must resolve to NOTHING
 * rather than to the same-named type that happens to be in the repo. */
const GENERIC_BOX = `package com.acme;

public final class Box<T> {
  private final T value;

  public Box(T value) {
    this.value = value;
  }

  public T get() {
    return value;
  }
}
`;

/** A repo-local type whose simple name collides with a JDK one. */
const LOCAL_FILE = `package com.acme;

public final class File {
  public void touch() {}
}
`;

/**
 * Two nested builders under one outer type, and a method that constructs one of them —
 * all in ONE file, deliberately. A last-segment collapse yields the bare name `Builder`,
 * which matches both; the resolver's same-file tiebreak then takes the FIRST candidate.
 * Split across files the ambiguity would simply drop, so a cross-file fixture would pass
 * whether or not the collapse happens and would pin nothing.
 */
const NESTED = `package com.acme;

public final class Api {

  public static class Alpha {
    public static class Builder {
      public Api build() {
        return null;
      }
    }
  }

  public static class Beta {
    public static class Builder {
      public Api build() {
        return null;
      }
    }
  }

  public Api make() {
    return new Beta.Builder().build();
  }
}
`;

const GENERIC_USES = `package com.acme;

import com.acme.Box;

public final class Uses {

  public Box<String> explicitArguments() {
    return new Box<String>("a");
  }

  public Box<String> diamond() {
    return new Box<>("b");
  }

  @SuppressWarnings("rawtypes")
  public Box raw() {
    return new Box("c");
  }

  public Object qualified() {
    return new java.io.File("x");
  }

}
`;

function genericFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-java-generic-"));
  mkdirSync(join(dir, PKG), { recursive: true });
  writeFileSync(join(dir, PKG, "Box.java"), GENERIC_BOX);
  writeFileSync(join(dir, PKG, "File.java"), LOCAL_FILE);
  writeFileSync(join(dir, PKG, "Api.java"), NESTED);
  writeFileSync(join(dir, PKG, "Uses.java"), GENERIC_USES);
  return dir;
}

test("Java construction: a generic `new` reaches the same type node as a raw one", async () => {
  // `object_creation_expression` used to hand the constructed type's RAW TEXT to the
  // resolver, so `new Box<String>()` searched for a node named "Box<String>" and the
  // diamond form for "Box<>". Neither exists — the node is "Box" — so every generic
  // construction lost its edge while the raw form worked, which is why it went
  // unnoticed.
  //
  // The constructed type is now erased by `javaConstructedTypeName`, which is
  // deliberately NOT bindings.ts's `javaTypeName`: that one collapses a qualified name
  // to its last segment, which is safe for deciding what a variable holds and NOT safe
  // for naming a constructor target. Wiring the two together is what the sibling test
  // below ("a QUALIFIED `new` resolves to nothing") exists to forbid.
  const dir = genericFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const box = `${PKG}/Box.java#Box`;
    const uses = `${PKG}/Uses.java`;
    const calls = graph.edges.filter((e) => e.relation === "calls" && e.target === box);
    const sources = new Set(calls.map((e) => e.source));

    assert.ok(sources.has(`${uses}#Uses.explicitArguments`), "new Box<String>() should reach Box");
    assert.ok(sources.has(`${uses}#Uses.diamond`), "new Box<>() should reach Box");
    assert.ok(sources.has(`${uses}#Uses.raw`), "new Box() should still reach Box");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java construction: a QUALIFIED `new` resolves to nothing, not to a same-named local type", async () => {
  // The negative half of the same change, and the reason erasure is done by a helper of
  // its own rather than by the binding pass's `javaTypeName`. Reducing `java.io.File` to
  // its final segment would find the repo's unrelated `com.acme.File` and assert an edge
  // the source never expressed — trading a missing edge for a wrong one, which is the
  // trade the resolver exists to refuse.
  const dir = genericFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const calls = graph.edges.filter((e) => e.relation === "calls");

    assert.ok(
      !calls.some(
        (e) =>
          e.source === `${PKG}/Uses.java#Uses.qualified` && e.target === `${PKG}/File.java#File`,
      ),
      "new java.io.File(...) must not resolve to the repo's own File",
    );
    assert.ok(
      !calls.some((e) => e.source === `${PKG}/Uses.java#Uses.qualified`),
      "and must not resolve to anything else either",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java construction: a nested `new` does not bind to a sibling of the same simple name", async () => {
  // `new Beta.Builder()` collapsed to `Builder` matches two nodes in the SAME file, and
  // the resolver's same-file tiebreak returns the FIRST — `Alpha.Builder` — at
  // `extracted` confidence, i.e. confidently wrong. Resolving nested construction
  // properly needs a qualified-name index; until then it resolves to nothing.
  const dir = genericFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    const api = `${PKG}/Api.java`;
    const ctor = graph.edges.filter(
      (e) =>
        e.relation === "calls" && e.source === `${api}#Api.make` && e.target.includes("Builder"),
    );

    assert.deepEqual(ctor, [], "a qualified nested construction must not pick a Builder at all");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
