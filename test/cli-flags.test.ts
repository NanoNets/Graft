/**
 * Flag handling at the CLI boundary: the checks that decide whether a command
 * refuses, warns, or quietly does the wrong thing.
 *
 * Every case here used to end in a plausible-looking success. A bad `-n` produced
 * an empty result list annotated "no matching nodes — try different words", which
 * blames the query. `graft init` with nothing to write exited 0, so a scripted
 * `graft init && …` carried on as if the repo were wired. `-e` was validated against
 * a wider set than the one it is applied against, so an extension could pass the
 * check and still filter the pass it reaches down to nothing. And a persisted
 * `--include-dir` could be written but never unwritten.
 *
 * Driven through the real CLI because that is where all of it lives — these are
 * argument-parsing decisions, not library behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, tmpRepo } from "./helpers.js";

/** A repo with one trivially parseable file, so a real build stays cheap. */
function tinyRepo(tag: string): string {
  const d = tmpRepo(tag);
  writeFileSync(join(d, "main.ts"), "export function main(): number {\n  return 1;\n}\n");
  return d;
}

// --- ask -n/--limit -----------------------------------------------------------

test("ask rejects a non-numeric -n instead of answering 'no matching nodes'", () => {
  const r = runCli(["ask", "anything", tinyRepo("limit"), "-n", "all", "--no-refresh"]);
  assert.equal(r.status, 1, r.describe());
  assert.match(r.stderr, /-n\/--limit must be a positive integer, got "all"/, r.describe());
});

test("ask rejects -n 0 and -n -1, which silently returned nothing", () => {
  // `slice(0, 0)` and `slice(0, -1)` are both empty or wrong, and `ask`'s `?? 8`
  // guard covers neither — only null/undefined.
  for (const n of ["0", "-1"]) {
    const r = runCli(["ask", "anything", tinyRepo("limit"), "-n", n, "--no-refresh"]);
    assert.equal(r.status, 1, r.describe());
    assert.match(r.stderr, /must be a positive integer/, r.describe());
  }
});

test("a valid -n is not rejected", () => {
  // The repo has no graph, so this still fails — but on the graph, not the flag.
  const r = runCli(["ask", "anything", tinyRepo("limit"), "-n", "3", "--no-refresh"]);
  assert.doesNotMatch(r.stderr, /--limit/, r.describe());
});

// --- build -e/--extensions ----------------------------------------------------

// `-e` is variadic, so the directory argument goes FIRST in these — otherwise it
// is swallowed as another extension.

test("-e warns for an extension the --deep pass cannot read, even one the wiring graph indexes", () => {
  // `.zig` has a breadth-tier grammar, so it passed the old check against
  // `supportedExtensions()` — and was then filtered out by `CODE_EXTENSIONS`, the
  // list `-e` is actually matched against, with nothing said.
  const r = runCli(["check", tinyRepo("ext"), "-e", ".zig"]);
  assert.match(r.stderr, /-e "\.zig"/, r.describe());
  assert.match(r.stderr, /--deep/, r.describe());
});

test("-e stays quiet for an extension the pass does read", () => {
  const r = runCli(["check", tinyRepo("ext"), "-e", ".ts", ".py"]);
  assert.doesNotMatch(r.stderr, /⚠ -e/, r.describe());
});

