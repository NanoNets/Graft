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

/** The exact JSON that goes over the wire. Built separately from the send so
 *  `graft telemetry debug` can print it without a network call. */
export function buildBatch(events: unknown[]): Record<string, unknown> {
  return {
    api_key: posthogKey(),
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

export async function sendBatch(events: unknown[]): Promise<SendResult> {
  if (events.length === 0) return { ok: true };
  const key = posthogKey();
  if (!key) return { ok: false, error: 'no key' };
  try {
    const res = await fetch(`${posthogHost()}/batch/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBatch(events)),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // 4xx is our bug (a bad key, a malformed batch) and retrying it forever
    // would pin the queue at its cap; only 5xx and transport errors are worth
    // putting back on the queue.
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.name : 'unknown' };
  }
}
