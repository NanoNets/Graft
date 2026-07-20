# `graft init` — one-command onboarding for the Claude Code integration

**Date:** 2026-07-20
**Status:** Draft for review
**Owner:** Shrish
**Scope:** One implementation plan. Builds on the shipped `.claude/` integration (`src/claude/*`).

## 1. Goal

Make the Claude Code integration work in **any** repo that installs `@nanonets/graft`, not just Graft's own repo. After install, a single command wires everything up:

```
npm i -D @nanonets/graft      # postinstall prints a one-line nudge
npx graft init                # scaffolds .claude/, builds the graph — done
# open Claude Code in the repo → statusline + hooks + auto-sync live
```

## 2. Why it doesn't work today (the two gaps)

1. **Shims resolve the wrong place.** `.claude/helpers/graft-*.cjs` import `<CLAUDE_PROJECT_DIR>/dist/claude/*.js` — the *consumer's* dist, which only exists in Graft's own repo. In any other repo that path is empty, so the statusline/hooks silently no-op.
2. **No installer.** The `.claude/settings.json` + shims exist in Graft's repo only because they were hand-authored. A fresh `npm i @nanonets/graft` drops zero `.claude/` files.

Also relevant: `package.json` has a **restrictive `exports` map** (`"."` only), so a consumer shim cannot `import('@nanonets/graft/dist/claude/…')` — Node blocks non-declared subpaths. The fix resolves the package's location on disk and dynamic-imports the **absolute** file path (which bypasses `exports`).

## 3. Scope

