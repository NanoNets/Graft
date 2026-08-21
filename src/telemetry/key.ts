/**
 * The PostHog project key, and the reason forks stay silent.
 *
 * `BAKED_KEY` is empty in the repository and is rewritten in place by
 * `scripts/stamp-telemetry-key.mjs`, which runs from `prepublishOnly`. So the
 * key exists only in the published tarball: a clone, a fork, and a plain
 * `npm run build` all compile to `''`, and every send path short-circuits. A
 * contributor cannot accidentally send us their own usage, and a fork cannot
 * send us anything at all.
 *
 * `GRAFT_POSTHOG_KEY` overrides it at runtime so a maintainer can exercise the
 * real path locally without publishing.
 *
 * Public project keys are write-only ingestion keys — they authorise capture and
 * nothing else — which is why one may sit in a published artifact at all. It is
 * still not committed here: an empty default is what makes "forks never send"
 * true by construction rather than by policy.
 */

/** Rewritten at publish time. Do not hand-edit — see the module comment. */
const BAKED_KEY = '';

/**
 * Nanonets' own PostHog host, not `us.i.posthog.com`.
 *
 * Every other Nanonets product ingests through these proxies rather than
 * PostHog directly (see `assign/frontend/src/lib/posthog.ts`, which dual-inits
 * against `e.nanonets.com` and `events.nanonets.com` on one project token), so
 * pointing graft at PostHog Cloud would put its events in a project nobody
 * looks at. `e.nanonets.com` is the US Cloud proxy — plain PostHog ingest
 * semantics — rather than the self-hosted `events.nanonets.com`, whose path and
 * compression quirks that same file documents at length.
 *
 * The HOST is safe to commit; the KEY is not, and stays empty here. That
 * asymmetry is the point: with no key, a fork built from this source sends
 * nothing no matter where the host points.
 */
const BAKED_HOST = 'https://e.nanonets.com';

export function posthogKey(): string {
  return process.env.GRAFT_POSTHOG_KEY || BAKED_KEY;
}

export function posthogHost(): string {
  return (process.env.GRAFT_POSTHOG_HOST || BAKED_HOST).replace(/\/+$/, '');
}
