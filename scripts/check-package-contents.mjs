/**
 * Asserts the publishable tarball actually carries the runtime assets that tsc
 * does not emit.
 *
 *   node scripts/check-package-contents.mjs [--json]
 *
 * Why this exists: the generic (breadth) tier's `.scm` queries and the viewer
 * bundle are produced by scripts/build-viewer.mjs, not by tsc, and their absence
 * is SILENT. src/graph/generic.ts resolves `dist/graph/queries` first and falls
 * back to `src/graph/queries`, so anything running from a checkout (every test,
 * every dev run) finds the query even when dist/ never got it — and an installed
 * user gets `loadQuery() -> null`, a skipped grammar and, per generic.ts, a
 * "file node only (never throws)". The whole breadth tier can vanish from a
 * published release without one error line. Same class of failure for
 * dist/viewer/app.js, which `graft viz` serves.
 *
 * So: read the file list npm would publish and require those assets by name,
 * plus one .scm per query in src/graph/queries — a partial copy is as broken as
 * no copy, and only a parity check catches it.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Entries every tarball must contain regardless of what is in src/. */
export const REQUIRED_FILES = [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/viewer/app.js",
  "dist/viewer/index.html",
  "dist/viewer/style.css",
];

/**
 * Which required entries are missing from `packedFiles` (posix paths, as
 * `npm pack --json` reports them). `queryNames` is the list of .scm files that
 * exist in src/graph/queries; each must have a dist/graph/queries twin.
 * Pure, so the test can drive it with a hand-built file list.
 */
export function missingFromPack(packedFiles, queryNames) {
  const have = new Set(packedFiles.map((f) => f.replace(/\\/g, "/")));
  const missing = REQUIRED_FILES.filter((f) => !have.has(f));
  for (const q of queryNames) {
    const want = `dist/graph/queries/${q}`;
    if (!have.has(want)) missing.push(want);
  }
  return missing;
}

/** The .scm queries the breadth tier expects to find at runtime. */
export function queryFileNames(root = repoRoot) {
  return readdirSync(join(root, "src", "graph", "queries")).filter((f) => f.endsWith(".scm")).sort();
}

/** `npm pack --dry-run --json` file list, without writing a tarball. */
export function packedFileList(root = repoRoot) {
  // `--ignore-scripts` so this never re-triggers `prepare` (a full rebuild) just
  // to ask npm what it would ship; CI builds before calling us.
  // `shell: true` on Windows only: since the CVE-2024-27980 fix, execFile refuses
  // to spawn a `.cmd` (npm is npm.cmd there) without a shell and dies with EINVAL.
  // The argv is a fixed literal, so there is nothing to inject.
  const out = execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" },
  );
  // npm can prefix notices before the JSON payload; take the array.
  const start = out.indexOf("[");
  const parsed = JSON.parse(out.slice(start));
  return (parsed[0]?.files ?? []).map((f) => f.path.replace(/\\/g, "/"));
}

function main() {
  const files = packedFileList();
  const missing = missingFromPack(files, queryFileNames());
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ files: files.length, missing }, null, 2));
  } else {
    console.log(`package contents — ${files.length} files`);
    for (const m of missing) console.log(`  ✗ missing ${m}`);
  }
  if (missing.length) {
    console.error(`✗ ${missing.length} runtime asset(s) missing from the tarball — run \`npm run build\``);
    process.exit(1);
  }
  console.log("  runtime assets: OK ✓");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
