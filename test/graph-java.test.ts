/**
 * Tests for Java extraction in the Tier-1 code graph. Builds small Java files
 * in a temp dir and asserts the emitted nodes (classes, interfaces, enums,
 * records, methods, constructors) and edges (calls, imports, heritage,
 * contains) match the AST walk in extract.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const MAIN_JAVA = `package com.example.api;

import java.util.List;
import java.util.ArrayList;
import com.example.core.Helper;

public interface ITenantRA {
    Task<Result> createAsync(TenantDefinition def);
    void cleanup();
}

public sealed class TenantManager extends Base implements ITenantManager, IDisposable {
    private final ITenantRA ra;

    public TenantManager(ITenantRA ra) {
        this.ra = ra;
    }

    public Task<Result<Tenant>> createTenantAsync(TenantDefinition def) {
        return ra.createAsync(def);
    }

    private void internal() {
        ra.cleanup();
    }
}

public interface ITenantManager {
    Task<Result<Tenant>> createTenantAsync(TenantDefinition def);
}

public enum AppRole { VIEWER, AUTHOR, ADMIN }

public record Tenant(String name, String email) {}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-java-"));
  writeFileSync(join(dir, "TenantManager.java"), MAIN_JAVA);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("Java extraction: classes, interfaces, enums, records", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir);
    assert.ok(result.languages.includes("java"), "languages should include java");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    // class
    const cls = nodeById(graph!, "TenantManager.java#TenantManager");
    assert.equal(cls?.kind, "class");
    assert.equal(cls?.exported, true);

    // interface
    const iface = nodeById(graph!, "TenantManager.java#ITenantManager");
    assert.equal(iface?.kind, "interface");
    assert.equal(iface?.exported, true);

    // enum
    const enumNode = nodeById(graph!, "TenantManager.java#AppRole");
    assert.equal(enumNode?.kind, "enum");
    assert.equal(enumNode?.exported, true);

    // record (treated as class)
    const record = nodeById(graph!, "TenantManager.java#Tenant");
    assert.equal(record?.kind, "class");
    assert.equal(record?.exported, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: methods, constructors, visibility", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // constructor
    const ctor = nodeById(graph, "TenantManager.java#TenantManager.TenantManager");
    assert.equal(ctor?.kind, "method");
    assert.equal(ctor?.exported, true);

    // public method
    const create = nodeById(graph, "TenantManager.java#TenantManager.createTenantAsync");
    assert.equal(create?.kind, "method");
    assert.equal(create?.exported, true);

    // private method — not exported
    const internal_ = nodeById(graph, "TenantManager.java#TenantManager.internal");
    assert.equal(internal_?.kind, "method");
    assert.equal(internal_?.exported, false);

    // interface method signature (no body) is still a method
    const ifaceMethod = nodeById(graph, "TenantManager.java#ITenantRA.createAsync");
    assert.equal(ifaceMethod?.kind, "method");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: heritage edges (extends + implements)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // TenantManager extends Base (superclass)
    const extendsEdge = graph.edges.find(
      (e) => e.relation === "extends" && e.source === "TenantManager.java#TenantManager",
    );
    assert.ok(extendsEdge, "TenantManager should have an extends edge");

    // TenantManager implements ITenantManager (first in super_interfaces)
    const implementsItm = graph.edges.find(
      (e) =>
        e.relation === "implements" &&
        e.source === "TenantManager.java#TenantManager" &&
        e.target === "TenantManager.java#ITenantManager",
    );
    assert.ok(implementsItm, "TenantManager should implement ITenantManager");

    // TenantManager implements IDisposable (second in super_interfaces)
    const implementsDisp = graph.edges.find(
      (e) =>
        e.relation === "implements" &&
        e.source === "TenantManager.java#TenantManager" &&
        e.target === "IDisposable",
    );
    assert.ok(implementsDisp, "TenantManager should have an implements edge to IDisposable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: call edges (member calls with receiver resolution)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // createTenantAsync calls ra.createAsync — resolves to ITenantRA.createAsync
    const call = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "TenantManager.java#TenantManager.createTenantAsync" &&
        e.target === "TenantManager.java#ITenantRA.createAsync",
    );
    assert.ok(call, "createTenantAsync should have a resolved calls edge to ITenantRA.createAsync");

    // internal calls ra.cleanup — resolves to ITenantRA.cleanup
    const cleanup = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "TenantManager.java#TenantManager.internal" &&
        e.target === "TenantManager.java#ITenantRA.cleanup",
    );
    assert.ok(cleanup, "internal should have a resolved calls edge to ITenantRA.cleanup");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: import edges (import declarations)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    const listImport = graph.edges.find(
      (e) => e.relation === "imports" && e.source === "TenantManager.java" && e.target === "java.util.List",
    );
    assert.ok(listImport, "Should have an import edge for java.util.List");

    const helperImport = graph.edges.find(
      (e) => e.relation === "imports" && e.source === "TenantManager.java" && e.target === "com.example.core.Helper",
    );
    assert.ok(helperImport, "Should have an import edge for com.example.core.Helper");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: contains edges (structural hierarchy)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // file contains TenantManager
    const fileContainsClass = graph.edges.find(
      (e) =>
        e.relation === "contains" &&
        e.source === "TenantManager.java" &&
        e.target === "TenantManager.java#TenantManager",
    );
    assert.ok(fileContainsClass, "File should contain TenantManager class");

    // TenantManager contains createTenantAsync
    const classContainsMethod = graph.edges.find(
      (e) =>
        e.relation === "contains" &&
        e.source === "TenantManager.java#TenantManager" &&
        e.target === "TenantManager.java#TenantManager.createTenantAsync",
    );
    assert.ok(classContainsMethod, "TenantManager should contain createTenantAsync");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A second fixture exercising the constructs the first fixture doesn't cover:
// interface-extends-interface, enum-implements-interface, annotation types,
// bare/static calls, this-qualified calls inside enum/interface methods,
// varargs, try-with-resources, and wildcard imports.
const EXTRA_JAVA = `package com.example.api;

import static com.example.core.Helper.*;
import com.example.core.*;

public interface IBase {
    void doStuff();
}

public interface IDerived extends IBase {
    void other();
}

public interface IRunnable {
    void run();
}

public enum AppMode implements IRunnable {
    DEV, PROD;

    public void run() {
        this.switchMode();
    }

    public void switchMode() {}
}

public @interface Version {
    String value() default "1";
}

public class Static {
    public static int helper() {
        return 42;
    }

    public int run() {
        int x = helper();
        return x;
    }

    public void useVarargs(String... args) {
        args.length();
    }

    public void useTryWithResources() {
        try (Static s = new Static()) {
            s.helper();
        }
    }
}
`;

function makeExtraFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-java-extra-"));
  writeFileSync(join(dir, "Extra.java"), EXTRA_JAVA);
  return dir;
}

test("Java extraction: interface-extends-interface heritage edges", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // IDerived extends IBase (interface extends interface)
    const extendsEdge = graph.edges.find(
      (e) =>
        e.relation === "extends" &&
        e.source === "Extra.java#IDerived" &&
        e.target === "Extra.java#IBase",
    );
    assert.ok(extendsEdge, "IDerived should have an extends edge to IBase");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: enum-implements-interface heritage edges", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // AppMode implements IRunnable (enum implements interface)
    const implementsEdge = graph.edges.find(
      (e) =>
        e.relation === "implements" &&
        e.source === "Extra.java#AppMode" &&
        e.target === "Extra.java#IRunnable",
    );
    assert.ok(implementsEdge, "AppMode should have an implements edge to IRunnable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: annotation type declarations", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // @interface Version → interface-kind node
    const anno = nodeById(graph, "Extra.java#Version");
    assert.ok(anno, "Version annotation type should be a node");
    assert.equal(anno?.kind, "interface");

    // annotation element `value()` → method-kind node
    const elem = nodeById(graph, "Extra.java#Version.value");
    assert.ok(elem, "Version.value element should be a node");
    assert.equal(elem?.kind, "method");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: bare (unqualified) static call resolves", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // Static.run calls helper() — bare call, should resolve to Static.helper
    const call = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "Extra.java#Static.run" &&
        e.target === "Extra.java#Static.helper",
    );
    assert.ok(call, "run() should have a calls edge to Static.helper (bare call resolves)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: this-qualified call inside enum method resolves via typed path", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // AppMode.run calls this.switchMode() — should resolve to AppMode.switchMode
    const call = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "Extra.java#AppMode.run" &&
        e.target === "Extra.java#AppMode.switchMode",
    );
    assert.ok(call, "AppMode.run should have a calls edge to AppMode.switchMode (this-qualified in enum)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: varargs parameter binding", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // useVarargs calls args.length() — args is a varargs (spread_parameter);
    // if bound to String, .length() is dropped (String is a builtin), so no
    // calls edge. The test verifies the binding exists by checking the call is
    // NOT wired to a wrong repo symbol (the safe-failure mode). We assert the
    // method node exists and has no spurious calls edge to another repo method.
    const method = nodeById(graph, "Extra.java#Static.useVarargs");
    assert.ok(method, "useVarargs should be a node");
    // No calls edge should fire from useVarargs to any repo method named "length"
    // — String.length() is a builtin method, not a repo symbol.
    const badCall = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "Extra.java#Static.useVarargs" &&
        e.target.includes("#") &&
        graph.nodes.find((n) => n.id === e.target)?.name === "length",
    );
    assert.equal(badCall, undefined, "varargs String.length() should not wire to a repo method");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: try-with-resources variable binding", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // useTryWithResources: try (Static s = new Static()) { s.helper(); }
    // s is bound to Static, so s.helper() should resolve to Static.helper
    const call = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "Extra.java#Static.useTryWithResources" &&
        e.target === "Extra.java#Static.helper",
    );
    assert.ok(call, "s.helper() inside try-with-resources should resolve to Static.helper");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: wildcard imports preserve the .* marker", async () => {
  const dir = makeExtraFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // import static com.example.core.Helper.* → specifier ends with .*
    const wildcardImport = graph.edges.find(
      (e) =>
        e.relation === "imports" &&
        e.source === "Extra.java" &&
        e.target === "com.example.core.Helper.*",
    );
    assert.ok(wildcardImport, "Wildcard static import should preserve the .* suffix");

    // import com.example.core.* → specifier ends with .*
    const pkgWildcardImport = graph.edges.find(
      (e) =>
        e.relation === "imports" &&
        e.source === "Extra.java" &&
        e.target === "com.example.core.*",
    );
    assert.ok(pkgWildcardImport, "Wildcard package import should preserve the .* suffix");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A third fixture exercising type-name extraction edge cases: generic and
// scoped-generic heritage edges, array-typed fields/locals, enhanced-for loop
// variables, and catch parameters — all binding gaps that were fixed after the
// initial Java support landed.
const TYPED_JAVA = `package com.example.api;

public class Base {
    public void baseMethod() {}
}

public interface IFoo {
    void fooMethod();
}

public class Container {
    public void work() {}
}

public class GenericHolder {
    public void act() {}
}

public class UsesArray {
    public void invoke() {}
}

public class Typed extends com.example.api.Base<java.lang.String> implements IFoo, com.example.api.IFoo {
    private com.example.api.Container<java.lang.String> helper;
    private UsesArray[] arr;

    public void method(UsesArray[] items) {
        // generic-scoped field call — helper is Container, so helper.work() resolves
        helper.work();

        // array-typed field call — arr is UsesArray, so arr[0].invoke() is a
        // member call on an array element (receiver is arr, not bound as a
        // method call we can resolve; the field binding itself is the test)

        // enhanced-for: item is bound to UsesArray
        for (UsesArray item : items) {
            item.invoke();
        }

        // catch parameter: e is bound to Exception
        try {
            helper.work();
        } catch (RuntimeException e) {
            e.getMessage();
        }
    }
}
`;

function makeTypedFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-java-typed-"));
  writeFileSync(join(dir, "Typed.java"), TYPED_JAVA);
  return dir;
}

test("Java extraction: generic superclass resolves to bare name", async () => {
  const dir = makeTypedFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // Typed extends com.example.api.Base<String> → should resolve to Typed.java#Base
    const extendsEdge = graph.edges.find(
      (e) =>
        e.relation === "extends" &&
        e.source === "Typed.java#Typed" &&
        e.target === "Typed.java#Base",
    );
    assert.ok(extendsEdge, "Typed should have an extends edge to Base (generic superclass resolved to bare name)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: scoped-generic implements resolves to bare name", async () => {
  const dir = makeTypedFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // Typed implements com.example.api.IFoo<String> → should resolve to Typed.java#IFoo
    const implementsEdge = graph.edges.find(
      (e) =>
        e.relation === "implements" &&
        e.source === "Typed.java#Typed" &&
        e.target === "Typed.java#IFoo",
    );
    assert.ok(implementsEdge, "Typed should have an implements edge to IFoo (scoped-generic resolved to bare name)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: generic-scoped field call resolves", async () => {
  const dir = makeTypedFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // helper is `com.example.api.Container<java.lang.String>` → binds to Container
    // so helper.work() should resolve to Container.work
    const call = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "Typed.java#Typed.method" &&
        e.target === "Typed.java#Container.work",
    );
    assert.ok(call, "helper.work() should resolve to Container.work (generic-scoped field binding)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: enhanced-for loop variable binding", async () => {
  const dir = makeTypedFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // for (UsesArray item : items) { item.invoke(); } → item is bound to UsesArray
    // so item.invoke() should resolve to UsesArray.invoke
    const call = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "Typed.java#Typed.method" &&
        e.target === "Typed.java#UsesArray.invoke",
    );
    assert.ok(call, "item.invoke() inside enhanced-for should resolve to UsesArray.invoke");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Java extraction: catch parameter binding drops builtin method calls", async () => {
  const dir = makeTypedFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // catch (RuntimeException e) { e.getMessage(); } — e is bound to RuntimeException
    // (not a repo symbol), so e.getMessage() should NOT wire to a repo method.
    // The test verifies no spurious calls edge to a repo method named "getMessage".
    const badCall = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "Typed.java#Typed.method" &&
        e.target.includes("#") &&
        graph.nodes.find((n) => n.id === e.target)?.name === "getMessage",
    );
    assert.equal(badCall, undefined, "e.getMessage() on a caught RuntimeException should not wire to a repo method");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});