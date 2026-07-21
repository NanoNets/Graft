import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeGraftSettings } from './settings-merge.js';
import { statuslineShim, hooksShim } from './shim-template.js';
import { skillTemplate } from './skill-template.js';
import { claudeDistDir } from './paths.js';

export interface InitResult {
  settingsPath: string;
  shims: string[];
  skill: string;
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
  const bakedDir = claudeDistDir(); // absolute <pkg>/dist/claude — the shims' primary resolution path
  writeFileSync(sl, statuslineShim(bakedDir)); chmodSync(sl, 0o755);
  writeFileSync(hk, hooksShim(bakedDir)); chmodSync(hk, 0o755);

  // Install the graft skill — the piece that redirects the agent to graft/ before it
  // greps source. Overwritten each run (graft owns this file), like the shims above.
  const skillDir = join(dir, '.claude', 'skills', 'graft');
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, skillTemplate());

  let built = false;
  const wiring = join(dir, 'graft', '.graph', 'wiring.json');
  if (opts.build !== false && opts.cliPath && !existsSync(wiring)) {
    try {
      execFileSync(process.execPath, [opts.cliPath, 'build', '.'], { cwd: dir, stdio: 'inherit', timeout: 300000 });
      built = true;
    } catch { /* build best-effort; user can run `graft build` manually */ }
  }
  return { settingsPath, shims: [sl, hk], skill: skillPath, warnings, built };
}
