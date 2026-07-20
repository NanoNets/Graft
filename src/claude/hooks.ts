import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, basename } from 'node:path';
import { readWiring } from './stats.js';
import { formatBlastRadius, formatRetrieval, retrievalTokensSaved, formatOrientation } from './format.js';
import { patchStats, readStats, acquireLock, readSession, writeSession } from './state.js';
import { graftCliPath, claudeScriptPath } from './paths.js';

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
    const out = execFileSync(process.execPath, [graftCliPath(), ...args],
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

  if (event === 'post-edit') {
    const file: string | undefined = input?.tool_input?.file_path;
    if (!file || underGraft(dir, file)) return;
    patchStats(dir, { dirty: true, staleCount: checkStaleCount(dir), lastFile: basename(file) });
    const w = readWiring(dir);
    if (w) { const br = formatBlastRadius(w, file); if (br) emit('PostToolUse', br); }
    return;
  }

  if (event === 'stop') {
    // sync-run.js ships next to this module inside the package, so it resolves in
    // any repo that installs graft (not just graft's own). Defensive existsSync:
    // if the package is somehow incomplete, skip rather than wedge on syncing:true.
    const syncRun = claudeScriptPath('sync-run.js');
    if (!existsSync(syncRun)) return;
    const stats = readStats(dir);
    if (stats?.dirty && acquireLock(dir)) {
      patchStats(dir, { syncing: true });
      const child = spawn(process.execPath, [syncRun, dir], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return;
  }

  if (event === 'prompt') {
    const prompt = String(input?.prompt ?? '').trim();
    if (prompt.length < 8) return;
    // --source: inline the actual code spans so the injected pack is substitutive
    // (the agent reads the span here instead of opening the file), and so `ask`
    // returns the `saved` baseline used for the tokens-saved line.
    const ask = graftJson(dir, ['ask', prompt, '.', '--json', '--source', '-n', '5']);
    if (!ask) return;
    const txt = formatRetrieval(ask);
    if (!txt) return;
    emit('UserPromptSubmit', txt);
    const id = input.session_id || 'default';
    const s = readSession(dir, id);
    s.lastQuery = prompt;
    // Accumulate tokens saved this session (baseline − pack), so the statusline
    // can show a running total. Guarded: only when `ask` returned a baseline.
    const saved = retrievalTokensSaved(ask);
    if (saved > 0) s.savedTokens = (s.savedTokens ?? 0) + saved;
    const agent = input?.agent?.name;
    if (agent) s.perAgentQuery[agent] = prompt;
    writeSession(dir, id, s);
  }
}
