import { readFileSync } from 'node:fs';
import { renderStatusline } from './format.js';
import { readStats, readSession } from './state.js';

export function main(): void {
  let input: any = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/invalid stdin */ }
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const stats = readStats(dir);
  const session = readSession(dir, input.session_id || 'default');
  const raw = input?.context_window?.used_percentage;
  const ctxPct = typeof raw === 'number' ? Math.round(raw) : null;
  process.stdout.write(renderStatusline(stats, session, { ctxPct }).join('\n'));
}
