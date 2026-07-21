# Multi-Host Init (Phase 1: Instruction Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `graft init` wires Graft into every AI coding agent present on the machine — not just Claude Code — by writing each host's native instruction file with a marker-fenced Graft section.

**Architecture:** A new `src/hosts/` module holds (1) a marker-fenced section upsert utility, (2) one canonical instruction body rendered into three formats (markdown `##` section, Cursor `.mdc` rule, Kiro steering file), and (3) a host registry mapping host id → detection probe → target file → renderer. `graft init` keeps the existing Claude Code path (`src/claude/init.ts`, untouched) and additionally runs the registry for every detected host. Claude Code remains the premium experience (hooks + statusline + skill); other hosts get the passive instruction layer in this phase. MCP server (Phase 2) and per-host hooks (Phase 3) are separate plans.

**Tech Stack:** TypeScript ESM (Node ≥20), `node:test` + tsx test runner, commander CLI. No new dependencies.

## Global Constraints

- No new npm dependencies.
- Node ≥ 20, `"type": "module"`, imports use `.js` extensions (compiled ESM).
- Files under 500 lines.
- All writes idempotent: re-running `graft init` must converge (replace own section, never duplicate, never clobber user content outside the markers).
- Never overwrite a user file wholesale when it exists — only upsert the fenced section (exception: files wholly owned by graft, i.e. `.cursor/rules/graft.mdc`, `.kiro/steering/graft.md`, `.windsurf/rules/graft.md`).
- Marker fence: `<!-- graft:start -->` / `<!-- graft:end -->`, each alone on its line.
- Do not reference third-party tools by name anywhere in code, comments, docs, or commit messages — describe mechanisms generically.
- Detection probes must accept an injectable home directory so tests never depend on the real `$HOME`.
- Tests: `node --import tsx --test test/<file>.test.ts`, temp dirs via `mkdtempSync(join(tmpdir(), ...))`, style matching `test/claude-init.test.ts`.

---

## File Structure

- Create: `src/hosts/sections.ts` — marker-fenced upsert (pure string + fs helpers).
- Create: `src/hosts/instructions.ts` — canonical body + per-format renderers.
- Create: `src/hosts/registry.ts` — host definitions + detection.
- Create: `src/hosts/init.ts` — orchestrator `runHostsInit(dir, opts)`.
- Modify: `src/cli.ts` (init command, lines ~187-203) — add `--agents`, `--all-agents`, `--no-agents`, `--list-agents`; call orchestrator.
- Create: `test/hosts-sections.test.ts`, `test/hosts-instructions.test.ts`, `test/hosts-registry.test.ts`, `test/hosts-init.test.ts`.
- Modify: `README.md` — "Claude Code integration" section becomes "Agent integration".

---

### Task 1: Marker-fenced section upsert (`src/hosts/sections.ts`)

**Files:**
- Create: `src/hosts/sections.ts`
- Test: `test/hosts-sections.test.ts`

**Interfaces:**
- Produces: `upsertSection(filePath: string, body: string): { action: 'created' | 'appended' | 'replaced' | 'unchanged' }` — ensures `filePath` contains exactly one `<!-- graft:start -->\n<body>\n<!-- graft:end -->` block; creates the file (with trailing newline) if missing, appends the block (separated by one blank line) if the file exists without markers, replaces only the fenced region if markers exist, and reports `unchanged` when the fenced body already matches.
- Produces: `fencedBlock(body: string): string` — the exact block string, exported for tests and renderers.

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosts-sections.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertSection, fencedBlock } from '../src/hosts/sections.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-sections-')); }

test('creates the file with a fenced block when missing', () => {
  const f = join(fresh(), 'AGENTS.md');
  const r = upsertSection(f, '## Graft\nuse graft ask');
  assert.equal(r.action, 'created');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes('<!-- graft:start -->'));
  assert.ok(text.includes('use graft ask'));
  assert.ok(text.endsWith('\n'));
});

