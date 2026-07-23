import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, basename } from 'node:path';
import { readWiring } from './stats.js';
import { formatBlastRadius, relevantRetrieval, formatOrientation } from './format.js';
import { patchStats, readStats, acquireLock, readSession, writeSession } from './state.js';
import { graftCliPath, claudeScriptPath } from './paths.js';
import { scopeOf, scopesOfGraph } from '../graph/scopes.js';

/** Prompts shorter than this never trigger retrieval — they are almost always
 * conversational ("yes go ahead", "thanks") and the coverage gate can't judge
 * them reliably with so few terms. */
const MIN_PROMPT_CHARS = 12;

function readStdin(): any {
  const seam = process.env.GRAFT_TEST_STDIN;
  const raw = seam !== undefined ? seam : safeReadFd0();
  try { return JSON.parse(raw); } catch { return {}; }
}
function safeReadFd0(): string { try { return readFileSync(0, 'utf8'); } catch { return ''; } }

function projectDir(input: any): string {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}
export function underGraft(dir: string, file: string): boolean {
  const rel = file.startsWith(dir) ? file.slice(dir.length) : file;
  return rel.replace(/^[/\\]+/, '').replace(/\\/g, '/').startsWith('graft/');
}
function graftJson(dir: string, args: string[]): any | null {
  try {
    // GRAFT_TEST_CLI is a test seam (mirrors GRAFT_TEST_STDIN/GRAFT_TEST_SYNC_RUN) so
    // tests can point the prompt hook's `graft ask`/`graft check` calls at a stub
    // script and observe the exact args it was invoked with, instead of shelling
    // out to the real CLI (which isn't built relative to the TS source under test).
    const cliPath = process.env.GRAFT_TEST_CLI ?? graftCliPath();
    const out = execFileSync(process.execPath, [cliPath, ...args],
      { cwd: dir, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch (e: any) {
    // `graft check` exits non-zero when the graph is stale (by design) but still
    // prints valid JSON to stdout; recover it from the thrown error before giving up.
    if (e && typeof e.stdout === 'string' && e.stdout.trim()) {
      try { return JSON.parse(e.stdout); } catch { /* not JSON — fall through */ }
    }
    return null;
  }
}
function checkStaleCount(dir: string): number {
  const r = graftJson(dir, ['check', '.', '--json']);
  const g = r?.graph ?? {};
  return (g.changed?.length ?? 0) + (g.added?.length ?? 0) + (g.removed?.length ?? 0);
}
function emit(eventName: string, additionalContext: string): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } }));
}

async function handlePostEdit(input: any, dir: string): Promise<void> {
  const file: string | undefined = input?.tool_input?.file_path;
  if (!file || underGraft(dir, file)) return;
  patchStats(dir, { dirty: true, staleCount: checkStaleCount(dir), lastFile: basename(file) });
  const w = readWiring(dir);
  if (w) { const br = formatBlastRadius(w, file); if (br) emit('PostToolUse', br); }
}

/**
 * The "you're working in backend/, weight it" hint: on a multi-scope repo,
 * narrow the prompt hook's `ask` call to whatever scope the last-edited file
 * (`stats.lastFile`, captured at {@link handlePostEdit}) sits in.
 *
 * `lastFile` is only a basename (not a repo-relative path — see
 * `handlePostEdit`), so this is a best-effort lookup against the CURRENT
 * graph: any file node whose path ends in `/<lastFile>` (or equals it, for a
 * repo-root file). Fails soft in every direction a hook must never crash on —
 * no graph, a single-scope graph, a lastFile no longer in the graph (moved,
 * deleted, or edited before the first build), or a basename that lands in
 * more than one scope (ambiguous: could be either sub-project) all skip the
 * hint silently, logging one line to stderr so the miss is visible without
 * ever failing the hook.
 */
