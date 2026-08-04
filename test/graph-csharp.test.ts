/**
 * Tests for C# extraction in the Tier-1 code graph. Builds small C# files in a
 * temp dir and asserts the emitted nodes (classes, interfaces, structs, enums,
 * records, methods, constructors, properties) and edges (calls, imports, heritage).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const MAIN_CS = `using System;
using System.Collections.Generic;

namespace mm.signum.Api;

public interface ITenantRA
{
    Task<Result> CreateAsync(TenantDefinition def);
    void Cleanup();
}

public sealed class TenantManager : ITenantManager, IDisposable
{
    private readonly ITenantRA _ra;

    public TenantManager(ITenantRA ra)
    {
        _ra = ra;
    }

    public async Task<Result<Tenant>> CreateTenantAsync(TenantDefinition def)
    {
        return await _ra.CreateAsync(def);
    }

    private void Internal()
    {
        _ra.Cleanup();
    }
}

public interface ITenantManager
{
    Task<Result<Tenant>> CreateTenantAsync(TenantDefinition def);
}

public enum AppRole { Viewer, WorkflowAuthor, Admin }

public readonly record struct TenantId(Guid Value);

public record Tenant(string Name, string Email);
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-cs-"));
  writeFileSync(join(dir, "TenantManager.cs"), MAIN_CS);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("C# extraction: classes, interfaces, enums, records, structs", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir);
    assert.ok(result.languages.includes("csharp"), "languages should include csharp");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    // class
    const cls = nodeById(graph!, "TenantManager.cs#TenantManager");
    assert.equal(cls?.kind, "class");
    assert.equal(cls?.exported, true);

    // interface
    const iface = nodeById(graph!, "TenantManager.cs#ITenantManager");
    assert.equal(iface?.kind, "interface");
    assert.equal(iface?.exported, true);

    // enum
    const enumNode = nodeById(graph!, "TenantManager.cs#AppRole");
    assert.equal(enumNode?.kind, "enum");
    assert.equal(enumNode?.exported, true);

    // record (treated as class)
    const record = nodeById(graph!, "TenantManager.cs#Tenant");
    assert.equal(record?.kind, "class");
    assert.equal(record?.exported, true);

    // record struct (treated as class)
    const recordStruct = nodeById(graph!, "TenantManager.cs#TenantId");
    assert.equal(recordStruct?.kind, "class");
    assert.equal(recordStruct?.exported, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C# extraction: methods, constructors, visibility", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // constructor
    const ctor = nodeById(graph, "TenantManager.cs#TenantManager.TenantManager");
    assert.equal(ctor?.kind, "method");
    assert.equal(ctor?.exported, true);

    // public method
    const create = nodeById(graph, "TenantManager.cs#TenantManager.CreateTenantAsync");
    assert.equal(create?.kind, "method");
    assert.equal(create?.exported, true);

    // private method — not exported
    const internal_ = nodeById(graph, "TenantManager.cs#TenantManager.Internal");
    assert.equal(internal_?.kind, "method");
    assert.equal(internal_?.exported, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C# extraction: heritage edges (extends + implements)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // TenantManager extends ITenantManager (first in base_list)
    const extendsEdge = graph.edges.find(
      (e) => e.relation === "extends" && e.source === "TenantManager.cs#TenantManager",
    );
    assert.ok(extendsEdge, "TenantManager should have an extends edge");

    // TenantManager implements IDisposable (second in base_list)
    const implementsEdge = graph.edges.find(
      (e) => e.relation === "implements" && e.source === "TenantManager.cs#TenantManager",
    );
    assert.ok(implementsEdge, "TenantManager should have an implements edge");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C# extraction: call edges (member calls)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // CreateTenantAsync calls _ra.CreateAsync — resolves to ITenantRA.CreateAsync
    const call = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "TenantManager.cs#TenantManager.CreateTenantAsync" &&
        e.target === "TenantManager.cs#ITenantRA.CreateAsync",
    );
    assert.ok(call, "CreateTenantAsync should have a resolved calls edge to ITenantRA.CreateAsync");

    // Internal calls _ra.Cleanup — resolves to ITenantRA.Cleanup
    const cleanup = graph.edges.find(
      (e) =>
        e.relation === "calls" &&
        e.source === "TenantManager.cs#TenantManager.Internal" &&
        e.target === "TenantManager.cs#ITenantRA.Cleanup",
    );
    assert.ok(cleanup, "Internal should have a resolved calls edge to ITenantRA.Cleanup");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C# extraction: import edges (using directives)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    const systemImport = graph.edges.find(
      (e) => e.relation === "imports" && e.source === "TenantManager.cs" && e.target === "System",
    );
    assert.ok(systemImport, "Should have an import edge for System");

    const collectionsImport = graph.edges.find(
      (e) =>
        e.relation === "imports" && e.source === "TenantManager.cs" && e.target === "System.Collections.Generic",
    );
    assert.ok(collectionsImport, "Should have an import edge for System.Collections.Generic");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C# extraction: contains edges (structural hierarchy)", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // file contains TenantManager
    const fileContainsClass = graph.edges.find(
      (e) =>
        e.relation === "contains" &&
        e.source === "TenantManager.cs" &&
        e.target === "TenantManager.cs#TenantManager",
    );
    assert.ok(fileContainsClass, "File should contain TenantManager class");

    // TenantManager contains CreateTenantAsync
    const classContainsMethod = graph.edges.find(
      (e) =>
        e.relation === "contains" &&
        e.source === "TenantManager.cs#TenantManager" &&
        e.target === "TenantManager.cs#TenantManager.CreateTenantAsync",
    );
    assert.ok(classContainsMethod, "TenantManager should contain CreateTenantAsync");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
