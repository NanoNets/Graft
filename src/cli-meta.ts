/**
 * `graft version` / `graft --version` / `graft upgrade` support.
 *
 * Split out of cli.ts so the formatting helpers can be unit-tested with
 * injected results instead of hitting the network from tests.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toPosixPath } from "./util/paths.js";

const PKG_NAME = "@nanonets/graft";

/** Locates package.json relative to a module URL (works for both `dist/cli.js`
 * running one level under the published package root, and `src/cli.ts` running
 * one level under the repo root via tsx). */
export function resolvePackageJsonPath(moduleUrl: string): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const candidates = [resolve(moduleDir, "..", "package.json"), resolve(moduleDir, "package.json")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/** Reads the version of the graft package this module was loaded from. */
export function readCurrentVersion(moduleUrl: string): string {
  const raw = readFileSync(resolvePackageJsonPath(moduleUrl), "utf8");
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? "0.0.0";
}

/** True when the running module lives under an npx cache dir (e.g.
 * `~/.npm/_npx/<hash>/node_modules/...`) rather than a regular global install.
 *
 * Normalized first: `fileURLToPath` returns the *platform* separator, so on
 * Windows the cache path is `…\_npx\…` and a bare `includes("/_npx/")` is always
 * false — `graft upgrade` would then run `npm install -g` on top of an npx run.
 * Same hardcoded-`/` mistake as #33; `src/util/paths.ts` exists for exactly this. */
export function isRunningViaNpx(moduleUrl: string): boolean {
  return toPosixPath(fileURLToPath(moduleUrl)).includes("/_npx/");
}

export interface NpmViewResult {
  ok: boolean;
  version?: string;
}

/**
 * True on Windows, where `npm` exists only as the `npm.cmd`/`npm.ps1` shim npm's
 * own installer writes. `spawnSync` appends `.exe` and nothing else, so a bare
 * `spawnSync("npm", …)` fails with ENOENT before it ever reaches the network —
 * and every npm-shaped feature dies with it: `graft version` reported "unreachable
 * (offline?)" on a perfectly online machine, `graft upgrade` exited 1 with
 * `spawnSync npm ENOENT`, and `refreshUpdateCache` cached `latest: null` once a day
 * forever, so the update nudge could never fire on the whole platform.
 * `globalRoot` below already carried this flag; the other two call sites did not.
 *
 * Handing the shim's absolute path to `spawnSync` is NOT an alternative: since the
 * CVE-2024-27980 patch, Node refuses to CreateProcess a `.cmd`/`.bat` directly
 * (EINVAL). Going through `cmd.exe` is the supported route, which is what this is.
 * Every argument we pass is a literal or a package name we control, never user
 * input, so there is nothing here for `cmd.exe` to reinterpret.
 */
const NPM_NEEDS_SHELL = process.platform === "win32";

/** `npm view <pkg> version`, offline-safe: any failure (no npm, no network,
 * timeout) resolves to `{ ok: false }` rather than throwing.
 *
 * The 10s default is not generous, it is honest: a cold `npm view` measured 9.4s on
 * a Windows dev box, and the old 2s cap turned "slow registry" into "offline" for
 * everyone on it. The hot caller is the detached `_update-check` child, which
 * nobody is waiting on, so the extra ceiling costs a user nothing. */
export function getNpmViewVersion(pkgName: string = PKG_NAME, timeoutMs = 10000): NpmViewResult {
  try {
    const res = spawnSync("npm", ["view", pkgName, "version"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      shell: NPM_NEEDS_SHELL,
    });
    if (res.error || res.signal || res.status !== 0) return { ok: false };
    const version = res.stdout?.trim();
    if (!version) return { ok: false };
    return { ok: true, version };
  } catch {
    return { ok: false };
  }
}

/**
 * Order two semver strings: negative when `a` is older, 0 when equal, positive
 * when `a` is newer. Unparseable input sorts as 0.0.0 rather than throwing —
 * this only ever decides what to PRINT, and a malformed version is not worth
 * failing `graft version` over.
 *
 * Prerelease handling is the one subtlety: `1.2.0-rc.1` precedes `1.2.0`, so a
 * release-candidate install is never told it is ahead of the release it precedes.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre = ""] = String(v).trim().replace(/^v/, "").split("-", 2);
    const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  }
  if (x.pre === y.pre) return 0;
  // A prerelease is BELOW the same core release; between two prereleases, order
  // them lexically, which matches how rc.1 / rc.2 are actually written.
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * Pure formatter for `graft version` — no I/O, easy to unit-test.
 *
 * The comparison is semver, not string equality. Equality alone reported ANY
 * difference as "run graft upgrade", including the case where the installed
 * build is NEWER than the registry — a fork, an rc, or a local `npm link`. That
 * advice is actively destructive there, because `graft upgrade` installs
 * `@latest` and would replace the newer build with the older published one.
 */
export function formatVersionReport(current: string, latest: NpmViewResult): string {
  const lines = [`graft ${current}`];
  if (!latest.ok || !latest.version) {
    lines.push("latest: unreachable (offline?)");
    return lines.join("\n");
  }
  const cmp = compareVersions(latest.version, current);
  if (cmp === 0) {
    lines.push(`latest on npm: ${current} ✓ up to date`);
  } else if (cmp > 0) {
    lines.push(`latest on npm: ${latest.version} — run graft upgrade`);
  } else {
    lines.push(
      `latest on npm: ${latest.version} — this build is newer, so \`graft upgrade\` would downgrade it`,
    );
  }
  return lines.join("\n");
}

/** The global npm node_modules dir (handles Homebrew/Windows/volta layouts). */
function globalRoot(): string | null {
  try {
    const root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

/** Reads the version actually sitting in the global install, straight from
 * disk — more reliable right after `npm install -g` than re-querying the
 * registry (which just tells you what "latest" is, not what landed locally). */
export function readGlobalInstalledVersion(pkgName: string = PKG_NAME): string | null {
  const root = globalRoot();
  if (!root) return null;
  const pkgJson = join(root, ...pkgName.split("/"), "package.json");
  if (!existsSync(pkgJson)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export interface UpgradeResult {
  /** True when `npm install -g` actually ran (false for the npx and refused paths). */
  ran: boolean;
  ok: boolean;
  /** Present when ran=true and the install failed. */
  errorMessage?: string;
  oldVersion?: string;
  newVersion?: string;
  /** Set when the install was refused because it would have been a downgrade. */
  refused?: { latest: string };
}

/** Pure formatter for a finished upgrade — no I/O, easy to unit-test. */
export function formatUpgradeReport(result: UpgradeResult): string {
  // Before the `ran` check, not after: a refusal also never ran, and reporting
  // it as the npx no-op would hide the reason.
  if (result.refused) {
    return (
      `graft ${result.oldVersion ?? "?"} is newer than ${result.refused.latest} on npm — nothing to upgrade to.\n` +
      `Installing @latest would REPLACE this build with the older published one.\n` +
      `If that is what you want: graft upgrade --force`
    );
  }
  if (!result.ran) {
    return (
      "running via npx — npx already fetches the latest graft on every run.\n" +
      "For a permanent install: npm install -g @nanonets/graft"
    );
  }
  if (!result.ok) {
    return `✗ npm install -g ${PKG_NAME}@latest failed${result.errorMessage ? `: ${result.errorMessage}` : ""}`;
  }
  return `graft ${result.oldVersion ?? "?"} → ${result.newVersion ?? result.oldVersion ?? "?"}`;
}

/** Runs `npm install -g @nanonets/graft@latest` (inheriting stdio so the user
 * sees npm's own progress/errors), then re-reads the freshly installed
 * version. No-ops with guidance when running via npx. */
export function runUpgrade(moduleUrl: string, opts: { force?: boolean } = {}): UpgradeResult {
  const oldVersion = readCurrentVersion(moduleUrl);
  if (isRunningViaNpx(moduleUrl)) {
    return { ran: false, ok: true, oldVersion };
  }
  // Refuse to "upgrade" onto an older published version. `@latest` is a tag, not
  // a maximum, so on a fork, an rc, or an `npm link`ed checkout this command
  // silently replaces the newer build with the registry's. When the local version
  // cannot be read there is nothing to compare against, so the install proceeds
  // exactly as it did before.
  if (!opts.force && oldVersion) {
    const latest = getNpmViewVersion();
    if (latest.ok && latest.version && compareVersions(latest.version, oldVersion) < 0) {
      return { ran: false, ok: true, oldVersion, refused: { latest: latest.version } };
    }
  }
  // Same shim story as `getNpmViewVersion` — see NPM_NEEDS_SHELL. Without it this
  // command could not succeed even once on Windows, which is the platform whose
  // users are most likely to reach for `graft upgrade` instead of npm directly.
  const res = spawnSync("npm", ["install", "-g", `${PKG_NAME}@latest`], {
    stdio: "inherit",
    shell: NPM_NEEDS_SHELL,
  });
  if (res.error || (res.status ?? 1) !== 0) {
    // Through a shell there is no `res.error` to quote — cmd.exe reports the
    // failure itself and exits non-zero — so say what we actually know.
    return {
      ran: true,
      ok: false,
      oldVersion,
      errorMessage: res.error?.message ?? `npm exited with status ${res.status ?? "unknown"}`,
    };
  }
  const newVersion = readGlobalInstalledVersion(PKG_NAME) ?? getNpmViewVersion(PKG_NAME).version ?? oldVersion;
  return { ran: true, ok: true, oldVersion, newVersion };
}
