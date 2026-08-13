/**
 * Asserts no shipped dependency demands a newer Node than this package promises.
 *
 *   node scripts/check-engines.mjs [--json]
 *
 * The bug this exists to prevent shipped once already: package.json promised
 * `"node": ">=20"` while `commander@15` (a direct, top-of-cli import) declared
 * `>=22.12.0`, and the only Node the matrix ever ran was 20 — so the one
 * combination CI validated was the one npm marks unsupported. Users on Node 20
 * got EBADENGINE on `npm i -g @nanonets/graft`, and an .npmrc with
 * `engine-strict=true` (common in corporate setups) turned that warning into a
 * hard install failure.
 *
 * Only runtime deps count: a devDependency wanting a newer Node inconveniences
 * contributors, it does not break an install of the published package. Reads the
 * lockfile rather than node_modules so it gives the same answer on a machine that
 * never ran `npm i`.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Lowest Node version a semver range admits, as a comparable [major, minor, patch].
 * Ranges here are the handful npm packages actually publish in `engines.node`
 * (">=20", ">=22.12.0", "^18 || >=20", ">=14 <21"), so taking the SMALLEST lower
 * bound across the or-clauses is both correct and enough — a package that accepts
 * old Node via any clause is not a threat to our floor.
 */
export function minVersion(range) {
  if (!range || range === "*") return null;
  const clauses = String(range).split("||");
  let best = null;
  for (const clause of clauses) {
    const m = /(?:>=|\^|~|>)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(clause.trim());
    if (!m) continue;
    // `>N` means the floor is the next version up; treat it as N.0.1-ish by
    // bumping the patch, which is all the comparison below needs.
    const bump = /^\s*>[^=]/.test(clause) ? 1 : 0;
    const v = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0) + bump];
    if (!best || cmp(v, best) < 0) best = v;
  }
  return best;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Runtime lock entries whose Node floor is above `declaredRange`.
 * `lockPackages` is package-lock.json's `packages` map. Pure, so a test can feed
 * it a synthetic lock instead of waiting for a real bad dependency to land.
 */
export function engineViolations(lockPackages, declaredRange) {
  const floor = minVersion(declaredRange);
  if (!floor) return [];
  const bad = [];
  for (const [path, entry] of Object.entries(lockPackages ?? {})) {
    if (!path || entry?.dev || entry?.optional) continue; // "" is the root package
    const want = entry?.engines?.node;
    if (!want) continue;
    const need = minVersion(want);
    if (need && cmp(need, floor) > 0) {
      bad.push({ package: path.replace(/^node_modules\//, ""), version: entry.version, requires: want });
    }
  }
  return bad.sort((a, b) => a.package.localeCompare(b.package));
}

function main() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  const declared = pkg.engines?.node;
  const bad = engineViolations(lock.packages, declared);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ declared, violations: bad }, null, 2));
  } else {
    console.log(`engines — package declares node ${declared}`);
    for (const b of bad) console.log(`  ✗ ${b.package}@${b.version} requires node ${b.requires}`);
    if (!bad.length) console.log("  runtime dependencies: OK ✓");
  }
  if (bad.length) {
    console.error(
      `✗ ${bad.length} runtime dependency(ies) need a newer Node than engines.node (${declared}).\n` +
      `  Either pin them back or raise engines.node and the CI matrix together.`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