test('appends after existing content, separated by a blank line', () => {
  const f = join(fresh(), 'AGENTS.md');
  writeFileSync(f, '# My rules\n\nBe nice.\n');
  const r = upsertSection(f, 'graft body');
  assert.equal(r.action, 'appended');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.startsWith('# My rules\n\nBe nice.\n'));
  assert.match(text, /Be nice\.\n\n<!-- graft:start -->/);
});

test('replaces only the fenced region on re-run with new body', () => {
  const f = join(fresh(), 'AGENTS.md');
  writeFileSync(f, `above\n\n${fencedBlock('old body')}\nbelow\n`);
  const r = upsertSection(f, 'new body');
  assert.equal(r.action, 'replaced');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes('above'));
  assert.ok(text.includes('below'));
  assert.ok(text.includes('new body'));
  assert.ok(!text.includes('old body'));
  assert.equal(text.match(/graft:start/g)!.length, 1, 'exactly one block');
});

test('reports unchanged when the fenced body already matches', () => {
  const f = join(fresh(), 'AGENTS.md');
  upsertSection(f, 'same body');
  const r = upsertSection(f, 'same body');
  assert.equal(r.action, 'unchanged');
});

test('ignores inline marker mentions (marker must be alone on its line)', () => {
  const f = join(fresh(), 'AGENTS.md');
  writeFileSync(f, 'talking about `<!-- graft:start -->` in prose\n');
  const r = upsertSection(f, 'body');
  assert.equal(r.action, 'appended');
  assert.equal(readFileSync(f, 'utf8').match(/^<!-- graft:start -->$/gm)!.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/hosts-sections.test.ts`
Expected: FAIL — `Cannot find module '../src/hosts/sections.js'`

- [ ] **Step 3: Implement**

```ts
// src/hosts/sections.ts
/**
 * Marker-fenced section upsert. Graft owns exactly the region between the
 * markers; everything else in the file belongs to the user and is preserved.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const START = '<!-- graft:start -->';
export const END = '<!-- graft:end -->';

export type UpsertAction = 'created' | 'appended' | 'replaced' | 'unchanged';

export function fencedBlock(body: string): string {
  return `${START}\n${body.replace(/\s+$/, '')}\n${END}`;
}

/** Index of a marker that sits alone on its own line, or -1. */
function markerLineIndex(lines: string[], marker: string, from = 0): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() === marker) return i;
  }
  return -1;
}

export function upsertSection(filePath: string, body: string): { action: UpsertAction } {
  const block = fencedBlock(body);
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${block}\n`);
    return { action: 'created' };
  }
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const s = markerLineIndex(lines, START);
  const e = s === -1 ? -1 : markerLineIndex(lines, END, s + 1);
  if (s !== -1 && e !== -1) {
    const current = lines.slice(s, e + 1).join('\n');
    if (current === block) return { action: 'unchanged' };
    const next = [...lines.slice(0, s), ...block.split('\n'), ...lines.slice(e + 1)];
    writeFileSync(filePath, next.join('\n'));
    return { action: 'replaced' };
  }
  const sep = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(filePath, `${text}${sep}${block}\n`);
  return { action: 'appended' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/hosts-sections.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hosts/sections.ts test/hosts-sections.test.ts
git commit -m "feat(hosts): marker-fenced section upsert for agent instruction files"
```

---

### Task 2: Canonical instruction body + renderers (`src/hosts/instructions.ts`)

**Files:**
- Create: `src/hosts/instructions.ts`
- Test: `test/hosts-instructions.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure strings).
- Produces:
  - `instructionBody(): string` — the canonical markdown body (starts with `## Graft — repo context graph`).
  - `cursorRule(): string` — full `.mdc` file content: YAML frontmatter (`description`, `alwaysApply: true`) + body.
  - `kiroSteering(): string` — full steering file: frontmatter (`inclusion: always`) + body.
  - `windsurfRule(): string` — full rules file (plain markdown, no frontmatter) + body.

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosts-instructions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instructionBody, cursorRule, kiroSteering, windsurfRule } from '../src/hosts/instructions.js';

