/**
 * Contract tests for the things CI and the package manifest PROMISE but that no
 * code path would otherwise contradict out loud:
 *
 *   - engines.node is a promise about the published package, so no runtime
 *     dependency may demand a newer Node than it (commander@15 wanted >=22.12 in
 *     a package declaring >=20 for a whole release, and `engine-strict=true`
 *     turns that from a warning into a failed install);
 *   - the CI matrix must actually exercise the declared range, not one pinned
 *     version;
 *   - test/ has to be reachable by a type-checker at all (tsx strips types
 *     without checking them);
 *   - package.json must not advertise a supply-chain control it does not have.
 *
 * These are file-shaped rather than behaviour-shaped, so they are asserted by
 * reading the manifests. That is the point: nothing else fails when a manifest
 * quietly stops matching reality.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineViolations, minVersion } from "../scripts/check-engines.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]): string => readFileSync(join(repoRoot, ...p), "utf8");
const readJson = (...p: string[]): any => JSON.parse(read(...p));

test("no runtime dependency demands a newer Node than engines.node", () => {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const bad = engineViolations(lock.packages, pkg.engines.node);
  assert.deepEqual(
    bad.map((b: { package: string }) => b.package),
    [],
    `runtime deps above engines.node (${pkg.engines.node}): ${JSON.stringify(bad)}`,
  );
});

test("the engine check catches the commander@15 regression it was written for", () => {
  // Exactly the situation that shipped: a direct runtime dep with a higher floor.
  const bad = engineViolations(
    {
      "": { name: "@nanonets/graft" },
      "node_modules/commander": { version: "15.0.0", engines: { node: ">=22.12.0" } },
      "node_modules/dotenv": { version: "17.4.2", engines: { node: ">=12" } },
      // A devDependency is not a user-facing install problem, so it must be ignored.
      "node_modules/typescript": { version: "6.0.3", dev: true, engines: { node: ">=24" } },
    },
    ">=20",
  );
  assert.deepEqual(bad.map((b) => b.package), ["commander"]);
});

test("minVersion takes the lowest floor across or-clauses", () => {
  assert.deepEqual(minVersion(">=22.12.0"), [22, 12, 0]);
  assert.deepEqual(minVersion(">=20"), [20, 0, 0]);
  assert.deepEqual(minVersion("^18 || >=20"), [18, 0, 0]);
  assert.equal(minVersion("*"), null);
});

test("the CI matrix exercises the declared Node range on both platforms", () => {
  const ci = read(".github", "workflows", "ci.yml");
  const declared = minVersion(readJson("package.json").engines.node)![0];
  assert.match(ci, /os:\s*\[ubuntu-latest,\s*windows-latest\]/, "both OS legs must stay");
  assert.match(ci, /fail-fast:\s*false/);
  // The floor must be run (that is where an engines break surfaces) and at least
  // one newer major, or the matrix is pinned again.
  assert.ok(ci.includes(`"${declared}"`), `CI must run the declared floor (node ${declared})`);
  const majors = [...ci.matchAll(/"(\d\d)"/g)].map((m) => Number(m[1]));
  assert.ok(
    majors.some((m) => m > declared),
    `engines.node is open-ended (>=${declared}); CI must run a newer major too, saw ${majors}`,
  );
});

test("CI runs the packaged artifact and the graph-quality gate", () => {
  const ci = read(".github", "workflows", "ci.yml");
  assert.match(ci, /npm run check:package/, "the tarball's runtime assets must be asserted");
  assert.match(ci, /npm pack/, "the published artifact must be installed and smoked");
  assert.match(ci, /graph-quality\.mjs \. --strict/, "graph-quality advertises itself as a CI gate");
  assert.match(ci, /npm run check:engines/);
});

test("tsconfig.test.json type-checks test/ without inheriting the build's rootDir", () => {
  // Comments are legal in tsconfig; strip them the same way tsc does.
  const raw = read("tsconfig.test.json").replace(/^\s*\/\/.*$/gm, "");
  const cfg = JSON.parse(raw);
  assert.ok(cfg.include.includes("test/**/*"), "test/ must be in the program");
  assert.equal(cfg.compilerOptions.noEmit, true);
  // rootDir "./src" from the base config makes test/**/* a TS6059 error; the
  // check-only config has to widen it.
  assert.notEqual(cfg.compilerOptions.rootDir, "./src");
  assert.equal(cfg.compilerOptions.declaration, false, "declaration + noEmit is a tsc error");
  const pkg = readJson("package.json");
  assert.equal(pkg.scripts["typecheck:tests"], "tsc -p tsconfig.test.json");
});

test("package.json does not advertise an allow-scripts gate it does not enforce", () => {
  const pkg = readJson("package.json");
  const hasTool =
    Boolean(pkg.devDependencies?.["@lavamoat/allow-scripts"]) &&
    /allow-scripts/.test(String(pkg.scripts?.preinstall ?? ""));
  assert.ok(
    !pkg.allowScripts || hasTool,
    "allowScripts reads as a supply-chain control; without @lavamoat/allow-scripts installed and " +
      "a preinstall hook it gates nothing and every install script still runs",
  );
});
