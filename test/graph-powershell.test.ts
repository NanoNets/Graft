import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { CODE_EXTENSIONS } from "../src/context/build.js";
import { extractFile, languageOf } from "../src/graph/extract.js";
import { IMPORT_EXTS } from "../src/graph/resolve.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const MAIN_PS = String.raw`. .\lib\helpers.ps1
Import-Module .\Widget.psm1
Import-Module Az.Accounts

function Start-Exact {
  Get-Helper
}

function Start-WrongCase {
  get-helper
}

function Start-DomainCheck {
  invoke
}
`;

const HELPERS_PS = `function Get-Helper {
  Invoke
}

function Invoke {}
`;

const WIDGET_PS = `class BaseWidget {
  [void] BaseMethod() {}
}

class Widget : basewidget {
  [string]$Name

  Widget() {}

  [void] Render() {
    $This.HELPER()
  }

  [void] Helper() {}
}

enum Color {
  Red
  Blue
}

function New-Widget {
  [widget]$w = [WIDGET]::new()
  $w.render()
  $w.basemethod()
}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-"));
  mkdirSync(join(dir, "lib"));
  writeFileSync(join(dir, "main.ps1"), MAIN_PS);
  writeFileSync(join(dir, "lib", "helpers.ps1"), HELPERS_PS);
  writeFileSync(join(dir, "Widget.psm1"), WIDGET_PS);
  writeFileSync(join(dir, "collision.py"), "def invoke():\n    pass\n");
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function hasEdge(graph: GraphV1, source: string, target: string, relation: string): boolean {
  return graph.edges.some((e) => e.source === source && e.target === target && e.relation === relation);
}

test("PowerShell extraction: files, definitions, exports, calls, and imports", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir);
    assert.ok(result.languages.includes("powershell"));

    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    for (const id of ["main.ps1", "lib/helpers.ps1", "Widget.psm1"]) {
      assert.equal(nodeById(graph, id)?.kind, "file", `${id} should be a file node`);
    }

    for (const id of [
      "main.ps1#Start-Exact",
      "main.ps1#Start-WrongCase",
      "lib/helpers.ps1#Get-Helper",
      "lib/helpers.ps1#Invoke",
      "Widget.psm1#New-Widget",
    ]) {
      assert.equal(nodeById(graph, id)?.kind, "function", `${id} should be a function`);
      assert.equal(nodeById(graph, id)?.exported, true, `${id} should be exported`);
    }
    assert.equal(nodeById(graph, "Widget.psm1#Widget")?.kind, "class");
    assert.equal(nodeById(graph, "Widget.psm1#Color")?.kind, "enum");
    assert.equal(nodeById(graph, "Widget.psm1#Widget")?.exported, true);
    assert.equal(nodeById(graph, "Widget.psm1#Color")?.exported, true);
    assert.equal(nodeById(graph, "Widget.psm1#Widget.Widget")?.kind, "method", "constructor is a method");
    assert.equal(nodeById(graph, "Widget.psm1#Widget.Render")?.kind, "method");
    assert.equal(nodeById(graph, "Widget.psm1#Widget.Render")?.exported, true);
    assert.equal(nodeById(graph, "Widget.psm1#Widget.Name"), undefined, "properties are not graph defs");

    assert.ok(hasEdge(graph, "lib/helpers.ps1#Get-Helper", "lib/helpers.ps1#Invoke", "calls"));
    assert.ok(hasEdge(graph, "main.ps1#Start-Exact", "lib/helpers.ps1#Get-Helper", "calls"));
    assert.ok(
      hasEdge(graph, "main.ps1#Start-WrongCase", "lib/helpers.ps1#Get-Helper", "calls"),
      "wrong-case command should resolve to the PowerShell definition",
    );
    assert.ok(
      hasEdge(graph, "main.ps1#Start-DomainCheck", "lib/helpers.ps1#Invoke", "calls"),
      "case folding must stay in the PowerShell domain, not select collision.py#invoke",
    );
    assert.ok(hasEdge(graph, "Widget.psm1#New-Widget", "Widget.psm1#Widget.Render", "calls"));
    assert.ok(hasEdge(graph, "Widget.psm1#Widget", "Widget.psm1#BaseWidget", "extends"));
    assert.ok(hasEdge(graph, "Widget.psm1#New-Widget", "Widget.psm1#BaseWidget.BaseMethod", "calls"));
    assert.ok(hasEdge(graph, "Widget.psm1#Widget.Render", "Widget.psm1#Widget.Helper", "calls"));

    assert.ok(hasEdge(graph, "main.ps1", "lib/helpers.ps1", "imports"));
    assert.ok(hasEdge(graph, "main.ps1", "Widget.psm1", "imports"));
    assert.ok(hasEdge(graph, "main.ps1", "Az.Accounts", "imports"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell command imports, qualifiers, and dynamic invocation", () => {
  const src = String.raw`. '.\lib\helpers.ps1'
Import-Module -Name .\Widget.psm1
using module .\Extra.psm1
using namespace System.Text
script:Get-Helper
Tools\Get-Helper
& $dynamic
`;
  const edges = extractFile("main.ps1", src, "powershell").rawEdges;
  assert.deepEqual(
    edges.filter((e) => e.relation === "imports").map((e) => e.specifier),
    ["./lib/helpers.ps1", "./Widget.psm1", "./Extra.psm1"],
  );
  assert.deepEqual(
    edges.filter((e) => e.relation === "calls").map((e) => e.name),
    ["Get-Helper", "Get-Helper"],
  );
  assert.ok(edges.every((e) => e.lang === "powershell"), "every PowerShell raw edge carries its language");
});

