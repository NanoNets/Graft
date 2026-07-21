type Json = Record<string, any>;

const SL_CMD = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs"';
const FOOTER = 'graft/[\\w./-]+\\.md';
const ALLOW_ENTRIES = ['Bash(graft:*)', 'Bash(npx graft:*)'];

function hookCmd(arg: string): string {
  return `node "\${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs" ${arg}`;
}
function graftBlocks(): Record<string, Json> {
  return {
    PostToolUse: { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: hookCmd('post-edit'), timeout: 10000 }] },
    UserPromptSubmit: { hooks: [{ type: 'command', command: hookCmd('prompt'), timeout: 8000 }] },
    SessionStart: { hooks: [{ type: 'command', command: hookCmd('session-start'), timeout: 8000 }] },
    Stop: { hooks: [{ type: 'command', command: hookCmd('stop'), timeout: 8000 }] },
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
  for (const [event, block] of Object.entries(graftBlocks())) {
    const prior = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const foreign = prior.filter((e: Json) => !isGraftHookEntry(e)); // drop old Graft entries → idempotent
    merged.hooks[event] = [...foreign, block];
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
