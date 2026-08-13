import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeGraftSettings } from '../src/claude/settings-merge.js';

const SL = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs"';

test('empty settings gets the full Graft blocks', () => {
  const { merged, warnings } = mergeGraftSettings({});
  assert.equal(merged.statusLine.command, SL);
  assert.equal(merged.subagentStatusLine.command, SL);
  assert.ok(Array.isArray(merged.hooks.PostToolUse));
  assert.equal(merged.hooks.PostToolUse[0].matcher, 'Write|Edit|MultiEdit');
  for (const e of ['PostToolUse', 'UserPromptSubmit', 'SessionStart', 'Stop']) {
    assert.ok(merged.hooks[e][0].hooks[0].command.includes('graft-hooks.cjs'), `${e} wired`);
  }
  // PostToolUse carries a second graft block: the tokens-saved accumulator over
  // the retrieval tools (Bash `graft …` + the graft_* MCP tools).
  const savings = merged.hooks.PostToolUse[1];
  assert.equal(savings.matcher, 'Bash|mcp__graft__');
  assert.ok(savings.hooks[0].command.includes('tool-savings'), 'savings hook wired');
  assert.ok(merged.footerLinksRegexes.includes('graft/[\\w./-]+\\.md'));
  assert.deepEqual(warnings, []);
});

test('foreign statusLine is preserved with a warning; Graft not forced in', () => {
  const { merged, warnings } = mergeGraftSettings({ statusLine: { type: 'command', command: 'my-bar.sh' } });
  assert.equal(merged.statusLine.command, 'my-bar.sh');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /statusLine/);
});

test('existing foreign hooks are preserved; Graft appended', () => {
  const existing = { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }] } };
  const { merged } = mergeGraftSettings(existing);
  // foreign block + graft's two PostToolUse blocks (post-edit, tool-savings).
  assert.equal(merged.hooks.PostToolUse.length, 3);
  assert.equal(merged.hooks.PostToolUse[0].hooks[0].command, 'mine.sh');
  assert.ok(merged.hooks.PostToolUse[1].hooks[0].command.includes('graft-hooks.cjs'));
  assert.ok(merged.hooks.PostToolUse[2].hooks[0].command.includes('graft-hooks.cjs'));
});

test('re-running is idempotent (no duplicate Graft entries or footer)', () => {
  const once = mergeGraftSettings({}).merged;
  const twice = mergeGraftSettings(once).merged;
  assert.equal(twice.hooks.PostToolUse.length, 2); // post-edit + tool-savings, not duplicated
  assert.equal(twice.hooks.Stop.length, 1);
  assert.equal(twice.footerLinksRegexes.filter((r: string) => r === 'graft/[\\w./-]+\\.md').length, 1);
});

test('foreign top-level keys survive', () => {
  const { merged } = mergeGraftSettings({ model: 'claude-sonnet-5', permissions: { allow: ['Bash(ls)'] } });
  assert.equal(merged.model, 'claude-sonnet-5');
  assert.deepEqual(merged.permissions.allow, ['Bash(ls)', 'Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('fresh init adds the graft CLI allowlist', () => {
  const { merged } = mergeGraftSettings({});
  assert.deepEqual(merged.permissions.allow, ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('re-init does not duplicate allowlist entries', () => {
  const once = mergeGraftSettings({}).merged;
  const twice = mergeGraftSettings(once).merged;
  assert.deepEqual(twice.permissions.allow, ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('pre-existing unrelated allow entries are preserved and ours appended', () => {
  const existing = { permissions: { allow: ['Bash(ls)', 'Bash(git:*)'] } };
  const { merged } = mergeGraftSettings(existing);
  assert.deepEqual(merged.permissions.allow, ['Bash(ls)', 'Bash(git:*)', 'Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('a partially-present allowlist gains only what it lacks, in order', () => {
  const existing = { permissions: { allow: ['Bash(graft:*)'] } };
  const { merged } = mergeGraftSettings(existing);
  assert.deepEqual(merged.permissions.allow, ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('pre-existing allow entries are kept and only the missing ones appended', () => {
  const existing = { permissions: { allow: ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)'] } };
  const { merged } = mergeGraftSettings(existing);
  assert.deepEqual(merged.permissions.allow, ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('the unscoped `npx graft` grant an older graft wrote is revoked, not carried forward', () => {
  // `npx graft` resolves to the UNSCOPED package on the registry — someone else's
  // code — and this list ships in the committed, team-wide settings.json. A repo
  // wired before the fix must lose it on the next refresh, or the grant is forever.
  const existing = { permissions: { allow: ['Bash(ls)', 'Bash(npx graft:*)', 'Bash(git:*)'] } };
  const { merged } = mergeGraftSettings(existing);
  assert.ok(!merged.permissions.allow.includes('Bash(npx graft:*)'), 'revoked');
  assert.deepEqual(merged.permissions.allow, [
    'Bash(ls)', 'Bash(git:*)',
    'Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)',
  ], "the user's own entries survive; only graft's own stale grant goes");
});

test('permissions object with no allow key gets one added; other keys preserved', () => {
  const existing = { permissions: { deny: ['Bash(rm:*)'] } };
  const { merged } = mergeGraftSettings(existing);
  assert.deepEqual(merged.permissions.deny, ['Bash(rm:*)']);
  assert.deepEqual(merged.permissions.allow, ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('an allow entry the user deleted is not re-added once it has been offered', () => {
  // `.claude/settings.json` is committed, so a grant that comes back on every
  // version bump comes back for the whole team — and the only way out was to keep
  // deleting it after every upgrade. `offeredBefore` is the record (kept in the
  // wiring stamp) that turns "missing" into "removed on purpose".
  const offeredBefore = mergeGraftSettings({}).offeredAllow;
  assert.deepEqual(
    offeredBefore,
    ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)'],
    'everything this version proposes is what gets recorded',
  );

  const kept = ['Bash(ls)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)'];
  const { merged } = mergeGraftSettings({ permissions: { allow: [...kept] } }, { offeredBefore });
  assert.deepEqual(merged.permissions.allow, kept, 'the deleted entry stays deleted');

  // …but only for entries that were actually offered. One this graft version added
  // (so it is absent from the record) is a first offer, not a revocation.
  const older = ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)'];
  const { merged: widened } = mergeGraftSettings(
    { permissions: { allow: [...older] } },
    { offeredBefore: older },
  );
  assert.deepEqual(
    widened.permissions.allow,
    [...older, 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)'],
    'entries never offered here are still proposed',
  );

  // No record at all (a first init, or a clone with no stamp) behaves exactly as
  // before: everything is offered.
  const { merged: fresh } = mergeGraftSettings({ permissions: { allow: [] } });
  assert.deepEqual(fresh.permissions.allow, offeredBefore);
});
