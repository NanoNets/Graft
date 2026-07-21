# Host Hooks (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Graft's active layer — post-edit blast radius + automatic $0 graph re-sync — to Codex-style CLI agents via their user-level `hooks.json`, reusing the existing hook runtime.

**Architecture:** The existing hook runtime (`src/claude/hooks.ts`) already does everything; it reads the same stdin JSON shape these CLIs emit. We (1) refactor its `post-edit` and `stop` handlers into callable helpers and add a combined `post-edit-sync` event (these hosts have no session-end event, so sync piggybacks on post-edit), (2) add an installer that writes the existing shim to `<home>/.codex/hooks/graft/` and merges one `PostToolUse` entry into `<home>/.codex/hooks.json`, (3) wire it into `runHostsInit` behind the `agents` id, gated on `<home>/.codex` existing, with `--no-hooks` to opt out.

**Tech Stack:** TypeScript ESM, Node ≥20, `node:test` + tsx. No new dependencies.

## Global Constraints

- No new npm dependencies. ESM `.js` imports. Files under 500 lines.
- Existing Claude Code hook behavior must not change (same events, same outputs; refactor is behavior-preserving — the full existing suite must stay green).
- `hooks.json` merge: parse-tolerant of missing file; unparseable file NEVER rewritten (`skipped-unparseable`); foreign hook entries preserved; graft entries filtered-then-appended so re-runs converge (`unchanged` when nothing changes).
- Shim file is wholly graft-owned: overwrite when content differs, report `created`/`updated`/`unchanged`.
- Global writes gated on `<home>/.codex` existing. Injectable `home` everywhere; tests never touch real `$HOME`.
- No third-party tool names in code comments, docs, or commit messages.
- Tests: `node --import tsx --test test/<file>.test.ts`; use the `GRAFT_TEST_STDIN` env seam for hook-runtime tests (see `test/claude-hooks.test.ts` for the established pattern).

---

## File Structure

- Modify: `src/claude/hooks.ts` — extract `handlePostEdit`/`handleStop`, add `post-edit-sync`.
- Create: `src/hosts/codex-hooks.ts` — `installCodexHooks(home)`.
- Modify: `src/hosts/init.ts` — `hooks` option (default on), result gains `hooks: HookWrite[]`.
- Modify: `src/cli.ts` — `--no-hooks` flag + output lines.
- Modify: `README.md` — one paragraph under "## Agent integration".
- Tests: extend `test/claude-hooks.test.ts`; create `test/hosts-codex-hooks.test.ts`; extend `test/hosts-init.test.ts`.

---

### Task 1: `post-edit-sync` event in the hook runtime

**Files:**
- Modify: `src/claude/hooks.ts`
- Test: extend `test/claude-hooks.test.ts`

**Interfaces:**
- Consumes: existing internals of `src/claude/hooks.ts` (`patchStats`, `readStats`, `acquireLock`, `readWiring`, `formatBlastRadius`, `claudeScriptPath`).
- Produces: `main('post-edit-sync')` — runs the post-edit logic (dirty marking + blast radius emit) and then the stop logic (spawn detached sync when dirty + lock acquired) in one invocation. `main('post-edit')` and `main('stop')` behave exactly as before.

- [ ] **Step 1: Read the existing test file** (`test/claude-hooks.test.ts`) to mirror its fixture setup (temp repo, `GRAFT_TEST_STDIN`, stats/wiring fixtures). Then write the failing test, following the file's existing conventions:

```ts
test('post-edit-sync marks dirty and kicks off the background sync', async () => {
  // Arrange exactly like the existing post-edit test fixture (temp dir with
  // graft/.graph/wiring.json + graft/.cache), with stdin naming an edited file.
  // Act: await main('post-edit-sync') with GRAFT_TEST_STDIN set.
  // Assert BOTH effects:
  //   1. stats.dirty === true (or lastFile set) — the post-edit half ran;
  //   2. stats.syncing === true AND the sync lock file exists
  //      (graft/.cache/.sync.lock) — the stop half ran.
});
```

Write it as real code against the actual fixture helpers in the file — the intent above is normative, the helper names come from the existing tests. Also add: `post-edit-sync on a file under graft/ does not mark dirty` (mirrors the existing under-graft guard test) — note the sync half may still run if stats were already dirty; assert only that `dirty` was not newly set by this call.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --import tsx --test test/claude-hooks.test.ts`
Expected: new tests FAIL (unknown event is a silent no-op → assertions on stats fail); existing tests PASS.

- [ ] **Step 3: Refactor + implement** in `src/claude/hooks.ts` — extract the bodies of the two existing branches verbatim into helpers, then dispatch:

```ts
async function handlePostEdit(input: any, dir: string): Promise<void> {
  const file: string | undefined = input?.tool_input?.file_path;
  if (!file || underGraft(dir, file)) return;
  patchStats(dir, { dirty: true, staleCount: checkStaleCount(dir), lastFile: basename(file) });
  const w = readWiring(dir);
  if (w) { const br = formatBlastRadius(w, file); if (br) emit('PostToolUse', br); }
}

