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
