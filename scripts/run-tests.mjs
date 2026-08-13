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
 *
 * The runner also forwards its own arguments, because "run one file" used to cost
 * the whole suite: ~50 files, several of which spawn the real CLI or the MCP
 * server as a subprocess, is over a minute per edit. `npm test -- graph-map`
 * (or `-- test/graph-map.test.ts`, or `-- graph --test-name-pattern=posix`)
 * narrows the run; with no arguments the behaviour is exactly what CI has always
 * done — every file, sorted.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(repoRoot, "test");

// Node's test flags that take their value as a SEPARATE argv entry. Without this
// list `--test-name-pattern posix` would leave "posix" looking like a file
// selector, and the runner would refuse to start over an argument the user
// meant for Node.
const FLAGS_TAKING_A_VALUE = new Set([
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-concurrency",
  "--test-shard",
  "--test-timeout",
]);

/**
 * Split the runner's own argv into node flags and test-file selectors, then
 * resolve the selectors against the files on disk.
 *
 * Selectors are matched most-specific-first — full path, then file name, then
 * name without the `.test.ts` suffix, and only then a substring — so
 * `graph-map` picks exactly `graph-map.test.ts` even though `graph-map` is also
 * a substring of nothing else, while a loose `graph` still fans out to the whole
 * graph family. Returns `{ error }` instead of exiting so this stays testable.
 */
export function planRun(argv, allFiles) {
  const nodeArgs = [];
  const selectors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // A bare `--` is npm's own separator leaking through on some shells.
    if (a === "--") continue;
    if (a.startsWith("-")) {
      nodeArgs.push(a);
      if (FLAGS_TAKING_A_VALUE.has(a) && i + 1 < argv.length) nodeArgs.push(argv[++i]);
      continue;
    }
    selectors.push(a);
  }

  if (selectors.length === 0) return { files: allFiles, nodeArgs };

  const files = [];
  for (const sel of selectors) {
    const norm = sel.replace(/\\/g, "/");
    const byPath = allFiles.filter((f) => f.replace(/\\/g, "/").endsWith(norm));
    const byName = allFiles.filter((f) => basename(f) === norm || basename(f) === `${norm}.test.ts`);
    const chosen = byName.length ? byName
      : byPath.length ? byPath
      : allFiles.filter((f) => basename(f).includes(norm));
    if (chosen.length === 0) return { error: `no test file matches '${sel}'` };
    for (const f of chosen) if (!files.includes(f)) files.push(f);
  }
  // Keep the deterministic order of the full run rather than the order the user
  // happened to type the selectors in.
  return { files: allFiles.filter((f) => files.includes(f)), nodeArgs };
}

// Sorted so a failure is reported in the same order on every platform and run.
const allFiles = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join(testDir, f));

// Importing this module (the arg-parsing test does) must not run the suite.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (allFiles.length === 0) {
    console.error(`✗ no test files found in ${testDir}`);
    process.exit(1);
  }

  const plan = planRun(process.argv.slice(2), allFiles);
  if (plan.error) {
    console.error(`✗ ${plan.error}`);
    console.error(`  available: ${allFiles.map((f) => basename(f, ".test.ts")).join(", ")}`);
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...plan.nodeArgs, ...plan.files],
    { cwd: repoRoot, stdio: "inherit" },
  );

  if (result.error) {
    console.error(`✗ could not start the test runner: ${result.error.message}`);
    process.exit(1);
  }
  // A signal-killed run reports null status; treat anything non-zero as failure.
  process.exit(result.status ?? 1);
}
