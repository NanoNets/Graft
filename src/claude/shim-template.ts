function shim(entryFile: string, call: string): string {
  return `#!/usr/bin/env node
const path = require('path');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
function entry(name) {
  const globalBase = path.join(path.dirname(process.execPath), '..', 'lib');
  for (const base of [dir, globalBase]) {
    try {
      const pkg = require.resolve('@nanonets/graft/package.json', { paths: [base] });
      return path.join(path.dirname(pkg), 'dist', 'claude', name);
    } catch { /* try next base */ }
  }
  return path.join(dir, 'dist', 'claude', name);
}
import(entry(${JSON.stringify(entryFile)})).then((m) => ${call}).catch(() => { /* graft unavailable — no-op */ });
`;
}

export function statuslineShim(): string { return shim('statusline.js', 'm.main()'); }
export function hooksShim(): string { return shim('hooks.js', 'm.main(process.argv[2])'); }