**In scope:**
- Smart shims that resolve the installed package (with a local-build fallback for Graft's own repo).
- `exports` addition: `"./package.json": "./package.json"` (guarantees the resolve).
- `graft init` command: merge settings, write shims, build graph if absent, print next steps. Idempotent.
- `postinstall` nudge script.
- Version bump to `0.3.0` and publish.

**Out of scope (deferred):**
- An interactive wizard / key prompt flow (init just *tells* the user about `OPENROUTER_API_KEY`).
- `graft init --uninstall` / teardown.
- A `graft doctor` health check for the integration.
- Auto-writing `.claude/` from `postinstall` (rejected — invasive, skipped under `--ignore-scripts`, can't prompt).

## 4. Design

### 4.1 Smart shim resolution (the core fix)

`graft init` writes each shim so it resolves the integration from wherever Graft actually lives:

```js
// .claude/helpers/graft-statusline.cjs
#!/usr/bin/env node
const path = require('path');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
function entry(name) {
  try {
    // consumer repo: graft is an installed dependency
    const pkg = require.resolve('@nanonets/graft/package.json', { paths: [dir] });
    return path.join(path.dirname(pkg), 'dist', 'claude', name);
  } catch {
    // graft's own repo (dogfood): compiled into ./dist
    return path.join(dir, 'dist', 'claude', name);
  }
}
import(entry('statusline.js')).then((m) => m.main()).catch(() => { /* best-effort */ });
```

The hooks shim is identical except it imports `entry('hooks.js')` and calls `m.main(process.argv[2])`.

- Absolute-path `import()` is **not** subject to the `exports` map, so this works despite `"."`-only exports.
- Fallback path keeps Graft's own repo working (there, `@nanonets/graft` is not in `node_modules`, so `require.resolve` throws and we use `./dist`).
- Graft's **own committed** `.claude/helpers/*.cjs` are updated to this same smart form (single shim shape for both cases).

### 4.2 `package.json` change

Add `"./package.json"` to `exports` so `require.resolve('@nanonets/graft/package.json', …)` is guaranteed under strict resolution:

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./package.json": "./package.json"
}
```

### 4.3 Settings merge (never clobber)

`mergeGraftSettings(existing) → { merged, warnings }`, a pure function:
- **statusLine:** set Graft's only if absent. If the user already has a `statusLine`, **skip it and emit a warning** (a session can have only one). subagentStatusLine: same rule.
- **hooks:** for each of `PostToolUse` / `UserPromptSubmit` / `SessionStart` / `Stop`, **append** Graft's hook entry to any existing array (create the array if absent). Dedupe: if a Graft entry (identified by the `graft-hooks.cjs` command string) is already present for that event, replace it rather than duplicate — makes re-running init idempotent.
- **footerLinksRegexes:** add Graft's regex if not already present (union, deduped).
- Everything else in the existing settings is preserved untouched.

### 4.4 `graft init` command

`graft init [dir] [--no-build]`:
1. Resolve target dir (arg or cwd).
2. Read existing `.claude/settings.json` (or `{}`); compute `mergeGraftSettings`; write it back (pretty JSON). Print any warnings.
3. Write `.claude/helpers/graft-statusline.cjs` and `graft-hooks.cjs` (smart shims), `chmod +x`.
4. If no `graft/.graph/wiring.json` exists and not `--no-build`: run a structural `graft build` ($0). Never `--deep`.
5. Print a short next-steps block: what was written, that the integration activates in Claude Code sessions here, and that `OPENROUTER_API_KEY` + `graft build --deep` enriches summaries.
6. Idempotent: re-running updates in place, no duplicates.

Implemented as `runInit(dir, { build }): InitResult` in `src/claude/init.ts`; `cli.ts` adds `.command("init")`.

### 4.5 Install nudge (`postinstall`)

`scripts/postinstall.mjs`, wired as `"postinstall"` in `package.json`:
- Prints one line: `Graft installed. Run \`npx graft init\` to enable the Claude Code integration (statusline + hooks + auto-sync).`
- **Never fails the install:** wrapped so any error exits 0.
- **Quiet when noise would hurt:** skip if `CI` is set, if `.claude/helpers/graft-statusline.cjs` already exists (already initialized), or if not a TTY-ish interactive install (best-effort check). Skipping is silent.

### 4.6 Money guard (unchanged, still binding)

`graft init`'s build step and everything downstream run only plain `graft build` — structural, offline, `$0`. Never `--deep`. Enrichment stays a manual, explicit, keyed step.

## 5. File structure

**Created:**
- `src/claude/settings-merge.ts` — `mergeGraftSettings` (pure) + the Graft block constants.
- `src/claude/shim-template.ts` — `statuslineShim()` / `hooksShim()` returning the `.cjs` source strings.
- `src/claude/init.ts` — `runInit(dir, opts)` orchestration.
- `scripts/postinstall.mjs` — the nudge.
- `test/claude-settings-merge.test.ts`, `test/claude-init.test.ts` — tests.

**Modified:**
- `src/cli.ts` — add the `init` command.
- `.claude/helpers/graft-statusline.cjs`, `.claude/helpers/graft-hooks.cjs` — updated to the smart-resolution form.
- `package.json` — `exports["./package.json"]`, `scripts.postinstall`, version `0.3.0`.

## 6. Testing

- **settings-merge (unit):** empty settings → full Graft blocks; existing foreign `statusLine` → skipped + warning; existing hooks array → Graft appended; re-run → idempotent (no dupes); foreign keys preserved.
- **shim-template (unit):** generated source is valid JS (loads via `require`/`new Function`) and contains both the package-resolve and the local-fallback branches.
- **init (integration):** run `runInit` in a temp dir → asserts `.claude/settings.json` + both shims written, graph build skipped with `--no-build`, and a second run is idempotent.
- **consumer smoke (manual, in verification task):** create a throwaway dir with a fake `node_modules/@nanonets/graft` (symlink to the built package), run the written statusline shim with a stdin payload, confirm it resolves the package path and renders (not "not built").
- Full suite stays green; `npm run build` clean.

## 7. Publish (after the branch merges / or from the branch once green)

- Bump `0.3.0` (minor — additive feature, no breaking change to existing CLI).
- `npm publish` requires **security-key 2FA** — use the established pseudo-TTY + auto-ENTER recipe so npm opens the browser and the key is tapped in one shot (tokens expire fast; a publish 404 means auth, not a missing package).
- Post-publish verify: `npm view @nanonets/graft version` shows `0.3.0`; a scratch `npm i @nanonets/graft && npx graft init` in a temp repo wires up and renders.

## 8. Open decisions

1. **`graft init` runs `graft build` by default** (with `--no-build` to skip). Confirmed: yes — keeps "one command → everything in place" true.
2. **postinstall nudge verbosity:** one line, skipped in CI / when already initialized. (Leaning: as specified — minimal.)
