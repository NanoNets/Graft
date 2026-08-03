/**
 * Runs the test suite without depending on shell glob expansion.
 *
 * `node --test test/*.test.ts` needs the *shell* to expand that glob, and on
 * Windows nothing does: npm runs scripts through `cmd.exe` regardless of the
 * shell that invoked npm, and Node's `--test` only accepts glob patterns itself
 * from Node 21 (this package supports >=20). The literal pattern reaches Node as
 * a filename and it exits with `Could not find '…\test\*.test.ts'` — so the
 * Windows CI leg reported failure while actually running zero tests.
 *
 * Enumerating the files here instead means `npm test` behaves identically in
 * cmd.exe, PowerShell, bash and CI, on any supported Node.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(repoRoot, "test");

// Sorted so a failure is reported in the same order on every platform and run.
const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join(testDir, f));

if (files.length === 0) {
  console.error(`✗ no test files found in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(`✗ could not start the test runner: ${result.error.message}`);
  process.exit(1);
}
// A signal-killed run reports null status; treat anything non-zero as failure.
process.exit(result.status ?? 1);
