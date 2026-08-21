/**
 * The send path, against a real local server rather than a mock.
 *
 * The fallback exists because Nanonets runs two PostHog front doors: the US
 * Cloud proxy speaks PostHog's documented `/batch/`, while the self-hosted proxy
 * is documented (in assign's `lib/posthog.ts`) as serving the older `/e/`. Which
 * one graft is pointed at is a publish-time setting, so the client has to cope
 * with either without being reconfigured — and an untested fallback is worse
 * than none, hence this file.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { buildBatch, sendBatch } from '../src/telemetry/send.js';
import { posthogHost } from '../src/telemetry/key.js';

interface Hit { path: string; body: any }

let server: Server;
let port = 0;
let hits: Hit[] = [];
/** Paths this stub pretends not to have, so a 404 can be provoked. */
let missing = new Set<string>();
/** Status to answer with on a path that does exist. */
let status = 200;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (missing.has(req.url ?? '')) { res.writeHead(404); res.end('no such path'); return; }
      hits.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : null });
      res.writeHead(status); res.end('{"status":1}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
  process.env.GRAFT_POSTHOG_KEY = 'phc_send_test';
  process.env.GRAFT_POSTHOG_HOST = `http://127.0.0.1:${port}`;
});

after(() => { server.close(); });

function reset(): void { hits = []; missing = new Set(); status = 200; }

const EVENTS = [{ event: 'query', properties: { command: 'ask' }, distinct_id: 'abc', timestamp: '2026-01-01T00:00:00Z' }];

test('a host that speaks /batch/ is used directly, with no second request', async () => {
  reset();
  const res = await sendBatch(EVENTS);
  assert.equal(res.ok, true);
  assert.deepEqual(hits.map((h) => h.path), ['/batch/'], 'the fallback must cost nothing when unneeded');
  assert.equal(hits[0].body.api_key, 'phc_send_test');
  assert.equal(hits[0].body.batch[0].event, 'query');
  assert.equal(hits[0].body.batch[0].properties.$process_person_profile, false);
});

test('a host with no /batch/ falls back to /e/ with the same body', async () => {
  reset();
  missing.add('/batch/');
  const res = await sendBatch(EVENTS);
  assert.equal(res.ok, true);
  assert.deepEqual(hits.map((h) => h.path), ['/e/']);
  assert.equal(hits[0].body.api_key, 'phc_send_test');
  assert.equal(hits[0].body.batch[0].event, 'query');
});

test('neither path present: the failure is reported, not retried forever', async () => {
  reset();
  missing.add('/batch/'); missing.add('/e/');
  const res = await sendBatch(EVENTS);
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test('a 400 on /batch/ falls through to /e/ — the documented failure of events.nanonets.com', async () => {
  reset();
  status = 400;
  await sendBatch(EVENTS);
  assert.deepEqual(hits.map((h) => h.path), ['/batch/', '/e/'], 'a 400 must not be the end of the road');
});

test('a rejected key is NOT retried down the other path — 401 is an answer', async () => {
  reset();
  status = 401;
  const res = await sendBatch(EVENTS);
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.deepEqual(hits.map((h) => h.path), ['/batch/'], 'a bad key fails the same way on /e/');
});

test('a 500 is reported so the queue keeps the batch', async () => {
  reset();
  status = 500;
  const res = await sendBatch(EVENTS);
  assert.equal(res.status, 500);
});

test('an unreachable host is a transport error, not a path problem', async () => {
  reset();
  const saved = process.env.GRAFT_POSTHOG_HOST;
  process.env.GRAFT_POSTHOG_HOST = 'http://127.0.0.1:1';
  const res = await sendBatch(EVENTS);
  process.env.GRAFT_POSTHOG_HOST = saved;
  assert.equal(res.ok, false);
  assert.ok(res.error, 'a transport failure carries an error, not a status');
  assert.equal(res.status, undefined);
});

test('an empty batch is not a request', async () => {
  reset();
  assert.deepEqual(await sendBatch([]), { ok: true });
  assert.deepEqual(hits, []);
});

test('the default host is the one the other server-side integration uses', () => {
  const saved = process.env.GRAFT_POSTHOG_HOST;
  delete process.env.GRAFT_POSTHOG_HOST;
  assert.equal(posthogHost(), 'https://events.nanonets.com');
  process.env.GRAFT_POSTHOG_HOST = saved;
});

test('a trailing slash on the configured host does not produce a double slash', () => {
  const saved = process.env.GRAFT_POSTHOG_HOST;
  process.env.GRAFT_POSTHOG_HOST = 'https://events.nanonets.com///';
  assert.equal(posthogHost(), 'https://events.nanonets.com');
  process.env.GRAFT_POSTHOG_HOST = saved;
});

test('buildBatch still carries no key, whichever path is used', () => {
  assert.equal('api_key' in buildBatch(EVENTS), false);
});
