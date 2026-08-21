/**
 * The disclosure. Every telemetry backlash in the tools this design was drawn
 * from was about a tool that started sending without saying so, which makes
 * these the tests that protect the project rather than the user's data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstRunNotice, formatDebug, formatStatus } from '../src/telemetry/notice.js';
import { enqueue } from '../src/telemetry/queue.js';
import { readState } from '../src/telemetry/identity.js';
import { tmpRepo } from './helpers.js';

function home(tag: string, state?: Record<string, unknown>): string {
  const dir = tmpRepo(tag);
  mkdirSync(join(dir, '.graft'), { recursive: true });
  if (state) writeFileSync(join(dir, '.graft', 'telemetry.json'), JSON.stringify(state));
  process.env.GRAFT_POSTHOG_KEY = 'phc_test_key';
  delete process.env.DO_NOT_TRACK;
  delete process.env.CI;
  return dir;
}

test('the notice prints once per machine, then never again', () => {
  const h = home('notice-once', { installId: 'x' });
  const first = firstRunNotice(h);
  assert.ok(first, 'the first run must disclose');
  assert.match(first, /anonymous/);
  assert.match(first, /graft telemetry disable/);
  assert.match(first, /TELEMETRY\.md/);
  assert.equal(firstRunNotice(h), null);
  assert.equal(firstRunNotice(h), null);
  assert.ok(readState(h)?.noticeShownAt);
});

test('the notice says what is NOT collected, in the first line a user reads', () => {
  const h = home('notice-says-what', { installId: 'x' });
  assert.match(firstRunNotice(h) ?? '', /no code, no file paths, no queries/);
});

test('nothing is disclosed when nothing can be sent', () => {
  // A fork: no key, so there is no collection to announce and announcing one
  // would be worse than saying nothing.
  const h = home('notice-nokey', { installId: 'x' });
  delete process.env.GRAFT_POSTHOG_KEY;
  assert.equal(firstRunNotice(h), null);
  assert.equal(readState(h)?.noticeShownAt, undefined, 'and the notice stays pending');
});

test('status names the switch that is actually closed', () => {
  const h = home('notice-status-off', { installId: 'x', enabled: false });
  const out = formatStatus(h);
  assert.match(out, /telemetry: off/);
  assert.match(out, /graft telemetry enable/);
});

test('status shows the endpoint and the pending count when it is on', () => {
  const h = home('notice-status-on', { installId: 'x' });
  enqueue({ event: 'query' }, h);
  const out = formatStatus(h);
  assert.match(out, /telemetry: on/);
  assert.match(out, /1 event waiting/);
  assert.match(out, /https:\/\//);
  assert.match(out, /graft telemetry debug/);
});

test('debug prints the exact batch and sends nothing', () => {
  const h = home('notice-debug', { installId: 'x' });
  enqueue({ event: 'query', properties: { command: 'ask' }, distinct_id: 'abc', timestamp: '2026-01-01T00:00:00Z' }, h);
  const out = formatDebug(h);
  assert.match(out, /sends nothing/);
  const body = JSON.parse(out.slice(out.indexOf('{')));
  assert.equal(body.batch.length, 1);
  assert.equal(body.batch[0].event, 'query');
  assert.equal(body.batch[0].properties.$process_person_profile, false, 'anonymous event');
  assert.equal(body.batch[0].properties.distinct_id, 'abc');
});

test('debug on an empty queue explains rather than printing an empty batch', () => {
  assert.match(formatDebug(home('notice-debug-empty', { installId: 'x' })), /nothing queued/);
});
