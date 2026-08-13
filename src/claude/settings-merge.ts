type Json = Record<string, any>;

const SL_CMD = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs"';
const FOOTER = 'graft/[\\w./-]+\\.md';
// Every form graft is actually invoked as. 'graft:*' covers a global install; the
// npx form covers a machine without one; the last two cover a repo working on graft
// itself (or any consumer running it from a checkout), where the binary is not on
// PATH under that name. A retrieval call that raises a permission prompt loses to
// grep, which never does.
//
// The npx entry is scoped to the package name on purpose. `npx graft` resolves to
// the UNSCOPED `graft` package on the registry — someone else's code entirely — and
// this list is written into `.claude/settings.json`, the shared, committed file, so
// the grant reaches everyone who pulls. Auto-approving "download and run whatever
// npm currently serves under the name `graft`" is not a grant graft gets to make on
// a team's behalf; auto-approving its own published package is.
export const ALLOW_ENTRIES = [
  'Bash(graft:*)',
  'Bash(npx -y @nanonets/graft:*)',
  'Bash(graft-dev:*)',
  'Bash(node dist/cli.js:*)',
];

// Grants an older graft added that this one takes back. Dropped on every merge, so
// the fix reaches repos already wired — a refresh runs on the next version bump,
// and a stale entry sitting in a committed settings.json is precisely the problem.
const REVOKED_ALLOW_ENTRIES = ['Bash(npx graft:*)'];

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

/**
 * @param opts.offeredBefore  Allow entries a PREVIOUS graft init already proposed
 *   for this repo (recorded in the wiring stamp). Any of them now missing from
 *   `permissions.allow` was taken out deliberately, so it is not re-added — a
 *   permission the user revoked coming back on every version bump is graft
 *   overruling a decision, and `.claude/settings.json` is committed, so it comes
 *   back for the whole team. Entries NOT in this list have never been offered here
 *   (a new graft version, or a first init) and are proposed normally.
 */
export function mergeGraftSettings(
  existing: Json,
  opts: { offeredBefore?: readonly string[] } = {},
): { merged: Json; warnings: string[]; offeredAllow: string[] } {
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
  const prior: unknown[] = Array.isArray(merged.permissions.allow) ? merged.permissions.allow : [];
  const allow = prior.filter((e) => !REVOKED_ALLOW_ENTRIES.includes(e as string));
  const revoked = new Set(opts.offeredBefore ?? []);
  for (const entry of ALLOW_ENTRIES) {
    // Offered before and gone now ⇒ removed on purpose. Nothing else deletes an
    // entry from this array: graft only ever appends, and the one list it does
    // delete from (REVOKED_ALLOW_ENTRIES) is a different set entirely.
    if (!allow.includes(entry) && !revoked.has(entry)) allow.push(entry);
  }
  merged.permissions.allow = allow;

  // Everything this version proposes, recorded whether or not it ended up in the
  // file — an entry skipped above was offered by an EARLIER run, and forgetting
  // that would re-offer it on the next one, which is the whole defect.
  return { merged, warnings, offeredAllow: [...ALLOW_ENTRIES] };
}