test("PowerShell nested functions are local while top-level and class defs are exported", () => {
  const { nodes } = extractFile(
    "scope.ps1",
    "function Outer { function Inner {} }\nfilter Pick {}\nworkflow Deploy {}\nclass C { [void] M() {} }\n",
    "powershell",
  );
  const byId = (id: string) => nodes.find((n) => n.id === id);
  assert.equal(byId("scope.ps1#Outer")?.exported, true);
  assert.equal(byId("scope.ps1#Outer.Inner")?.exported, false);
  assert.equal(byId("scope.ps1#Pick")?.kind, "function");
  assert.equal(byId("scope.ps1#Deploy")?.kind, "function");
  assert.equal(byId("scope.ps1#C")?.exported, true);
  assert.equal(byId("scope.ps1#C.M")?.exported, true);
});

test("PowerShell malformed Export-ModuleMember input keeps recoverable definitions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-malformed-"));
  try {
    writeFileSync(
      join(dir, "Broken.psm1"),
      "function Get-A {}\nfunction Get-B {}\nExport-ModuleMember -Function Get-A, Get-B\n",
    );
    const result = await buildGraph(dir);
    assert.deepEqual(result.errors, []);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.equal(nodeById(graph, "Broken.psm1")?.kind, "file");
    assert.equal(nodeById(graph, "Broken.psm1#Get-A")?.kind, "function");
    assert.equal(nodeById(graph, "Broken.psm1#Get-B")?.kind, "function");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell UTF-16LE source is decoded at graph ingest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-utf16-"));
  try {
    const body = Buffer.from("function From-Utf16 {}\n", "utf16le");
    writeFileSync(join(dir, "legacy.ps1"), Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.equal(nodeById(graph, "legacy.ps1#From-Utf16")?.kind, "function");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell handles CRLF, chunked >32KB input, and parser language switching", () => {
  const crlf = extractFile("crlf.ps1", "function From-Crlf {\r\n  Get-Thing\r\n}\r\n", "powershell");
  assert.equal(crlf.nodes.find((n) => n.name === "From-Crlf")?.kind, "function");

  const padding = Array.from({ length: 2400 }, (_, i) => `# padding ${i}`).join("\n");
  const largeSource = `${padding}\nfunction After-Boundary { Get-Thing }\n`;
  assert.ok(largeSource.length > 32_768);
  assert.equal(
    extractFile("large.ps1", largeSource, "powershell").nodes.find((n) => n.name === "After-Boundary")?.kind,
    "function",
  );

  assert.equal(extractFile("a.ts", "export function tsFn() {}", "typescript").nodes.at(-1)?.name, "tsFn");
  assert.equal(extractFile("b.ps1", "function PsFn {}", "powershell").nodes.at(-1)?.name, "PsFn");
  assert.equal(extractFile("c.py", "def py_fn():\n    pass\n", "python").nodes.at(-1)?.name, "py_fn");
});

test("PowerShell extension policy is consistent across graph and context tiers", () => {
  assert.equal(languageOf("x.ps1"), "powershell");
  assert.equal(languageOf("x.PSM1"), "powershell");
  assert.equal(languageOf("x.psd1"), null);
  assert.ok(CODE_EXTENSIONS.includes(".ps1"));
  assert.ok(CODE_EXTENSIONS.includes(".psm1"));
  assert.ok(CODE_EXTENSIONS.includes(".psd1"));
  assert.ok(!IMPORT_EXTS.includes(".psd1"));
});

test("PowerShell function nested inside a class method body stays scope-local", () => {
  const { nodes } = extractFile(
    "nested-method.ps1",
    "class C { [void] M() { function Inner {} } }\n",
    "powershell",
  );
  const byId = (id: string) => nodes.find((n) => n.id === id);
  assert.equal(byId("nested-method.ps1#C.M")?.exported, true, "the method itself is still public");
  assert.equal(byId("nested-method.ps1#C.M.Inner")?.exported, false, "a function nested in a method body is local");
});

test("PowerShell dot-source of a script block or subexpression drops the junk specifier, not the whole edge set", () => {
  const src = String.raw`. { Get-Thing }
. (Join-Path $a b)
. ./helpers.ps1
. "quoted path.ps1"
. "(helpers).ps1"
`;
  const edges = extractFile("dotblock.ps1", src, "powershell").rawEdges;
  assert.deepEqual(
    edges.filter((e) => e.relation === "imports").map((e) => e.specifier),
    ["./helpers.ps1", "quoted path.ps1", "(helpers).ps1"],
    "a dot-sourced block/subexpression must not emit its raw source text as an import specifier, but a quoted " +
      "path is classified by its string_literal node type, not by text starting with `(` after quote-stripping",
  );
  assert.deepEqual(
    edges.filter((e) => e.relation === "calls").map((e) => e.name),
    ["Get-Thing", "Join-Path"],
    "content textually inside a dot-sourced block is still walked for its own calls",
  );
});

test("PowerShell call operator on a static bareword yields a call edge; a variable target still doesn't", () => {
  const edges = extractFile("amp.ps1", "& Get-Helper\n& $dynamic\n", "powershell").rawEdges;
  assert.deepEqual(
    edges.filter((e) => e.relation === "calls").map((e) => e.name),
    ["Get-Helper"],
  );
});

test("PowerShell call operator with a variable-rooted path command name is dynamic, not a call edge", () => {
  const edges = extractFile(
    "amp2.ps1",
    String.raw`& Get-Helper
& script:Get-Helper
& $dir\Get-Helper
`,
    "powershell",
  ).rawEdges;
  assert.deepEqual(
    edges.filter((e) => e.relation === "calls").map((e) => e.name),
    ["Get-Helper", "Get-Helper"],
    "a fully-static bareword or qualified name is a call edge; a $variable\\path is dynamic content, not `Get-Helper`",
  );
});

test("PowerShell name resolution prefers a same-file case-fold over a cross-file exact match", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-scope-"));
  try {
    writeFileSync(join(dir, "a.ps1"), "function foo {}\nfunction Caller {\n  Foo\n}\n");
    writeFileSync(join(dir, "b.ps1"), "function Foo {}\n");
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "a.ps1#Caller", "a.ps1#foo", "calls"),
      "the local case-folded definition must win over a same-name exact match in another file",
    );
    assert.ok(!hasEdge(graph, "a.ps1#Caller", "b.ps1#Foo", "calls"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell typed-member call resolution prefers the local class over a cross-file exact-case match", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-typedscope-"));
  try {
    writeFileSync(
      join(dir, "a.ps1"),
      "class widget {\n  [void] M() {}\n}\nfunction Use-Widget {\n  [widget]$w = [widget]::new()\n  $w.M()\n}\n",
    );
    writeFileSync(join(dir, "b.ps1"), "class Widget {\n  [void] M() {}\n}\n");
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "a.ps1#Use-Widget", "a.ps1#widget.M", "calls"),
      "a typed member call must resolve to the same-file class, mirroring resolveName's local-scope-wins rule",
    );
    assert.ok(!hasEdge(graph, "a.ps1#Use-Widget", "b.ps1#Widget.M", "calls"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell scope-qualified definition name is stripped so a call can link (defect Z1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-scopequal-"));
  try {
    writeFileSync(
      join(dir, "profile.ps1"),
      "function global:Invoke-Thing {}\nfunction Caller {\n  Invoke-Thing\n}\n",
    );
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.equal(
      nodeById(graph, "profile.ps1#Invoke-Thing")?.name,
      "Invoke-Thing",
      "the node's id/name must have the global: qualifier stripped",
    );
    assert.ok(
      hasEdge(graph, "profile.ps1#Caller", "profile.ps1#Invoke-Thing", "calls"),
      "a call site (already qualifier-stripped) must link to the qualifier-stripped def",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell Import-Module specifier is parameter-aware, not 'first non-parameter element' (defect Z2)", () => {
  const noName = extractFile(
    "z2a.ps1",
    "$outputFile | Import-Module -Force -ErrorAction stop\n",
    "powershell",
  ).rawEdges.filter((e) => e.relation === "imports");
  assert.deepEqual(
    noName,
    [],
    "-ErrorAction's own value ('stop') must never be mistaken for the module specifier",
  );

  const named = extractFile("z2b.ps1", "Import-Module -Name ./Mod.psm1\n", "powershell").rawEdges.filter(
    (e) => e.relation === "imports",
  );
  assert.deepEqual(named.map((e) => e.specifier), ["./Mod.psm1"]);

  const positional = extractFile("z2c.ps1", "Import-Module ./Mod.psm1 -Force\n", "powershell").rawEdges.filter(
    (e) => e.relation === "imports",
  );
  assert.deepEqual(
    positional.map((e) => e.specifier),
    ["./Mod.psm1"],
    "a positional specifier before a trailing switch parameter still works",
  );
});

test("PowerShell test-aware tie-break: Pester mocks no longer poison ambiguity for a prod symbol (Z4a)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-testtie-"));
  try {
    writeFileSync(join(dir, "a.ps1"), "function Stop-Function {}\n");
    writeFileSync(join(dir, "Mock1.Tests.ps1"), "function Stop-Function {}\n");
    writeFileSync(join(dir, "Mock2.Tests.ps1"), "function Stop-Function {}\n");
    writeFileSync(join(dir, "b.ps1"), "function Caller {\n  Stop-Function\n}\n");
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "b.ps1#Caller", "a.ps1#Stop-Function", "calls"),
      "a prod caller must link the prod def even though two Pester mocks redeclare the same name (today: dropped as ambiguous)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell test-aware tie-break leaves the LOCAL tier untouched — a test file's own mock still wins locally (Z4b)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-testtie-local-"));
  try {
    writeFileSync(join(dir, "a.ps1"), "function Stop-Function {}\n");
    writeFileSync(
      join(dir, "Mock1.Tests.ps1"),
      "function Stop-Function {}\nfunction Test-It {\n  Stop-Function\n}\n",
    );
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "Mock1.Tests.ps1#Test-It", "Mock1.Tests.ps1#Stop-Function", "calls"),
      "the same-file local mock must still win — demotion only ever touches the two global tiers",
    );
    assert.ok(!hasEdge(graph, "Mock1.Tests.ps1#Test-It", "a.ps1#Stop-Function", "calls"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell test-aware tie-break regression guard: a symbol living only under tests/ still resolves for a non-test caller (Z4c)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-testtie-emptyset-"));
  try {
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "tests", "Helpers.psm1"), "function Get-Fixture {}\n");
    writeFileSync(join(dir, "build.ps1"), "function Build {\n  Get-Fixture\n}\n");
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "build.ps1#Build", "tests/Helpers.psm1#Get-Fixture", "calls"),
      "empty-set fallback: demotion must never remove the last remaining candidate",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell builtin cmdlet denylist: a Pester mock never absorbs a prod call to a core cmdlet (Z5)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-builtin-"));
  try {
    writeFileSync(join(dir, "Mock.Tests.ps1"), "function Get-ChildItem {}\n");
    writeFileSync(join(dir, "prod.ps1"), "function List-Things {\n  Get-ChildItem\n}\n");
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      !hasEdge(graph, "prod.ps1#List-Things", "Mock.Tests.ps1#Get-ChildItem", "calls"),
      "a core cmdlet name must never wire to an in-repo mock def, even the sole one in the repo",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell builtin cmdlet denylist only guards the global tiers — a same-file redefinition still self-links (Z5)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-builtin-local-"));
  try {
    writeFileSync(
      join(dir, "wrapper.ps1"),
      "function Get-ChildItem {\n  Write-Host 'shadowed'\n}\nfunction Use-It {\n  Get-ChildItem\n}\n",
    );
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "wrapper.ps1#Use-It", "wrapper.ps1#Get-ChildItem", "calls"),
      "a file that locally redefines a builtin cmdlet name must still self-link — the denylist only guards the global tiers",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell builtin cmdlet denylist does not affect a non-cmdlet name like Stop-Function (Z5)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-builtin-notaffected-"));
  try {
    writeFileSync(join(dir, "a.ps1"), "function Stop-Function {}\n");
    writeFileSync(join(dir, "b.ps1"), "function Caller {\n  Stop-Function\n}\n");
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "b.ps1#Caller", "a.ps1#Stop-Function", "calls"),
      "Stop-Function is not a builtin cmdlet and must resolve normally",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerShell unquoted forward-slash dot-source ($PSScriptRoot/Utils.ps1) emits an edge; a bare member access doesn't (Z3b)", () => {
  const scriptRootEdges = extractFile(
    "z3b-a.ps1",
    ". $PSScriptRoot/Utils.ps1\n",
    "powershell",
  ).rawEdges.filter((e) => e.relation === "imports");
  assert.deepEqual(
    scriptRootEdges.map((e) => e.specifier),
    ["$PSScriptRoot/Utils.ps1"],
    "the unquoted POSIX-separator form must emit the same raw-variable-path specifier the backslash twin already produces",
  );

  const objMethodEdges = extractFile("z3b-b.ps1", ". $obj.Method\n", "powershell").rawEdges.filter(
    (e) => e.relation === "imports",
  );
  assert.deepEqual(objMethodEdges, [], "a bare $obj.Method member access (no slash) must stay rejected");
});

