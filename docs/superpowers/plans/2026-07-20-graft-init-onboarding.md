# `graft init` Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Claude Code integration work in any repo via `npm i -D @nanonets/graft` + `npx graft init`, then publish `0.3.0`.

**Architecture:** A pure `mergeGraftSettings` + shim-source generators live in `src/claude/`; `runInit` orchestrates writing `.claude/` files and (optionally) building the graph; `cli.ts` exposes `graft init`. Consumer shims resolve the installed package on disk and dynamic-import the absolute file (bypassing the restrictive `exports` map). A `postinstall` script prints a one-line nudge.

**Tech Stack:** Node 20+ (ESM), TypeScript (strict), `node:test` + `node:assert/strict`, `tsx`, `commander`. No new dependencies.

## Global Constraints

- **Money guard:** `graft init`'s build step runs only plain `graft build` — structural, offline, `$0`. Never `--deep`. (spec §4.6)
- **Never clobber user config:** merging `.claude/settings.json` preserves all foreign keys; a foreign `statusLine`/`subagentStatusLine` is left untouched with a warning; Graft hook entries are appended (and de-duplicated on re-run). (spec §4.3)
- **Idempotent:** re-running `graft init` updates in place — no duplicate hook entries, no duplicate footer regex. (spec §4.4)
- **Best-effort install:** `postinstall` never fails an install (any error → exit 0); silent when `CI` is set or already initialized. (spec §4.5)
- **Smart shim resolution:** shims resolve `@nanonets/graft/package.json` from the target dir and import `<pkgRoot>/dist/claude/<file>`; fall back to `<dir>/dist/claude/<file>` for Graft's own repo. Absolute-path `import()` bypasses `exports`. (spec §4.1)
- Node ESM (`.js` import extensions in `src/`). State/most conventions follow the existing `src/claude/*`.

---

## File Structure

**Created:** `src/claude/shim-template.ts`, `src/claude/settings-merge.ts`, `src/claude/init.ts`, `scripts/postinstall.mjs`, `test/claude-shim-template.test.ts`, `test/claude-settings-merge.test.ts`, `test/claude-init.test.ts`.
**Modified:** `src/cli.ts` (add `init`), `.claude/helpers/graft-statusline.cjs` + `graft-hooks.cjs` (smart form), `package.json` (`exports["./package.json"]`, `scripts.postinstall`, version `0.3.0`).

---

## Task 1: Smart shim template + own-repo shims + exports

**Files:**
- Create: `src/claude/shim-template.ts`, `test/claude-shim-template.test.ts`
- Modify: `.claude/helpers/graft-statusline.cjs`, `.claude/helpers/graft-hooks.cjs`, `package.json` (`exports`)

**Interfaces:**
- Produces: `statuslineShim(): string`, `hooksShim(): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/claude-shim-template.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { statuslineShim, hooksShim } from '../src/claude/shim-template.js';

for (const [name, src] of [['statusline', statuslineShim()], ['hooks', hooksShim()]] as const) {
  test(`${name} shim parses and has package-resolve + local fallback`, () => {
    const body = src.replace(/^#!.*\n/, ''); // strip shebang for vm
    assert.doesNotThrow(() => new vm.Script(body), 'valid JS');
    assert.match(src, /require\.resolve\('@nanonets\/graft\/package\.json', \{ paths: \[dir\] \}\)/);
    assert.match(src, /path\.join\(dir, 'dist', 'claude'/);
    assert.match(src, /\.catch\(\(\) => \{/); // best-effort
  });
}

test('statusline calls main(); hooks passes the event arg', () => {
  assert.match(statuslineShim(), /m\.main\(\)/);
  assert.match(hooksShim(), /m\.main\(process\.argv\[2\]\)/);
});
```

- [ ] **Step 2: Run test — expect FAIL** (`Cannot find module '../src/claude/shim-template.js'`)

Run: `node --import tsx --test test/claude-shim-template.test.ts`

- [ ] **Step 3: Implement `src/claude/shim-template.ts`**

```ts
function shim(entryFile: string, call: string): string {
  return `#!/usr/bin/env node
const path = require('path');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
function entry(name) {
  try {
    const pkg = require.resolve('@nanonets/graft/package.json', { paths: [dir] });
    return path.join(path.dirname(pkg), 'dist', 'claude', name);
  } catch {
    return path.join(dir, 'dist', 'claude', name);
  }
}
import(entry(${JSON.stringify(entryFile)})).then((m) => ${call}).catch(() => { /* graft unavailable — no-op */ });
`;
}

export function statuslineShim(): string { return shim('statusline.js', 'm.main()'); }
export function hooksShim(): string { return shim('hooks.js', 'm.main(process.argv[2])'); }
```