function handleStop(dir: string): void {
  const syncRun = claudeScriptPath('sync-run.js');
  if (!existsSync(syncRun)) return;
  const stats = readStats(dir);
  if (stats?.dirty && acquireLock(dir)) {
    patchStats(dir, { syncing: true });
    const child = spawn(process.execPath, [syncRun, dir], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}
```

And in `main`, replace the two branches and add the combined event:

```ts
  if (event === 'post-edit') { await handlePostEdit(input, dir); return; }
  if (event === 'stop') { handleStop(dir); return; }
  if (event === 'post-edit-sync') { await handlePostEdit(input, dir); handleStop(dir); return; }
```

The extracted helper bodies must be byte-identical to the current branch bodies (pure move). Keep the existing comments with the moved code.

- [ ] **Step 4: Run the hook tests, then the full suite**

Run: `node --import tsx --test test/claude-hooks.test.ts` → all pass (old + new).
Run: `node --import tsx --test test/*.test.ts` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/claude/hooks.ts test/claude-hooks.test.ts
git commit -m "feat(hooks): post-edit-sync event — post-edit + background sync in one call"
```

---

### Task 2: Codex-family hooks installer (`src/hosts/codex-hooks.ts`)

**Files:**
- Create: `src/hosts/codex-hooks.ts`
- Test: `test/hosts-codex-hooks.test.ts`

**Interfaces:**
- Consumes: `hooksShim()` from `../claude/shim-template.js` (verify the export name in that file before importing).
- Produces:
  - `interface HookWrite { id: string; path: string; action: 'created' | 'updated' | 'unchanged' | 'skipped-unparseable' }`
  - `installCodexHooks(home: string): HookWrite[]` — no-op (`[]`) unless `<home>/.codex` exists. Otherwise two writes:
    1. Shim: `<home>/.codex/hooks/graft/graft-hooks.cjs` (mode 0o755), content `hooksShim()` — owned file, content-compare for `unchanged`.
    2. Config: `<home>/.codex/hooks.json` — ensure `hooks.PostToolUse` is an array; drop any entries whose JSON contains `graft-hooks.cjs`; append:
       ```json
       { "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "node \"<abs shim path>\" post-edit-sync", "timeout": 10000 }] }
       ```
       Action `unchanged` when the resulting JSON equals the existing file's parsed JSON.

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosts-codex-hooks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCodexHooks } from '../src/hosts/codex-hooks.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-cxhooks-')); }

test('no-op when the CLI home dir is absent', () => {
  assert.deepEqual(installCodexHooks(fresh()), []);
});

test('writes shim + hooks.json entry, idempotent on re-run', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  const w = installCodexHooks(home);
  assert.equal(w.length, 2);
  const shim = join(home, '.codex', 'hooks', 'graft', 'graft-hooks.cjs');
  assert.ok(existsSync(shim));
  assert.ok(statSync(shim).mode & 0o111, 'shim is executable');
  const cfg = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'));
  const entries = cfg.hooks.PostToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, 'Write|Edit|MultiEdit');
  assert.match(entries[0].hooks[0].command, /post-edit-sync/);
  const again = installCodexHooks(home);
  assert.deepEqual(again.map((x) => x.action), ['unchanged', 'unchanged']);
  assert.equal(JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.PostToolUse.length, 1);
});

test('foreign hook entries are preserved; stale graft entries replaced', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({
    hooks: { PostToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] },
      { matcher: 'Write', hooks: [{ type: 'command', command: 'node /old/graft-hooks.cjs post-edit' }] },
    ] },
  }));
  installCodexHooks(home);
  const entries = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.PostToolUse;
  assert.equal(entries.length, 2, 'foreign kept, stale graft replaced by fresh');
  assert.ok(entries.some((e: any) => e.hooks[0].command === 'other-tool'));
  assert.ok(entries.some((e: any) => /post-edit-sync/.test(JSON.stringify(e))));
  assert.ok(!JSON.stringify(entries).includes('/old/'));
});

test('unparseable hooks.json is never rewritten', () => {
  const home = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), '{ nope');
  const w = installCodexHooks(home);
  assert.ok(w.some((x) => x.action === 'skipped-unparseable'));
  assert.equal(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'), '{ nope');
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```ts
// src/hosts/codex-hooks.ts
/**
 * Active-layer install for CLI agents that read user-level hooks.json with
 * PostToolUse semantics. Writes the shared hook shim and one PostToolUse
 * entry that runs post-edit + background sync after every file edit.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hooksShim } from '../claude/shim-template.js';

export interface HookWrite {
  id: string;
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped-unparseable';
}

function dirExists(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function writeOwned(id: string, path: string, content: string, mode?: number): HookWrite {
  const existed = existsSync(path);
  if (existed && readFileSync(path, 'utf8') === content) return { id, path, action: 'unchanged' };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode !== undefined) chmodSync(path, mode);
  return { id, path, action: existed ? 'updated' : 'created' };
}

function isGraftEntry(entry: unknown): boolean {
  return JSON.stringify(entry).includes('graft-hooks.cjs');
}

export function installCodexHooks(home: string): HookWrite[] {
  const base = join(home, '.codex');
  if (!dirExists(base)) return [];

  const shimPath = join(base, 'hooks', 'graft', 'graft-hooks.cjs');
  const shimWrite = writeOwned('codex-hook-shim', shimPath, hooksShim(), 0o755);

  const cfgPath = join(base, 'hooks.json');
  let root: Record<string, any> = {};
  const existed = existsSync(cfgPath);
  if (existed) {
    try { root = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch {
      return [shimWrite, { id: 'codex-hooks', path: cfgPath, action: 'skipped-unparseable' }];
    }
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return [shimWrite, { id: 'codex-hooks', path: cfgPath, action: 'skipped-unparseable' }];
  }
  const before = JSON.stringify(root);
  const hooks = (root.hooks ??= {});
  const prior: unknown[] = Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : [];
  hooks.PostToolUse = [
    ...prior.filter((e) => !isGraftEntry(e)),
    {
      matcher: 'Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: `node "${shimPath}" post-edit-sync`, timeout: 10000 }],
    },
  ];
  if (JSON.stringify(root) === before) return [shimWrite, { id: 'codex-hooks', path: cfgPath, action: 'unchanged' }];
  writeFileSync(cfgPath, `${JSON.stringify(root, null, 2)}\n`);
  return [shimWrite, { id: 'codex-hooks', path: cfgPath, action: existed ? 'updated' : 'created' }];
}
```

Note: if `root.hooks` exists but is not an object, treat as `skipped-unparseable` too (add the same shape guard as for `root`).

- [ ] **Step 4: Run to verify pass** — `node --import tsx --test test/hosts-codex-hooks.test.ts` (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hosts/codex-hooks.ts test/hosts-codex-hooks.test.ts
git commit -m "feat(hosts): hooks.json installer — post-edit blast radius + auto-sync for CLI agents"
```

---

### Task 3: Init wiring + README

**Files:**
- Modify: `src/hosts/init.ts`, `src/cli.ts`, `README.md`
- Test: extend `test/hosts-init.test.ts`

**Interfaces:**
- Consumes: `installCodexHooks`, `HookWrite` (Task 2).
- Produces: `runHostsInit(repo, { agents?, all?, home?, mcp?, hooks?: boolean })` → result gains `hooks: HookWrite[]`. Hooks install runs only when the selection includes the `agents` id (same gating philosophy as MCP: the installer itself further gates on `<home>/.codex`). CLI: `--no-hooks`.

- [ ] **Step 1: Failing tests** (append to `test/hosts-init.test.ts`)

```ts
test('runHostsInit installs hooks for the agents id when the CLI home exists', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  const r = runHostsInit(repo, { home, agents: ['agents'] });
  assert.equal(r.hooks.length, 2);
  assert.ok(existsSync(join(home, '.codex', 'hooks', 'graft', 'graft-hooks.cjs')));
});

test('hooks: false skips hook installation', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  const r = runHostsInit(repo, { home, agents: ['agents'], hooks: false });
  assert.deepEqual(r.hooks, []);
  assert.ok(!existsSync(join(home, '.codex', 'hooks.json')));
});
```

- [ ] **Step 2: Verify failure** — `r.hooks` undefined.

- [ ] **Step 3: Implement.** In `src/hosts/init.ts`: import `installCodexHooks`, `HookWrite`; add `hooks: HookWrite[]` to the result; after the mcp step:

```ts
const hooks =
  opts.hooks === false || !selected.some((h) => h.id === 'agents')
    ? []
    : installCodexHooks(home);
return { written, skipped, unknown, mcp, hooks };
```

In `src/cli.ts`: `.option("--no-hooks", "skip hook installation for other agents")`, pass `hooks: opts.hooks`, print `for (const h of r.hooks) console.error(\`✓ hook ${h.id}: ${h.path} (${h.action})\`);`.

In `README.md`, add one sentence to the "## Agent integration" intro paragraph (after the MCP subsection reference): "Where a CLI agent supports user-level `hooks.json`, `init` also installs Graft's post-edit hook — blast-radius warnings and automatic `$0` graph re-sync after edits (skip with `--no-hooks`)."

- [ ] **Step 4: Full suite** — `node --import tsx --test test/*.test.ts` all green.

- [ ] **Step 5: Commit**

```bash
git add src/hosts/init.ts src/cli.ts test/hosts-init.test.ts README.md
git commit -m "feat(init): install post-edit hooks for CLI agents (--no-hooks to skip)"
```

---

## Out of scope

- Hooks for hosts whose event/config schema we could not verify from at least two independent sources. They keep the instruction-file + MCP layers.
- Prompt-time retrieval injection outside Claude Code (no equivalent event exists in the verified hooks.json schema).

## Self-Review

- Coverage: runtime event (T1), installer (T2), wiring/docs (T3). ✓
- Placeholders: T1 Step 1 delegates fixture specifics to the existing test file by design (the plan cannot know private helper names); its assertions are fully specified. Everything else is complete code. ✓
- Type consistency: `HookWrite` defined T2, consumed T3; `runHostsInit` extension additive. ✓