test("PowerShell $PSScriptRoot literal resolves relative to the defining file's directory (Z3, Z3c)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-scriptroot-"));
  try {
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, "Common"));
    mkdirSync(join(dir, "sub", "Modules", "Foo"), { recursive: true });
    writeFileSync(join(dir, "sub", "Utils.ps1"), "function Get-Util {}\n");
    writeFileSync(join(dir, "Common", "Utils.ps1"), "function Get-Common {}\n");
    writeFileSync(join(dir, "sub", "Mod.psm1"), "function Get-Mod {}\n");
    writeFileSync(join(dir, "sub", "Modules", "Foo", "Foo.psm1"), "function Get-Foo {}\n");
    writeFileSync(
      join(dir, "sub", "main.ps1"),
      String.raw`. "$PSScriptRoot\Utils.ps1"
. "$PSScriptRoot\..\Common\Utils.ps1"
Import-Module "$PSScriptRoot\Mod.psm1"
Import-Module "$PSScriptRoot\Modules\Foo"
. "$PSScriptRoot\Missing.ps1"
`,
    );
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "sub/main.ps1", "sub/Utils.ps1", "imports"),
      "a sibling $PSScriptRoot dot-source resolves",
    );
    assert.ok(
      hasEdge(graph, "sub/main.ps1", "Common/Utils.ps1", "imports"),
      "$PSScriptRoot\\..\\ traversal resolves across directories",
    );
    assert.ok(
      hasEdge(graph, "sub/main.ps1", "sub/Mod.psm1", "imports"),
      "Import-Module $PSScriptRoot resolves",
    );
    assert.ok(
      hasEdge(graph, "sub/main.ps1", "sub/Modules/Foo/Foo.psm1", "imports"),
      "Z3c: the PS directory-module convention (Modules/Foo -> Modules/Foo/Foo.psm1) is tried for extensionless PS specifiers",
    );
    assert.ok(
      hasEdge(graph, "sub/main.ps1", "$PSScriptRoot/Missing.ps1", "imports"),
      "an unresolvable $PSScriptRoot specifier keeps the ORIGINAL raw text, not a mangled ./ rewrite",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extensionless import resolution is language-aware: PS prefers its own module files, TS never falls into them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-powershell-importext-"));
  try {
    writeFileSync(join(dir, "Widget.psm1"), "function Get-Widget {}\n");
    writeFileSync(join(dir, "Widget.ts"), "export function getWidget() {}\n");
    writeFileSync(join(dir, "OnlyPs.psm1"), "function Get-OnlyPs {}\n");
    writeFileSync(join(dir, "main.ps1"), "Import-Module ./Widget\n");
    writeFileSync(join(dir, "main.ts"), 'import "./Widget";\nimport "./OnlyPs";\n');
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;
    assert.ok(
      hasEdge(graph, "main.ps1", "Widget.psm1", "imports"),
      "PS Import-Module ./Widget must resolve to the .psm1 sibling, not the same-named .ts",
    );
    assert.ok(
      hasEdge(graph, "main.ts", "Widget.ts", "imports"),
      "TS import ./Widget must resolve to the .ts sibling",
    );
    assert.ok(
      hasEdge(graph, "main.ts", "./OnlyPs", "imports"),
      "TS import of a PS-only module must stay unresolved (raw specifier), not fall into the .psm1",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
