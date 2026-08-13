/**
 * Python imports resolving to in-repo modules.
 *
 * They were being run through the JS resolver, which is nonsense for every Python
 * spelling there is: `posix.join("app", ".utils")` is `"app/.utils"`, so every
 * candidate path it built was one that cannot exist and the resolver always fell
 * through to "external string". Since `collectImportedSymbols` is TS-only there were
 * no `references` edges either — meaning a Python repo's graph had containment and
 * intra-file calls and NOT ONE edge between two files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractFile } from "../src/graph/extract.js";
import { resolveEdges } from "../src/graph/resolve.js";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { NodeV1 } from "../src/graph/types.js";
import type { RawEdge } from "../src/graph/extract.js";
import { tmpRepo } from "./helpers.js";

/** Extract a whole fixture repo of .py files and resolve its edges. */
function graphOf(files: Record<string, string>) {
  const nodes: NodeV1[] = [];
  const raw: RawEdge[] = [];
  for (const [rel, src] of Object.entries(files)) {
    const r = extractFile(rel, src, "python");
    nodes.push(...r.nodes);
    raw.push(...r.rawEdges);
  }
  return resolveEdges(nodes, raw);
}

const PKG: Record<string, string> = {
  "app/__init__.py": "",
  "app/core/__init__.py": "",
  "app/core/db.py": "def connect():\n    return 1\n",
  "app/utils.py": "def helper():\n    return 2\n",
  "app/services/__init__.py": "",
  "app/services/mailer.py": "def send():\n    return 3\n",
  "app/services/orders.py": [
    "from .mailer import send",        // sibling module in this package
    "from ..utils import helper",      // one package up
    "from ..core.db import connect",   // one package up, then down a package
    "from . import mailer",            // the package itself
    "from app.core import db",         // absolute, by dotted path
    "import app.utils",                // absolute `import a.b`
    "import os",                       // stdlib — nothing in-repo to point at
    "from third_party.thing import x", // external
    "",
  ].join("\n"),
};

test("relative Python imports resolve to the module files they name", () => {
  const targets = graphOf(PKG)
    .filter((e) => e.relation === "imports" && e.source === "app/services/orders.py")
    .map((e) => e.target)
    .sort();

  assert.ok(targets.includes("app/services/mailer.py"), "`from .mailer import send` → the sibling module");
  assert.ok(targets.includes("app/utils.py"), "`from ..utils import helper` → one package up");
  assert.ok(targets.includes("app/core/db.py"), "`from ..core.db import connect` → up then down");
  assert.ok(
    targets.includes("app/services/__init__.py"),
    "`from . import mailer` names this package, whose file is its __init__.py",
  );
});

test("absolute Python imports resolve by path suffix, since the sys.path root is unknown", () => {
  const targets = graphOf(PKG)
    .filter((e) => e.relation === "imports" && e.source === "app/services/orders.py")
    .map((e) => e.target);

  assert.ok(targets.includes("app/core/__init__.py"), "`from app.core import db` names the package");
  assert.ok(targets.includes("app/utils.py"), "`import app.utils` names the module");
  // Nothing in-repo is called `os` or `third_party`, so both stay raw strings — the
  // resolver must never invent a file for an out-of-repo module.
  assert.ok(targets.includes("os"), "stdlib stays an external string");
  assert.ok(targets.includes("third_party.thing"), "a third-party module stays an external string");
});

test("a relative import that climbs past the repo root stays a string, never a guess", () => {
  const edges = graphOf({
    "a.py": "def f():\n    return 1\n",
    "b.py": "from ...way.up import thing\n",
  });
  const targets = edges.filter((e) => e.relation === "imports" && e.source === "b.py").map((e) => e.target);
  assert.deepEqual(targets, ["...way.up"]);
});

test("an ambiguous absolute module suffix is dropped rather than guessed", () => {
  // Two in-repo files can end in `shared/conf.py`; nothing in `import shared.conf`
  // says which, so — exactly like the Java and PHP resolvers — it stays a string.
  const edges = graphOf({
    "svc_a/shared/conf.py": "X = 1\n",
    "svc_b/shared/conf.py": "X = 2\n",
    "main.py": "import shared.conf\n",
  });
  const targets = edges.filter((e) => e.relation === "imports" && e.source === "main.py").map((e) => e.target);
  assert.deepEqual(targets, ["shared.conf"]);
});

test("a built Python repo has real file→file import edges", async () => {
  const d = tmpRepo("py-imports-");
  mkdirSync(join(d, "app", "core"), { recursive: true });
  writeFileSync(join(d, "app", "__init__.py"), "");
  writeFileSync(join(d, "app", "core", "__init__.py"), "");
  writeFileSync(join(d, "app", "core", "db.py"), "def connect():\n    return 1\n");
  writeFileSync(join(d, "app", "main.py"), "from .core.db import connect\n\n\ndef run():\n    return connect()\n");

  await buildGraph(d, { reuse: false });
  const graph = readGraph(wiringPath(join(d, "graft")))!;
  assert.ok(
    graph.edges.some(
      (e) => e.source === "app/main.py" && e.target === "app/core/db.py" && e.relation === "imports",
    ),
    `main.py must import core/db.py (got ${JSON.stringify(graph.edges.filter((e) => e.relation === "imports"))})`,
  );
});