- [ ] **Step 4: Run test — expect PASS**

Run: `node --import tsx --test test/claude-shim-template.test.ts`

- [ ] **Step 5: Regenerate Graft's own committed shims to the smart form**

Overwrite `.claude/helpers/graft-statusline.cjs` with the exact output of `statuslineShim()` and `.claude/helpers/graft-hooks.cjs` with `hooksShim()`. Generate them deterministically:

```bash
node --import tsx -e "import('./src/claude/shim-template.ts').then(m=>{require('fs').writeFileSync('.claude/helpers/graft-statusline.cjs',m.statuslineShim());require('fs').writeFileSync('.claude/helpers/graft-hooks.cjs',m.hooksShim());})"
chmod +x .claude/helpers/graft-statusline.cjs .claude/helpers/graft-hooks.cjs
```

- [ ] **Step 6: Add `./package.json` to `exports` in `package.json`**

Change the `exports` block to:

```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./package.json": "./package.json"
  },
```

- [ ] **Step 7: Build + verify the own-repo shim still renders (dogfood fallback path)**

```bash
npm run build
echo '{"session_id":"t","cwd":"'"$PWD"'","context_window":{"used_percentage":30}}' | node .claude/helpers/graft-statusline.cjs
```
Expected: the graft bar renders (in this repo, `require.resolve('@nanonets/graft/...')` fails → falls back to `./dist/claude/statusline.js`). If `graft/.cache/stats.json` is absent it falls back further to `wiring.json` — still a real bar, not "not built".

- [ ] **Step 8: Commit**

```bash
git add src/claude/shim-template.ts test/claude-shim-template.test.ts .claude/helpers/graft-statusline.cjs .claude/helpers/graft-hooks.cjs package.json
git commit -m "feat(claude): smart shim resolution (installed package + local fallback) + package.json export"
```

---

## Task 2: `mergeGraftSettings` — non-clobbering, idempotent settings merge

**Files:**
- Create: `src/claude/settings-merge.ts`, `test/claude-settings-merge.test.ts`

**Interfaces:**
- Produces: `mergeGraftSettings(existing: Record<string, any>): { merged: Record<string, any>; warnings: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// test/claude-settings-merge.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeGraftSettings } from '../src/claude/settings-merge.js';

const SL = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs"';

test('empty settings gets the full Graft blocks', () => {
  const { merged, warnings } = mergeGraftSettings({});
  assert.equal(merged.statusLine.command, SL);
  assert.equal(merged.subagentStatusLine.command, SL);
  assert.ok(Array.isArray(merged.hooks.PostToolUse));
  assert.equal(merged.hooks.PostToolUse[0].matcher, 'Write|Edit|MultiEdit');
  for (const e of ['PostToolUse', 'UserPromptSubmit', 'SessionStart', 'Stop']) {
    assert.ok(merged.hooks[e][0].hooks[0].command.includes('graft-hooks.cjs'), `${e} wired`);
  }
  assert.ok(merged.footerLinksRegexes.includes('graft/[\\w./-]+\\.md'));
  assert.deepEqual(warnings, []);
});

test('foreign statusLine is preserved with a warning; Graft not forced in', () => {
  const { merged, warnings } = mergeGraftSettings({ statusLine: { type: 'command', command: 'my-bar.sh' } });
  assert.equal(merged.statusLine.command, 'my-bar.sh');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /statusLine/);
});

test('existing foreign hooks are preserved; Graft appended', () => {
  const existing = { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }] } };
  const { merged } = mergeGraftSettings(existing);
  assert.equal(merged.hooks.PostToolUse.length, 2);
  assert.equal(merged.hooks.PostToolUse[0].hooks[0].command, 'mine.sh');
  assert.ok(merged.hooks.PostToolUse[1].hooks[0].command.includes('graft-hooks.cjs'));
});

test('re-running is idempotent (no duplicate Graft entries or footer)', () => {
  const once = mergeGraftSettings({}).merged;
  const twice = mergeGraftSettings(once).merged;
  assert.equal(twice.hooks.PostToolUse.length, 1);
  assert.equal(twice.hooks.Stop.length, 1);
  assert.equal(twice.footerLinksRegexes.filter((r: string) => r === 'graft/[\\w./-]+\\.md').length, 1);
});

test('foreign top-level keys survive', () => {
  const { merged } = mergeGraftSettings({ model: 'claude-sonnet-5', permissions: { allow: ['Bash(ls)'] } });
  assert.equal(merged.model, 'claude-sonnet-5');
  assert.deepEqual(merged.permissions.allow, ['Bash(ls)']);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `node --import tsx --test test/claude-settings-merge.test.ts`

- [ ] **Step 3: Implement `src/claude/settings-merge.ts`**

```ts
type Json = Record<string, any>;

