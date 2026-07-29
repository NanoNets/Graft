type Json = Record<string, any>;

const SL_CMD = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs"';
const FOOTER = 'graft/[\\w./-]+\\.md';
const ALLOW_ENTRIES = ['Bash(graft:*)', 'Bash(npx graft:*)'];

function hookCmd(arg: string): string {
  return `node "\${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs" ${arg}`;
}
function graftBlocks(): Record<string, Json[]> {
  return {
    PostToolUse: [
      { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: hookCmd('post-edit'), timeout: 10000 }] },
      // A retrieval tool (CLI `graft …` via Bash, or the `graft_*` MCP tools) prints a
      // `[graft] tokens saved ≈ N` footer; this hook sums it into the session total the
      // statusline shows. Broad matcher, but the handler no-ops instantly unless a footer
      // is actually present, so non-graft Bash calls cost only a stdin read.
      { matcher: 'Bash|mcp__graft__', hooks: [{ type: 'command', command: hookCmd('tool-savings'), timeout: 8000 }] },
    ],
    // Longer budget than the other hooks: its `graft ask` is a real query, and a
    // query now brings the graph up to date first (graph/refresh.ts) — usually
    // milliseconds, but the first one after an upgrade re-parses the repo once.
    // `hooks.ts` reads this number back out of the installed settings.json at
    // runtime and caps its `graft ask` child just under it, so a repo wired before
    // this bump (8s) keeps a child that fits inside 8s. Changing the number here is
    // therefore safe on its own — but it only reaches an existing repo when someone
    // re-runs `graft init`, since that is the only caller of this function.
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: hookCmd('prompt'), timeout: 15000 }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: hookCmd('session-start'), timeout: 8000 }] }],
    Stop: [{ hooks: [{ type: 'command', command: hookCmd('stop'), timeout: 8000 }] }],
  };
}
function isGraftHookEntry(entry: Json): boolean {
  return JSON.stringify(entry ?? '').includes('graft-hooks.cjs');
}

export function mergeGraftSettings(existing: Json): { merged: Json; warnings: string[] } {
  const merged: Json = { ...(existing ?? {}) };
  const warnings: string[] = [];

  if (!merged.statusLine) merged.statusLine = { type: 'command', command: SL_CMD };
  else if (merged.statusLine.command !== SL_CMD)
    warnings.push('Existing statusLine left untouched (a session allows only one). To use Graft, point it at .claude/helpers/graft-statusline.cjs.');

  if (!merged.subagentStatusLine) merged.subagentStatusLine = { type: 'command', command: SL_CMD };
  else if (merged.subagentStatusLine.command !== SL_CMD)
    warnings.push('Existing subagentStatusLine left untouched.');

  merged.hooks = { ...(merged.hooks ?? {}) };
  for (const [event, blocks] of Object.entries(graftBlocks())) {
    const prior = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const foreign = prior.filter((e: Json) => !isGraftHookEntry(e)); // drop old Graft entries → idempotent
    merged.hooks[event] = [...foreign, ...blocks];
  }

  const footer = Array.isArray(merged.footerLinksRegexes) ? [...merged.footerLinksRegexes] : [];
  if (!footer.includes(FOOTER)) footer.push(FOOTER);
  merged.footerLinksRegexes = footer;

  // headless/subagent runs hard-deny Bash by default; without an allowlist entry
  // `graft ask`'s own Bash calls (and the skill it installs) can't run out-of-box.
  merged.permissions = { ...(merged.permissions ?? {}) };
  const allow = Array.isArray(merged.permissions.allow) ? [...merged.permissions.allow] : [];
  for (const entry of ALLOW_ENTRIES) {
    if (!allow.includes(entry)) allow.push(entry);
  }
  merged.permissions.allow = allow;

  return { merged, warnings };
}
