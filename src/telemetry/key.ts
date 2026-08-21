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
const BAKED_HOST = '';

export function posthogKey(): string {
  return process.env.GRAFT_POSTHOG_KEY || BAKED_KEY;
}

export function posthogHost(): string {
  return (process.env.GRAFT_POSTHOG_HOST || BAKED_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
}
