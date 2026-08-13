// Prints a one-line nudge after install. Never fails the install.
try {
  if (process.env.CI) process.exit(0);
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = process.env.INIT_CWD || process.cwd();
  if (existsSync(join(dir, '.claude', 'helpers', 'graft-statusline.cjs'))) process.exit(0);
  // Scoped, and `-y`: bare `npx graft` resolves to the UNSCOPED `graft` package on
  // the registry — someone else's code entirely. This line is the first thing a new
  // user copies, and the same form was revoked from the settings allowlist
  // (REVOKED_ALLOW_ENTRIES in src/claude/settings-merge.ts) for exactly that reason.
  console.log('\n  Graft installed. Run `npx -y @nanonets/graft init` to enable the Claude Code integration (statusline + hooks + auto-sync).\n');
} catch {
  /* never fail an install */
}
