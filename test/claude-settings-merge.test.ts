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
  assert.equal(merged.hooks.PostToolUse.length, 2);
  assert.equal(merged.hooks.PostToolUse[0].hooks[0].command, 'mine.sh');
  assert.ok(merged.hooks.PostToolUse[1].hooks[0].command.includes('graft-hooks.cjs'));
});

test('re-running is idempotent (no duplicate Graft entries or footer)', () => {
  const once = mergeGraftSettings({}).merged;
  const twice = mergeGraftSettings(once).merged;
  assert.equal(twice.hooks.PostToolUse.length, 1);
  assert.equal(twice.hooks.Stop.length, 1);
  assert.equal(twice.footerLinksRegexes.filter((r: string) => r === 'graft/[\\w./-]+\\.md').length, 1);
});

test('foreign top-level keys survive', () => {
  const { merged } = mergeGraftSettings({ model: 'claude-sonnet-5', permissions: { allow: ['Bash(ls)'] } });
  assert.equal(merged.model, 'claude-sonnet-5');
  assert.deepEqual(merged.permissions.allow, ['Bash(ls)']);
});