test("-e narrows the wiring graph, survives a query's refresh, and can be cleared", () => {
  const d = tmpRepo("ext-persist");
  writeFileSync(join(d, "main.ts"), "export function main(): number {\n  return 1;\n}\n");
  writeFileSync(join(d, "helper.py"), "def helper():\n    return 2\n");
  const nodePaths = () => {
    const g = JSON.parse(readFileSync(join(d, "graft", ".graph", "wiring.json"), "utf8"));
    return (g.nodes as { path: string }[]).map((n) => n.path);
  };

  const narrowed = runCli(["build", d, "-e", ".ts"]);
  assert.equal(narrowed.status, 0, narrowed.describe());
  assert.ok(!nodePaths().some((p) => p.endsWith(".py")), "the flag says 'only include these extensions'");
  assert.deepEqual(JSON.parse(readFileSync(join(d, ".graft", "config.json"), "utf8")).extensions, [".ts"]);

  // The reason it is persisted rather than a one-shot filter: the freshness probe
  // and the pre-query refresh never see a flag, so an unpersisted narrowing lasted
  // exactly until the first query, which rebuilt the graph wide again.
  const asked = runCli(["ask", "main", d]);
  assert.equal(asked.status, 0, asked.describe());
  assert.ok(!nodePaths().some((p) => p.endsWith(".py")), "a query must not silently widen the graph");

  // …and `graft check` reads the same narrowing, so the excluded files are not
  // reported as drift no `graft build` would ever fix.
  const checked = runCli(["check", d]);
  assert.equal(checked.status, 0, checked.describe());

  // The way back out, announced while it is in force (same shape as --include-dir).
  assert.match(runCli(["build", d]).stderr, /-e narrowing active: only \.ts/);
  const cleared = runCli(["build", d, "--no-extensions"]);
  assert.equal(cleared.status, 0, cleared.describe());
  assert.match(cleared.stderr, /cleared this repo's persisted -e/, cleared.describe());
  assert.ok(nodePaths().some((p) => p.endsWith(".py")), "everything is indexed again");
});

// --- a typo'd [dir] -----------------------------------------------------------

test("a [dir] that does not exist is refused before anything is written to it", () => {
  const missing = join(tmpRepo("dir-typo"), "typo");
  // The walk validates this too, but it runs LAST: `writeBuildConfig` mkdir's
  // recursively, so the typo used to create `typo/.graft/config.json` and only
  // then report that `typo` does not exist.
  const r = runCli(["build", missing, "--include-dir", "build"]);
  assert.equal(r.status, 1, r.describe());
  assert.match(r.stderr, /no such directory/, r.describe());
  assert.equal(existsSync(missing), false, r.describe());

  const c = runCli(["check", missing]);
  assert.equal(c.status, 1, c.describe());
  assert.match(c.stderr, /no such directory/, c.describe());

  const i = runCli(["init", missing, "--yes", "--no-build"], { home: tmpRepo("dir-typo-home") });
  assert.equal(i.status, 1, i.describe());
  assert.match(i.stderr, /no such directory/, i.describe());
  assert.equal(existsSync(missing), false, i.describe());
});

// --- --max-budget-usd ---------------------------------------------------------

test("--max-budget-usd is accepted as a flag and rejects a value that would disable it", () => {
  // The ceiling existed only as GRAFT_CLAUDE_MAX_BUDGET_USD, which is the wrong
  // shape for a per-run valve — it is a property of this invocation, like -j.
  const ok = runCli(["--max-budget-usd", "5", "build", tinyRepo("budget-ok")]);
  assert.equal(ok.status, 0, ok.describe());

  for (const bad of ["abc", "0", "-2"]) {
    const r = runCli(["--max-budget-usd", bad, "build", tinyRepo("budget-bad")]);
    assert.equal(r.status, 1, r.describe());
    // `NaN` would silently mean "no ceiling" and `0` means "no budget" to the
    // Claude CLI, not "spend nothing" — both surface hours later, if at all.
    assert.match(r.stderr, /max-budget-usd/, r.describe());
  }
});

// --- build's exit code --------------------------------------------------------

test("build exits non-zero when it printed errors, and 0 when it printed none", () => {
  const clean = runCli(["build", tinyRepo("exit-clean")]);
  assert.equal(clean.status, 0, clean.describe());

  const d = tinyRepo("exit-err");
  // A directory where the ask sidecar's file goes: `writeFileSync` cannot open it,
  // which is one of the recoverable failures `buildGraph` collects into `errors`
  // instead of throwing. Any of them would do — this one is deterministic on every
  // platform, unlike an unreadable file or a mid-build deletion.
  mkdirSync(join(d, "graft", ".cache", "ask-index.json"), { recursive: true });

  const r = runCli(["build", d]);
  // Those `✗` lines are files that never reached the graph, or summaries the model
  // never returned. Exiting 0 anyway meant CI, `graft build && …`, and the init
  // path all read an incomplete graph as a clean build.
  assert.equal(r.status, 1, r.describe());
  assert.match(r.stderr, /ask-index:/, r.describe());
  assert.match(r.stderr, /1 error\(s\)/, r.describe());
  // Still a partial build, not an abort: what did work is on disk.
  assert.ok(existsSync(join(d, "graft", ".graph", "wiring.json")), r.describe());
});

// --- build --include-dir ------------------------------------------------------

test("--include-dir can be cleared again, and says so while it is in force", () => {
  const d = tinyRepo("incl");
  const cfg = join(d, ".graft", "config.json");

  const set = runCli(["build", d, "--include-dir", "build"]);
  assert.equal(set.status, 0, set.describe());
  assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")).includeDirs, ["build"]);
  // Persisted overrides govern every later build and every hooks-driven refresh,
  // so a build under one has to admit it — the flag may have been typed months ago.
  assert.match(set.stderr, /--include-dir override active: build/, set.describe());

  const cleared = runCli(["build", d, "--no-include-dir"]);
  assert.equal(cleared.status, 0, cleared.describe());
  // Before this existed, no invocation could write the empty list: the only way
  // out was hand-editing a file nothing told you about.
  assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")).includeDirs, []);
  assert.match(cleared.stderr, /cleared/, cleared.describe());
  assert.doesNotMatch(cleared.stderr, /override active/, cleared.describe());
});

test("--include-dir rejects an empty name instead of persisting inert junk", () => {
  const d = tinyRepo("incl-empty");
  const r = runCli(["build", d, "--include-dir", ""]);
  assert.equal(r.status, 1, r.describe());
  assert.match(r.stderr, /--include-dir/, r.describe());
  // No path segment can ever equal "", so `[""]` would have sat in the config
  // file forever doing nothing.
  assert.equal(existsSync(join(d, ".graft", "config.json")), false, r.describe());
});

// --- init's do-nothing paths --------------------------------------------------

test("init without a TTY and without --agents fails instead of exiting 0", () => {
  const home = tmpRepo("init-home");
  const r = runCli(["init", tinyRepo("init"), "--no-build"], { home });
  // Not exotic: in Git Bash / MSYS without winpty `stdin.isTTY` is false, so a
  // plain interactive `graft init` lands here. Exiting 0 made `graft init && …`
  // carry on as though the repo had been wired.
  assert.equal(r.status, 1, r.describe());
  assert.match(r.stderr, /no TTY to prompt on/, r.describe());
});

// The other two nothing-written paths — a cancelled picker and an empty selection —
// are reachable only from the interactive picker, which needs a raw-mode TTY that a
// piped child process cannot provide. They carry the same `process.exitCode = 1`.

test("--dry-run and --list-agents still succeed — they were asked a question", () => {
  const home = tmpRepo("init-home");
  const dry = runCli(["init", tinyRepo("init"), "--dry-run"], { home });
  assert.equal(dry.status, 0, dry.describe());
  const list = runCli(["init", "--list-agents"], { home });
  assert.equal(list.status, 0, list.describe());
});