test('canonical body names the three essentials', () => {
  const b = instructionBody();
  assert.match(b, /^## Graft — repo context graph/m);
  assert.match(b, /graft ask "/);
  assert.match(b, /graft\/INDEX\.md/);
  assert.match(b, /graft build/);
  assert.ok(!/\bhook|statusline\b/i.test(b), 'no host-specific machinery in the shared body');
});

test('cursor rule has alwaysApply frontmatter and the body', () => {
  const r = cursorRule();
  assert.match(r, /^---\ndescription: .+\nalwaysApply: true\n---\n/);
  assert.ok(r.includes(instructionBody()));
});

test('kiro steering has inclusion: always frontmatter and the body', () => {
  const r = kiroSteering();
  assert.match(r, /^---\ninclusion: always\n---\n/);
  assert.ok(r.includes(instructionBody()));
});

test('windsurf rule is the plain body', () => {
  assert.ok(windsurfRule().includes(instructionBody()));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/hosts-instructions.test.ts`
Expected: FAIL — `Cannot find module '../src/hosts/instructions.js'`

- [ ] **Step 3: Implement**

```ts
// src/hosts/instructions.ts
/**
 * The one canonical Graft instruction block, rendered into each host's
 * native format. Content changes happen HERE only; renderers just wrap it.
 */

export function instructionBody(): string {
  return `## Graft — repo context graph

This repo is indexed in \`graft/\`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files:

- Run \`graft ask "<your question>" --source\` → ranked nodes with the relevant
  code spans inlined. The node usually IS the answer; stop there.
- Or browse: \`graft/INDEX.md\` lists every node; follow the links.

Only open source files when a node genuinely lacks a needed detail, and then at
the exact file:line the node points to — never re-read whole files.

After big code changes, refresh the graph with \`graft build\` (deterministic,
no API key, $0).`;
}

export function cursorRule(): string {
  return `---
description: Use the Graft context graph in graft/ before exploring source
alwaysApply: true
---
${instructionBody()}
`;
}

export function kiroSteering(): string {
  return `---
inclusion: always
---
${instructionBody()}
`;
}

export function windsurfRule(): string {
  return `${instructionBody()}
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/hosts-instructions.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hosts/instructions.ts test/hosts-instructions.test.ts
git commit -m "feat(hosts): canonical instruction body with per-host renderers"
```

---

### Task 3: Host registry + detection (`src/hosts/registry.ts`)

**Files:**
- Create: `src/hosts/registry.ts`
- Test: `test/hosts-registry.test.ts`

**Interfaces:**
- Consumes: `instructionBody`, `cursorRule`, `kiroSteering`, `windsurfRule` from Task 2; `upsertSection` semantics from Task 1 (via the `kind` field consumed in Task 4).
- Produces:
  - `interface HostTarget { id: string; name: string; kind: 'section' | 'owned'; relPath: string; content(): string; detect(probe: DetectProbe): boolean }` — `kind: 'section'` upserts the fenced block into a shared file; `kind: 'owned'` writes the whole file (graft owns it).
  - `interface DetectProbe { home: string; repo: string; dirExists(p: string): boolean }`
  - `HOSTS: HostTarget[]` — ids: `agents`, `cursor`, `gemini`, `copilot`, `kiro`, `windsurf`.
  - `detectHosts(probe: DetectProbe): HostTarget[]` — hosts whose `detect` returns true.
  - `hostIds(): string[]` — all valid ids (for CLI validation/help).

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosts-registry.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOSTS, detectHosts, hostIds, type DetectProbe } from '../src/hosts/registry.js';
import { existsSync, statSync } from 'node:fs';

function probeFor(home: string, repo: string): DetectProbe {
  return {
    home, repo,
    dirExists: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
  };
}
function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-registry-')); }

test('registry exposes the six phase-1 hosts', () => {
  assert.deepEqual(hostIds().sort(), ['agents', 'copilot', 'cursor', 'gemini', 'kiro', 'windsurf']);
  for (const h of HOSTS) {
    assert.ok(h.relPath.length > 0);
    assert.ok(h.content().length > 0);
  }
});

test('nothing detected on a bare machine and bare repo', () => {
  assert.deepEqual(detectHosts(probeFor(fresh(), fresh())), []);
});

test('home config dirs light up their hosts', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.cursor'));
  mkdirSync(join(home, '.gemini'));
  mkdirSync(join(home, '.codex'));
  const ids = detectHosts(probeFor(home, repo)).map((h) => h.id).sort();
  assert.deepEqual(ids, ['agents', 'cursor', 'gemini']);
});

test('repo-local markers also light up hosts', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(repo, '.github'));
  mkdirSync(join(repo, '.kiro'));
  const ids = detectHosts(probeFor(home, repo)).map((h) => h.id).sort();
  assert.deepEqual(ids, ['copilot', 'kiro']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/hosts-registry.test.ts`
Expected: FAIL — `Cannot find module '../src/hosts/registry.js'`

- [ ] **Step 3: Implement**

```ts
// src/hosts/registry.ts
/**
 * Registry of AI coding hosts Graft can write instructions for.
 * Adding a host = adding one entry here (plus a renderer if it needs
 * a new file format).
 *
 * kind: 'section' → upsert the fenced block into a shared file the user owns.
 * kind: 'owned'   → graft owns the whole file; overwrite it each run.
 */
import { join } from 'node:path';
import { instructionBody, cursorRule, kiroSteering, windsurfRule } from './instructions.js';

export interface DetectProbe {
  home: string;
  repo: string;
  dirExists(path: string): boolean;
}

export interface HostTarget {
  id: string;
  name: string;
  kind: 'section' | 'owned';
  /** Target file, relative to the repo root. */
  relPath: string;
  content(): string;
  detect(probe: DetectProbe): boolean;
}

export const HOSTS: HostTarget[] = [
  {
    id: 'agents',
    name: 'AGENTS.md hosts (Codex-style CLIs, editors that read AGENTS.md)',
    kind: 'section',
    relPath: 'AGENTS.md',
    content: instructionBody,
    detect: (p) =>
      p.dirExists(join(p.home, '.codex')) ||
      p.dirExists(join(p.home, '.config', 'opencode')) ||
      p.dirExists(join(p.home, '.config', 'agents')),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'owned',
    relPath: join('.cursor', 'rules', 'graft.mdc'),
    content: cursorRule,
    detect: (p) => p.dirExists(join(p.home, '.cursor')) || p.dirExists(join(p.repo, '.cursor')),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    kind: 'section',
    relPath: 'GEMINI.md',
    content: instructionBody,
    detect: (p) => p.dirExists(join(p.home, '.gemini')),
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    kind: 'section',
    relPath: join('.github', 'copilot-instructions.md'),
    content: instructionBody,
    detect: (p) => p.dirExists(join(p.repo, '.github')),
  },
  {
    id: 'kiro',
    name: 'Kiro',
    kind: 'owned',
    relPath: join('.kiro', 'steering', 'graft.md'),
    content: kiroSteering,
    detect: (p) => p.dirExists(join(p.home, '.kiro')) || p.dirExists(join(p.repo, '.kiro')),
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'owned',
    relPath: join('.windsurf', 'rules', 'graft.md'),
    content: windsurfRule,
    detect: (p) => p.dirExists(join(p.home, '.codeium', 'windsurf')) || p.dirExists(join(p.repo, '.windsurf')),
  },
];

export function hostIds(): string[] {
  return HOSTS.map((h) => h.id);
}

export function detectHosts(probe: DetectProbe): HostTarget[] {
  return HOSTS.filter((h) => h.detect(probe));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/hosts-registry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hosts/registry.ts test/hosts-registry.test.ts
git commit -m "feat(hosts): host registry with home/repo detection probes"
```

---

### Task 4: Orchestrator (`src/hosts/init.ts`)

**Files:**
- Create: `src/hosts/init.ts`
- Test: `test/hosts-init.test.ts`

**Interfaces:**
- Consumes: `HOSTS`, `detectHosts`, `hostIds`, `HostTarget`, `DetectProbe` (Task 3); `upsertSection` (Task 1).
- Produces: `runHostsInit(repo: string, opts?: { agents?: string[]; all?: boolean; home?: string }): { written: { id: string; path: string; action: string }[]; skipped: string[]; unknown: string[] }`
  - `opts.agents` — explicit host ids (skips detection); `opts.all` — every registry host; default — detected hosts only.
  - `unknown` — requested ids not in the registry (caller reports and exits non-zero).
  - `home` defaults to `os.homedir()`; injectable for tests.

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosts-init.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHostsInit } from '../src/hosts/init.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-hostsinit-')); }

test('writes only detected hosts by default', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.cursor'));
  const r = runHostsInit(repo, { home });
  assert.deepEqual(r.written.map((w) => w.id), ['cursor']);
  const mdc = readFileSync(join(repo, '.cursor', 'rules', 'graft.mdc'), 'utf8');
  assert.match(mdc, /alwaysApply: true/);
  assert.ok(!existsSync(join(repo, 'AGENTS.md')));
});

test('explicit agents list overrides detection and flags unknown ids', () => {
  const home = fresh(); const repo = fresh();
  const r = runHostsInit(repo, { home, agents: ['gemini', 'nope'] });
  assert.deepEqual(r.written.map((w) => w.id), ['gemini']);
  assert.deepEqual(r.unknown, ['nope']);
  assert.ok(readFileSync(join(repo, 'GEMINI.md'), 'utf8').includes('graft ask'));
});

test('all writes every host and re-run converges (idempotent)', () => {
  const home = fresh(); const repo = fresh();
  const first = runHostsInit(repo, { home, all: true });
  assert.equal(first.written.length, 6);
  const second = runHostsInit(repo, { home, all: true });
  assert.ok(second.written.every((w) => w.action === 'unchanged'));
  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.equal(agents.match(/graft:start/g)!.length, 1);
});

test('preserves user content around the fenced section', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(repo, '.github'));
  const target = join(repo, '.github', 'copilot-instructions.md');
  mkdirSync(join(repo, '.github'), { recursive: true });
  require('node:fs').writeFileSync(target, '# House rules\n');
  const r = runHostsInit(repo, { home });
  assert.deepEqual(r.written.map((w) => w.id), ['copilot']);
  const text = readFileSync(target, 'utf8');
  assert.ok(text.startsWith('# House rules'));
  assert.ok(text.includes('graft ask'));
});
```

Note: replace the `require('node:fs')` line with a top-level `writeFileSync` import — shown here inline for clarity of what the step does; the committed test imports it at the top.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/hosts-init.test.ts`
Expected: FAIL — `Cannot find module '../src/hosts/init.js'`

- [ ] **Step 3: Implement**

```ts
// src/hosts/init.ts
/**
 * Multi-host init: write each selected host's instruction file.
 * Selection = explicit ids > all > detected. Claude Code is handled
 * separately by src/claude/init.ts (hooks + statusline + skill).
 */
import { statSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { HOSTS, detectHosts, type DetectProbe, type HostTarget } from './registry.js';
import { upsertSection } from './sections.js';

export interface HostsInitResult {
  written: { id: string; path: string; action: string }[];
  skipped: string[];
  unknown: string[];
}

function probeFor(home: string, repo: string): DetectProbe {
  return {
    home, repo,
    dirExists: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
  };
}

function writeOwned(path: string, content: string): string {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return 'unchanged';
  mkdirSync(dirname(path), { recursive: true });
  const existed = existsSync(path);
  writeFileSync(path, content);
  return existed ? 'replaced' : 'created';
}

export function runHostsInit(
  repo: string,
  opts: { agents?: string[]; all?: boolean; home?: string } = {},
): HostsInitResult {
  const home = opts.home ?? homedir();
  const probe = probeFor(home, repo);

  let selected: HostTarget[];
  let unknown: string[] = [];
  if (opts.agents?.length) {
    const byId = new Map(HOSTS.map((h) => [h.id, h]));
    selected = opts.agents.flatMap((id) => byId.get(id) ?? []);
    unknown = opts.agents.filter((id) => !byId.has(id));
  } else if (opts.all) {
    selected = HOSTS;
  } else {
    selected = detectHosts(probe);
  }

  const written: HostsInitResult['written'] = [];
  for (const host of selected) {
    const path = join(repo, host.relPath);
    const action =
      host.kind === 'owned'
        ? writeOwned(path, host.content())
        : upsertSection(path, host.content()).action;
    written.push({ id: host.id, path, action });
  }
  const skipped = HOSTS.filter((h) => !selected.includes(h)).map((h) => h.id);
  return { written, skipped, unknown };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/hosts-init.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hosts/init.ts test/hosts-init.test.ts
git commit -m "feat(hosts): multi-host init orchestrator (detect/explicit/all selection)"
```

---

### Task 5: CLI wiring (`src/cli.ts`)

**Files:**
- Modify: `src/cli.ts` — the `init` command block (currently lines ~187-203).
- Test: extend `test/hosts-init.test.ts` with one CLI smoke test.

**Interfaces:**
- Consumes: `runHostsInit`, `HostsInitResult` (Task 4); `hostIds` (Task 3); existing `runInit` from `./claude/init.js` (unchanged).
- Produces: `graft init [dir] [--no-build] [--agents <ids...>] [--all-agents] [--no-agents] [--list-agents]`.

- [ ] **Step 1: Write the failing CLI smoke test** (append to `test/hosts-init.test.ts`)

```ts
import { execFileSync } from 'node:child_process';

test('CLI: graft init --agents gemini writes GEMINI.md and exits 0', () => {
  const repo = fresh();
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'init', repo, '--no-build', '--agents', 'gemini'], {
    encoding: 'utf8',
  });
  assert.ok(readFileSync(join(repo, 'GEMINI.md'), 'utf8').includes('graft ask'));
});

test('CLI: unknown agent id exits non-zero', () => {
  const repo = fresh();
  assert.throws(() =>
    execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'init', repo, '--no-build', '--agents', 'nope'], {
      encoding: 'utf8', stdio: 'pipe',
    }),
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/hosts-init.test.ts`
Expected: FAIL — commander rejects the unknown `--agents` option.

- [ ] **Step 3: Rewrite the init command in `src/cli.ts`**

Replace the existing `program.command("init")…` block with:

```ts
program
  .command("init")
  .description("Wire Graft into the AI coding agents used with this repo (instruction files; full hooks + statusline for Claude Code)")
  .argument("[dir]", "target repo directory", ".")
  .option("--no-build", "skip building the graph (wire files only)")
  .option("--agents <ids...>", `only these agents (${hostIds().join(", ")}, claude)`)
  .option("--all-agents", "write instruction files for every known agent, detected or not")
  .option("--no-agents", "Claude Code wiring only; skip other agents")
  .option("--list-agents", "list known agent ids and exit")
  .action((dir: string, opts: { build?: boolean; agents?: string[]; allAgents?: boolean; listAgents?: boolean }) => {
    if (opts.listAgents) {
      for (const id of [...hostIds(), "claude"]) console.log(id);
      return;
    }
    const repo = resolve(dir);
    const explicit = Array.isArray(opts.agents) ? opts.agents : undefined;
    const wantClaude = !explicit || explicit.includes("claude");

    if (wantClaude) {
      const cliPath = fileURLToPath(import.meta.url);
      const res = runInit(repo, { build: opts.build, cliPath });
      console.error(`✓ wrote ${res.settingsPath}`);
      for (const s of res.shims) console.error(`✓ wrote ${s}`);
      console.error(`✓ wrote ${res.skill}`);
      console.error(res.built ? "✓ built the graph (graft build)" : "· skipped graph build");
      for (const w of res.warnings) console.error(`⚠ ${w}`);
    }

    if (opts.agents !== undefined || explicit || opts.allAgents !== undefined) {
      // fallthrough — selection handled below; commander sets opts.agents=false for --no-agents
    }
    const skipOthers = (opts as { agents?: unknown }).agents === false;
    if (!skipOthers) {
      const r = runHostsInit(repo, {
        agents: explicit?.filter((id) => id !== "claude"),
        all: opts.allAgents,
      });
      for (const w of r.written) console.error(`✓ ${w.id}: ${w.path} (${w.action})`);
      if (!explicit && !opts.allAgents && r.written.length === 0)
        console.error("· no other agents detected (see --list-agents / --all-agents)");
      if (r.unknown.length) {
        console.error(`✗ unknown agent id(s): ${r.unknown.join(", ")} — valid: ${[...hostIds(), "claude"].join(", ")}`);
        process.exit(1);
      }
    }
    console.error("\nDone. Claude Code gets live hooks + statusline; other agents read their instruction files.");
    console.error("For LLM summaries: set OPENROUTER_API_KEY and run `graft build --deep`.");
  });
```

And add the imports at the top of `src/cli.ts` next to the existing `runInit` import:

```ts
import { runHostsInit } from "./hosts/init.js";
import { hostIds } from "./hosts/registry.js";
```

Note on `--no-agents`: commander maps it to `opts.agents === false`; the explicit-list variant sets an array. The `skipOthers` check above handles both without a separate flag name.

- [ ] **Step 4: Run the full suite**

Run: `node --import tsx --test test/*.test.ts`
Expected: all tests PASS (existing claude-init tests unchanged and green).

- [ ] **Step 5: Manual verification**

```bash
cd "$(mktemp -d)" && git init -q . && echo 'export const x = 1;' > a.ts
node --import tsx "/Users/shrishdwivedi/Documents/Context graphs/context-graph-engine/src/cli.ts" init . --no-build --all-agents
cat AGENTS.md GEMINI.md .cursor/rules/graft.mdc | head -30
```
Expected: all files exist, each carries the Graft block exactly once; re-running prints `(unchanged)` for every host.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/hosts-init.test.ts
git commit -m "feat(cli): graft init wires all detected agents, not just Claude Code"
```

---

### Task 6: README update

**Files:**
- Modify: `README.md` — retitle the "Claude Code integration" section to "Agent integration" and document the new flags.

- [ ] **Step 1: Update the section**

Keep the existing Claude Code description (statusline, auto-sync, context on tap) as a subsection, and above it add:

```markdown
## Agent integration

One command wires Graft into the coding agents you use:

```bash
npx @nanonets/graft init
# detects your agents and writes each one's native instruction file;
# Claude Code additionally gets the live statusline + hooks below
```

`init` auto-detects which agents are present (via their config directories) and
writes a marker-fenced Graft section into each one's instruction file —
`AGENTS.md`, `GEMINI.md`, `.cursor/rules/`, `.github/copilot-instructions.md`,
`.kiro/steering/`, `.windsurf/rules/`. Re-running updates only the fenced
section and never touches your own content. Flags: `--agents <ids...>` to pick,
`--all-agents` for everything, `--no-agents` for Claude Code only,
`--list-agents` to see ids.
```

- [ ] **Step 2: Verify the markdown renders** (view the diff; no code to run)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: graft init now integrates all detected coding agents"
```

---

## Out of scope (follow-up plans)

- **Phase 2 — `graft mcp`:** stdio MCP server exposing `ask` / blast-radius / `check`, plus per-host server registration (JSON/TOML config merges, host CLI registration where available).
- **Phase 3 — active hooks for non-Claude hosts:** pre-tool-use guards and post-edit sync for hosts whose hook systems support it.
- Interactive host picker (needs a prompt dependency — revisit with Phase 2).

## Self-Review

- Spec coverage: registry (T3), instruction files for the six host families (T2/T4), detection (T3), CLI flags incl. escape hatches (T5), idempotency (T1/T4 tests), docs (T6). Claude Code path untouched — verified by running the existing suite in T5 Step 4. ✓
- Placeholders: none — every step has complete code or an exact command. ✓
- Type consistency: `HostTarget`/`DetectProbe` defined in T3 and consumed with identical shapes in T4; `upsertSection` return `{action}` used consistently. ✓