const SL_CMD = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs"';
const FOOTER = 'graft/[\\w./-]+\\.md';

function hookCmd(arg: string): string {
  return `node "\${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs" ${arg}`;
}
function graftBlocks(): Record<string, Json> {
  return {
    PostToolUse: { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: hookCmd('post-edit'), timeout: 10000 }] },
    UserPromptSubmit: { hooks: [{ type: 'command', command: hookCmd('prompt'), timeout: 8000 }] },
    SessionStart: { hooks: [{ type: 'command', command: hookCmd('session-start'), timeout: 8000 }] },
    Stop: { hooks: [{ type: 'command', command: hookCmd('stop'), timeout: 8000 }] },
  };
}
function isGraftHookEntry(entry: Json): boolean {
  return JSON.stringify(entry ?? '').includes('graft-hooks.cjs');
}

export function mergeGraftSettings(existing: Json): { merged: Json; warnings: string[] } {
  const merged: Json = { ...(existing ?? {}) };
  const warnings: string[] = [];

  if (!merged.statusLine) merged.statusLine = { type: 'command', command: SL_CMD };
  else if (merged.statusLine.command !== SL_CMD)
    warnings.push('Existing statusLine left untouched (a session allows only one). To use Graft, point it at .claude/helpers/graft-statusline.cjs.');

  if (!merged.subagentStatusLine) merged.subagentStatusLine = { type: 'command', command: SL_CMD };
  else if (merged.subagentStatusLine.command !== SL_CMD)
    warnings.push('Existing subagentStatusLine left untouched.');

  merged.hooks = { ...(merged.hooks ?? {}) };
  for (const [event, block] of Object.entries(graftBlocks())) {
    const prior = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const foreign = prior.filter((e: Json) => !isGraftHookEntry(e)); // drop old Graft entries → idempotent
    merged.hooks[event] = [...foreign, block];
  }

  const footer = Array.isArray(merged.footerLinksRegexes) ? [...merged.footerLinksRegexes] : [];
  if (!footer.includes(FOOTER)) footer.push(FOOTER);
  merged.footerLinksRegexes = footer;

  return { merged, warnings };
}
```

- [ ] **Step 4: Run test — expect PASS (5 tests)**

Run: `node --import tsx --test test/claude-settings-merge.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/claude/settings-merge.ts test/claude-settings-merge.test.ts
git commit -m "feat(claude): non-clobbering, idempotent settings merge for graft init"
```

---

## Task 3: `runInit` + `graft init` command

**Files:**
- Create: `src/claude/init.ts`, `test/claude-init.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `mergeGraftSettings` (Task 2); `statuslineShim`/`hooksShim` (Task 1).
- Produces: `runInit(dir: string, opts?: { build?: boolean; cliPath?: string }): InitResult` where `interface InitResult { settingsPath: string; shims: string[]; warnings: string[]; built: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
// test/claude-init.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/claude/init.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-init-')); }

test('runInit scaffolds settings + both shims (build skipped)', () => {
  const d = fresh();
  const r = runInit(d, { build: false });
  assert.ok(existsSync(join(d, '.claude', 'settings.json')));
  assert.ok(existsSync(join(d, '.claude', 'helpers', 'graft-statusline.cjs')));
  assert.ok(existsSync(join(d, '.claude', 'helpers', 'graft-hooks.cjs')));
  assert.equal(r.built, false);
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.statusLine.command.includes('graft-statusline.cjs'));
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes('graft-hooks.cjs'));
});

test('runInit preserves foreign settings and warns on foreign statusLine', () => {
  const d = fresh();
  const { writeFileSync, mkdirSync } = require('node:fs');
  mkdirSync(join(d, '.claude'), { recursive: true });
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ model: 'x', statusLine: { command: 'mine' } }));
  const r = runInit(d, { build: false });
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.model, 'x');
  assert.equal(s.statusLine.command, 'mine');
  assert.equal(r.warnings.length, 1);
});

test('runInit is idempotent', () => {
  const d = fresh();
  runInit(d, { build: false });
  runInit(d, { build: false });
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.hooks.PostToolUse.length, 1);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `node --import tsx --test test/claude-init.test.ts`

- [ ] **Step 3: Implement `src/claude/init.ts`**

```ts
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeGraftSettings } from './settings-merge.js';
import { statuslineShim, hooksShim } from './shim-template.js';

