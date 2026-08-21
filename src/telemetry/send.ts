/**
 * The one network call in graft that is not an LLM request.
 *
 * A single POST of the whole queued batch to PostHog's capture endpoint, with
 * `fetch` and no SDK. `posthog-node` would be the conventional choice, but it is
 * a runtime dependency in a CLI whose install weight users notice, it wants to
 * own batching and flushing (both of which the queue already does, and does
 * differently because we are a short-lived process), and "an analytics library
 * that can see everything" is precisely the objection this whole design exists
 * to disarm. Twenty lines of `fetch` is auditable in a sitting.
 *
 * `$process_person_profile: false` on every event is what makes these ANONYMOUS
 * events in PostHog: no person profile is created, no identity is stored, and
 * the `distinct_id` is only ever the random install UUID.
 */
import { posthogKey, posthogHost } from './key.js';

/** Anything longer and the detached child is just holding a socket open. */
const SEND_TIMEOUT_MS = 8000;

export interface SendResult {
  ok: boolean;
  status?: number;
  /** Why it failed, for `graft telemetry debug` only — never itself reported. */
  error?: string;
}

/**
 * The events as PostHog wants them — everything the wire body contains EXCEPT
 * the project key.
 *
 * The key is deliberately not in here. `graft telemetry debug` prints this
 * object so a user can audit exactly what graft sends, and a command that exists
 * to be pasted into a bug report must not also paste our ingestion key into it.
 * `sendBatch` adds the key at the moment of the request and nowhere else, which
 * keeps the key entirely out of every code path that can reach a terminal.
 */
export function buildBatch(events: unknown[]): Record<string, unknown> {
  return {
    batch: events.map((e) => {
      const ev = e as { event: string; properties?: Record<string, string>; timestamp?: string; distinct_id?: string };
      return {
        event: ev.event,
        timestamp: ev.timestamp,
        properties: {
          ...(ev.properties ?? {}),
          distinct_id: ev.distinct_id,
          // Anonymous event: PostHog stores it without creating a person.
          $process_person_profile: false,
        },
      };
    }),
  };
}

/**
 * Ingest paths, in the order they are tried.
 *
 * `/batch/` is PostHog's documented batch endpoint and what US Cloud (and the
 * `e.nanonets.com` proxy in front of it) expects. `/e/` is the older capture
 * path, which also accepts a `{api_key, batch}` body — it is the fallback
 * because the self-hosted `events.nanonets.com` proxy is documented in
 * `assign/frontend/src/lib/posthog.ts` as serving `/e/` and rejecting the newer
 * `/i/v0/e/`. Trying the second only on a 404/405 means a host that speaks
 * `/batch/` pays nothing for the fallback existing.
 */
const INGEST_PATHS = ['/batch/', '/e/'] as const;

/** A path that isn't there, as opposed to a request that was refused. */
function pathMissing(status: number): boolean {
  return status === 404 || status === 405;
}

export async function sendBatch(events: unknown[]): Promise<SendResult> {
  if (events.length === 0) return { ok: true };
  const key = posthogKey();
  if (!key) return { ok: false, error: 'no key' };
  // The one place the key is ever attached: the request body itself.
  const body = JSON.stringify({ api_key: key, ...buildBatch(events) });
  let last: SendResult = { ok: false, error: 'unsent' };
  for (const path of INGEST_PATHS) {
    try {
      const res = await fetch(`${posthogHost()}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      // 4xx other than a missing path is our bug (a bad key, a malformed body)
      // and retrying it forever would pin the queue at its cap; only 5xx and
      // transport errors are worth putting back on the queue.
      last = { ok: res.ok, status: res.status };
      if (res.ok || !pathMissing(res.status)) return last;
    } catch (e) {
      // A transport failure is about the host, not the path — a second attempt
      // down the same broken socket buys nothing.
      return { ok: false, error: e instanceof Error ? e.name : 'unknown' };
    }
  }
  return last;
}
