/**
 * The test runner's own argument handling. Before this, `npm test` ignored
 * process.argv entirely: `npm test -- test/graph-map.test.ts` and
 * `--test-name-pattern=…` both silently ran all ~50 files, several of which spawn
 * the real CLI or the MCP server per case, so the cheapest possible edit-test loop
 * cost the full suite. The regression to protect against is subtle in both
 * directions — forgetting to forward node's flags, or mistaking a flag's value for
 * a file name — so both are asserted here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { planRun } from "../scripts/run-tests.mjs";

// A stand-in for readdirSync's output, so this test does not change meaning when
// a test file is added or renamed.
const ALL = ["claude-paths.test.ts", "graph-map.test.ts", "graph-posix-paths.test.ts", "paths.test.ts"].map(
  (f) => join("test", f),
);
const names = (r: { files?: string[] }): string[] => (r.files ?? []).map((f) => basename(f));

test("no arguments runs every file, unchanged", () => {
  const plan = planRun([], ALL);
  assert.deepEqual(plan.files, ALL);
  assert.deepEqual(plan.nodeArgs, []);
});

test("a bare name selects exactly that file", () => {
  // "paths" must not fan out to claude-paths/graph-posix-paths: an exact
  // <name>.test.ts match wins over the substring pass.
  assert.deepEqual(names(planRun(["paths"], ALL)), ["paths.test.ts"]);
  assert.deepEqual(names(planRun(["graph-map"], ALL)), ["graph-map.test.ts"]);
});

test("a path or file name selects that file", () => {
  assert.deepEqual(names(planRun(["graph-map.test.ts"], ALL)), ["graph-map.test.ts"]);
  assert.deepEqual(names(planRun(["test/graph-map.test.ts"], ALL)), ["graph-map.test.ts"]);
  // Backslashes, because on Windows tab-completion hands you `test\graph-map.test.ts`.
  assert.deepEqual(names(planRun(["test\\graph-map.test.ts"], ALL)), ["graph-map.test.ts"]);
});

test("a loose fragment fans out, in the suite's own order", () => {
  assert.deepEqual(names(planRun(["graph"], ALL)), ["graph-map.test.ts", "graph-posix-paths.test.ts"]);
  // Order follows the sorted full run, not the order the selectors were typed.
  assert.deepEqual(names(planRun(["paths", "graph-map"], ALL)), ["graph-map.test.ts", "paths.test.ts"]);
});

test("node flags are forwarded, not treated as selectors", () => {
  const plan = planRun(["graph-map", "--test-name-pattern=posix", "--test-only"], ALL);
  assert.deepEqual(names(plan), ["graph-map.test.ts"]);
  assert.deepEqual(plan.nodeArgs, ["--test-name-pattern=posix", "--test-only"]);
});

test("a flag's separate value is not mistaken for a file name", () => {
  // `--test-name-pattern posix` (space form): without the value-taking-flag list,
  // "posix" would look like a selector and the run would abort.
  const plan = planRun(["--test-name-pattern", "posix", "graph-map"], ALL);
  assert.deepEqual(plan.nodeArgs, ["--test-name-pattern", "posix"]);
  assert.deepEqual(names(plan), ["graph-map.test.ts"]);
});

test("npm's own `--` separator is ignored", () => {
  assert.deepEqual(names(planRun(["--", "graph-map"], ALL)), ["graph-map.test.ts"]);
});

test("a selector that matches nothing is an error, not a full run", () => {
  const plan = planRun(["nope"], ALL);
  assert.match(String(plan.error), /no test file matches 'nope'/);
  assert.equal(plan.files, undefined);
});