export interface InitResult {
  settingsPath: string;
  shims: string[];
  warnings: string[];
  built: boolean;
}

export function runInit(dir: string, opts: { build?: boolean; cliPath?: string } = {}): InitResult {
  const helpersDir = join(dir, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });

  const settingsPath = join(dir, '.claude', 'settings.json');
  let existing: Record<string, any> = {};
  try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { /* none/invalid → start fresh */ }
  const { merged, warnings } = mergeGraftSettings(existing);
  writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);

  const sl = join(helpersDir, 'graft-statusline.cjs');
  const hk = join(helpersDir, 'graft-hooks.cjs');
  writeFileSync(sl, statuslineShim()); chmodSync(sl, 0o755);
  writeFileSync(hk, hooksShim()); chmodSync(hk, 0o755);

  let built = false;
  const wiring = join(dir, 'graft', '.graph', 'wiring.json');
  if (opts.build !== false && opts.cliPath && !existsSync(wiring)) {
    try {
      execFileSync(process.execPath, [opts.cliPath, 'build', '.'], { cwd: dir, stdio: 'inherit', timeout: 300000 });
      built = true;
    } catch { /* build best-effort; user can run `graft build` manually */ }
  }
  return { settingsPath, shims: [sl, hk], warnings, built };
}
```

- [ ] **Step 4: Run test — expect PASS (3 tests)**

Run: `node --import tsx --test test/claude-init.test.ts`

- [ ] **Step 5: Add the `init` command to `src/cli.ts`**

Add these imports near the top (match existing import style):

```ts
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runInit } from './claude/init.js';
```

Add the command (place it alongside the other `.command(...)` blocks, before `program.parseAsync()`):

```ts
program
  .command('init')
  .description('Set up the Claude Code integration (.claude/ statusline + hooks) in this repo')
  .argument('[dir]', 'target repo directory', '.')
  .option('--no-build', 'skip building the graph (wire files only)')
  .action((dir: string, opts: { build?: boolean }) => {
    const cliPath = fileURLToPath(import.meta.url);
    const res = runInit(resolve(dir), { build: opts.build, cliPath });
    console.error(`✓ wrote ${res.settingsPath}`);
    for (const s of res.shims) console.error(`✓ wrote ${s}`);
    console.error(res.built ? '✓ built the graph (graft build)' : '· skipped graph build');
    for (const w of res.warnings) console.error(`⚠ ${w}`);
    console.error('\nDone. The statusline + hooks activate in Claude Code sessions in this repo.');
    console.error('For LLM summaries: set OPENROUTER_API_KEY and run `graft build --deep`.');
  });
```

> If `commander`'s `--no-build` mapping is unclear: commander sets `opts.build = false` when `--no-build` is passed and `true` otherwise. `runInit` treats `build !== false` as "build".

- [ ] **Step 6: Build + smoke-test the command in a temp consumer dir**

```bash
npm run build
TMP=$(mktemp -d); node dist/cli.js init "$TMP" --no-build; echo "---"; ls -la "$TMP/.claude/helpers"; cat "$TMP/.claude/settings.json" | head -20
```
Expected: writes settings + both shims; prints the summary; `--no-build` skips the build.

- [ ] **Step 7: Commit**

```bash
git add src/claude/init.ts test/claude-init.test.ts src/cli.ts
git commit -m "feat(cli): graft init — scaffold .claude/ integration into any repo"
```

---

## Task 4: `postinstall` nudge

**Files:**
- Create: `scripts/postinstall.mjs`
- Modify: `package.json` (`scripts.postinstall`)
- Test: `test/claude-init.test.ts` (append a subprocess test)

- [ ] **Step 1: Write the failing test** (append to `test/claude-init.test.ts`)

```ts
import { execFileSync } from 'node:child_process';

function runPostinstall(env: Record<string, string>): string {
  try {
    return execFileSync(process.execPath, ['scripts/postinstall.mjs'],
      { encoding: 'utf8', env: { ...process.env, ...env } });
  } catch { return ''; }
}

test('postinstall prints the nudge in a fresh dir', () => {
  const d = fresh();
  const out = runPostinstall({ INIT_CWD: d, CI: '' });
  assert.match(out, /npx graft init/);
});

