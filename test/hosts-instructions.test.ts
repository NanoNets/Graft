import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instructionBody, cursorRule, kiroSteering, windsurfRule } from '../src/hosts/instructions.js';

test('canonical body names the three essentials', () => {
  const b = instructionBody();
  assert.match(b, /^## Graft — repo context graph/m);
  assert.match(b, /graft ask "/);
  assert.match(b, /graft\/INDEX\.md/);
  assert.match(b, /graft build/);
  assert.match(b, /every occurrence|enumerate with grep/i, 'teaches the exhaustive-task grep rule');
  assert.match(b, /callers/, 'teaches the callers/callees/impact commands');
  assert.match(b, /truncated/i, 'tells the agent to follow up on truncated spans');
  assert.match(b, /graft grep/, 'routes sweeps to graft grep');
  assert.match(b, /graft map/, 'tells the agent to orient with graft map before exploring');
  assert.ok(!/\bhook|statusline\b/i.test(b), 'no host-specific machinery in the shared body');
});

test('cursor rule has alwaysApply frontmatter and the body', () => {
  const r = cursorRule();
  assert.match(r, /^---\ndescription: .+\nalwaysApply: true\n---\n/);
  assert.ok(r.includes(instructionBody()));
});

test('kiro steering has inclusion: always frontmatter and the body', () => {
  const r = kiroSteering();
  assert.match(r, /^---\ninclusion: always\n---\n/);
  assert.ok(r.includes(instructionBody()));
});

test('windsurf rule is the plain body', () => {
  assert.ok(windsurfRule().includes(instructionBody()));
});