export function lastFileScopeHint(dir: string, lastFile: string | null | undefined): string | null {
  if (!lastFile) return null;
  try {
    const w = readWiring(dir);
    if (!w) return null;
    const scopes = scopesOfGraph(w);
    if (scopes.length <= 1) return null; // single-scope: no hint, no --in
    const matches = (w.nodes ?? []).filter(
      (n) => n.kind === 'file' && (n.path === lastFile || n.path.endsWith(`/${lastFile}`)),
    );
    if (matches.length === 0) {
      console.error(`[graft] prompt hook: lastFile "${lastFile}" not found in the graph — skipping scope hint`);
      return null;
    }
    const prefixes = new Set(matches.map((n) => scopeOf(n.path, scopes).prefix));
    if (prefixes.size > 1) {
      console.error(`[graft] prompt hook: lastFile "${lastFile}" matches more than one scope — skipping scope hint`);
      return null;
    }
    const [prefix] = prefixes;
    return prefix === '' ? null : prefix; // root scope: nothing to narrow
  } catch (e: any) {
    console.error(`[graft] prompt hook: scope hint lookup failed (${e?.message ?? e}) — skipping`);
    return null;
  }
}

function handleStop(dir: string): void {
  // sync-run.js ships next to this module inside the package, so it resolves in
  // any repo that installs graft (not just graft's own). Defensive existsSync:
  // if the package is somehow incomplete, skip rather than wedge on syncing:true.
  // GRAFT_TEST_SYNC_RUN is a test seam (mirrors GRAFT_TEST_STDIN) so tests can point
  // this at a stub file inside their own sandbox instead of writing into src/claude/.
  const syncRun = process.env.GRAFT_TEST_SYNC_RUN ?? claudeScriptPath('sync-run.js');
  if (!existsSync(syncRun)) return;
  const stats = readStats(dir);
  if (stats?.dirty && acquireLock(dir)) {
    patchStats(dir, { syncing: true });
    const child = spawn(process.execPath, [syncRun, dir], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}

export async function main(event: string): Promise<void> {
  const input = readStdin();
  const dir = projectDir(input);

  if (event === 'session-start') {
    try {
      const idx = readFileSync(join(dir, 'graft', 'INDEX.md'), 'utf8');
      emit('SessionStart', formatOrientation(idx));
    } catch { /* no INDEX.md — skip */ }
    return;
  }

  if (event === 'post-edit') { await handlePostEdit(input, dir); return; }

  if (event === 'stop') { handleStop(dir); return; }

  if (event === 'post-edit-sync') { await handlePostEdit(input, dir); handleStop(dir); return; }

  if (event === 'prompt') {
    const prompt = String(input?.prompt ?? '').trim();
    if (prompt.length < MIN_PROMPT_CHARS) return;
    // Pointers-only, small, gated. No --source: per-prompt injected tokens are
    // fresh full-price input on every turn (unlike the cached SessionStart
    // orientation), so the pack carries locators, never inlined code — the agent
    // pulls spans itself via `graft ask --source` when a pointer looks right.
    // relevantRetrieval then drops the pack entirely when the prompt barely
    // overlaps the top hit or when every hit was already injected this session.
    const askArgs = ['ask', prompt, '.', '--json', '-n', '3'];
    // "You're working in backend/, weight it": only fires on a multi-scope
    // repo whose lastFile resolves cleanly to one scope — see lastFileScopeHint.
    const scopeHint = lastFileScopeHint(dir, readStats(dir)?.lastFile);
    if (scopeHint) askArgs.push('--in', scopeHint);
    const ask = graftJson(dir, askArgs);
    if (!ask) return;
    const id = input.session_id || 'default';
    const s = readSession(dir, id);
    s.lastQuery = prompt;
    const agent = input?.agent?.name;
    if (agent) s.perAgentQuery[agent] = prompt;
    const txt = relevantRetrieval(ask, s);
    if (txt) emit('UserPromptSubmit', txt);
    writeSession(dir, id, s);
  }
}
