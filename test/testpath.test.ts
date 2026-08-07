import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestPath } from "../src/util/testpath.js";

// Pinning table for the path-classification rules Z4's resolveName demotion relies
// on (a hard graph-topology input, not just ask's soft rank-penalty) — locks down
// today's exact behavior, including a documented known under-fit, so a future edit
// to the regex can't silently change graph resolution without a test catching it.
test("isTestPath pinning table: PowerShell test-dir/suffix conventions vs a known under-fit", () => {
  assert.equal(isTestPath("tests/x.Tests.ps1"), true, "a tests/ directory is a test path");
  assert.equal(isTestPath("Tests/Unit/y.Tests.ps1"), true, "case-insensitive, and nested under the test dir");
  assert.equal(
    isTestPath("tst/z.ts.ps1"),
    false,
    "known under-fit: the abbreviated 'tst' directory name isn't recognized",
  );
  assert.equal(isTestPath("functions/Stop-Function.ps1"), false, "a plain prod path is never a test path");
});
