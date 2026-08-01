/**
 * A5 (V4) — a workspace build's `--include-dir` must reach the children.
 *
 * `runWorkspaceBuild` builds each child through its own `Graft` engine
 * (`workspace-cli.ts`), then `splitWorkspace` deletes the PARENT's entire
 * `graft/` (including any just-persisted include-dir state — see
 * `clearParentGraft`'s doc comment) and replaces it with `workspace.json`.
 * Without threading the CLI's `--include-dir` value into
 * `runWorkspaceBuild`/`buildChild`, a workspace build had no way to see it —
 * and even if it had persisted state at the parent, that state is exactly
 * what gets deleted moments later. Children are independent repos with their
 * own graft state, so the fix persists the include list in EACH CHILD's own
 * state instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkspaceBuild } from "../src/graph/workspace-cli.js";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1 } from "../src/graph/types.js";

function workspaceWithBuildDirs(): string {
  const parent = mkdtempSync(join(tmpdir(), "ws-include-dir-"));
  for (const child of ["repoA", "repoB"]) {
    mkdirSync(join(parent, child, ".git"), { recursive: true });
    mkdirSync(join(parent, child, "build"), { recursive: true });
    writeFileSync(join(parent, child, "build", "util.ts"), "export function fromBuild(): number {\n  return 1;\n}\n");
    writeFileSync(join(parent, child, "main.ts"), "export function main(): number {\n  return 2;\n}\n");
  }
  return parent;
}

function graphOf(childDir: string): GraphV1 | null {
  return readGraph(wiringPath(join(childDir, "graft")));
}

test("A5: --include-dir on a workspace build reaches every child, which persists it for a later no-flag rebuild", async () => {
  const parent = workspaceWithBuildDirs();
  try {
    await runWorkspaceBuild(parent, { deep: false, childConfig: {}, includeDirs: ["build"] });

    for (const child of ["repoA", "repoB"]) {
      const g = graphOf(join(parent, child));
      assert.ok(g, `expected a built graph for ${child}`);
      assert.ok(
        g!.nodes.some((n) => n.id === "build/util.ts#fromBuild"),
        `${child}'s build/ file must be indexed with --include-dir`,
      );
    }

    // A later no-flag rebuild of a single child (never sees the parent's CLI
    // invocation at all, let alone its flags) must still include build/ —
    // proof the child persisted the override in ITS OWN state, not the
    // parent's (which splitWorkspace deletes right after the build).
    await buildGraph(join(parent, "repoA"));
    const rebuilt = graphOf(join(parent, "repoA"));
    assert.ok(rebuilt);
    assert.ok(
      rebuilt!.nodes.some((n) => n.id === "build/util.ts#fromBuild"),
      "child's own persisted include-dir state must survive a no-flag rebuild",
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