test('postinstall is silent when already initialized', () => {
  const d = fresh();
  runInit(d, { build: false });
  const out = runPostinstall({ INIT_CWD: d, CI: '' });
  assert.equal(out.trim(), '');
});

test('postinstall is silent under CI', () => {
  const out = runPostinstall({ INIT_CWD: fresh(), CI: '1' });
  assert.equal(out.trim(), '');
});
```

- [ ] **Step 2: Run test — expect FAIL** (`scripts/postinstall.mjs` missing → catch → '' → nudge assertion fails)

Run: `node --import tsx --test test/claude-init.test.ts`

- [ ] **Step 3: Implement `scripts/postinstall.mjs`**

```js
// Prints a one-line nudge after install. Never fails the install.
try {
  if (process.env.CI) process.exit(0);
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = process.env.INIT_CWD || process.cwd();
  if (existsSync(join(dir, '.claude', 'helpers', 'graft-statusline.cjs'))) process.exit(0);
  console.log('\n  Graft installed. Run `npx graft init` to enable the Claude Code integration (statusline + hooks + auto-sync).\n');
} catch {
  /* never fail an install */
}
```

- [ ] **Step 4: Wire `postinstall` in `package.json`**

Add to `scripts`: `"postinstall": "node scripts/postinstall.mjs"`.

- [ ] **Step 5: Run test — expect PASS (3 new tests)**

Run: `node --import tsx --test test/claude-init.test.ts`

- [ ] **Step 6: Confirm `scripts/` ships in the package**

`package.json` `files` is `["dist", "README.md", "LICENSE"]` — `scripts/` is NOT included, so the published `postinstall` would 404. Add `"scripts"` to `files`:

```json
  "files": ["dist", "scripts", "README.md", "LICENSE"],
```

Verify: `npm pack --dry-run 2>&1 | grep -E "postinstall|scripts/"` shows `scripts/postinstall.mjs` in the tarball.

- [ ] **Step 7: Commit**

```bash
git add scripts/postinstall.mjs package.json test/claude-init.test.ts
git commit -m "feat: postinstall nudge to run graft init (silent in CI / when initialized)"
```

---

## Task 5: Version bump + full verification + consumer smoke

**Files:** Modify `package.json` (version).

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: all `test/*.test.ts` pass (existing `claude-*` + the 3 new files), no regressions.

- [ ] **Step 2: Build clean**

Run: `npm run build`
Expected: exit 0; `dist/claude/{init,settings-merge,shim-template}.js` present (`ls dist/claude`).

- [ ] **Step 3: Consumer smoke — prove the shim resolves an *installed* package**

Simulate a consumer repo whose `node_modules/@nanonets/graft` points at this build:

```bash
CONSUMER=$(mktemp -d)
mkdir -p "$CONSUMER/node_modules/@nanonets"
ln -s "$PWD" "$CONSUMER/node_modules/@nanonets/graft"
node dist/cli.js init "$CONSUMER" --no-build
# drive the written statusline shim as Claude Code would, from the consumer dir:
CLAUDE_PROJECT_DIR="$CONSUMER" bash -c 'echo "{\"session_id\":\"t\",\"cwd\":\"$CLAUDE_PROJECT_DIR\"}" | node "$CLAUDE_PROJECT_DIR/.claude/helpers/graft-statusline.cjs"'
```
Expected: the shim resolves `@nanonets/graft/package.json` from the consumer dir → imports THIS repo's `dist/claude/statusline.js` → renders a graft bar (the consumer has no graph, so it shows `graft · not built · run graft build` — which is the correct, resolved output, proving the package path works). `rm -rf "$CONSUMER"` after.

- [ ] **Step 4: Bump version to 0.3.0**

```bash
npm version 0.3.0 --no-git-tag-version
git add package.json package-lock.json 2>/dev/null; git commit -m "chore(release): 0.3.0 — graft init onboarding"
```

- [ ] **Step 5: Final confirmation for the controller**

Report: full suite green, build clean, consumer smoke resolved the installed-package path, version at 0.3.0. Publishing (security-key 2FA) is a controller/human step, not part of this task.

---

## Notes for the implementer

- Never add `--deep` anywhere. `runInit`'s build is plain `graft build`.
- The consumer shims must resolve the package via `require.resolve('@nanonets/graft/package.json', { paths: [dir] })`, then import the absolute `dist/claude/*.js` — do NOT `import('@nanonets/graft/dist/claude/...')` (blocked by the `exports` map).
- Keep the merge non-destructive: foreign keys, foreign `statusLine`, and foreign hook entries must survive; Graft entries de-dupe on re-run.
