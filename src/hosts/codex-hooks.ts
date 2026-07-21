/**
 * Active-layer install for CLI agents that read user-level hooks.json with
 * PostToolUse semantics. Writes the shared hook shim and one PostToolUse
 * entry that runs post-edit + background sync after every file edit.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hooksShim } from '../claude/shim-template.js';
import { claudeDistDir } from '../claude/paths.js';

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
  if (existed && readFileSync(path, 'utf8') === content) {
    if (mode !== undefined && (statSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
    return { id, path, action: 'unchanged' };
  }
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
  const shimWrite = writeOwned('codex-hook-shim', shimPath, hooksShim(claudeDistDir()), 0o755);

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
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) {
    return [shimWrite, { id: 'codex-hooks', path: cfgPath, action: 'skipped-unparseable' }];
  }
  if (hooks.PostToolUse !== undefined && !Array.isArray(hooks.PostToolUse)) {
    return [shimWrite, { id: 'codex-hooks', path: cfgPath, action: 'skipped-unparseable' }];
  }
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
