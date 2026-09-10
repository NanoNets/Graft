/**
 * The HTTP surface: one webhook in, one page out.
 *
 * Deliberately `node:http` and nothing else. This process handles a private key,
 * a webhook secret and other people's source code, so every dependency is one
 * more thing to trust; the whole server is a hundred lines and needs no
 * framework.
 *
 * GitHub retries a delivery it considers failed and gives up after ten seconds,
 * while a review takes tens of them — so the handler validates, queues, and
 * answers 202. Everything real happens on the queue.
 *
 * "On the queue" used to mean "on this event loop", and that was the whole of a
 * multi-minute outage: a review is synchronous end to end, so one in flight left
 * this server unable to answer /healthz or serve a page it had already produced.
 * The queue now runs each review in its own process (`./review-process.ts`) and
 * everything in here is I/O again.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { jobKey, reviewJobFor, type ReviewJob } from "./events.js";
import { InstallationTokens, verifySignature, type AppCredentials, type Fetch } from "./identity.js";
import { buildRepoIntoBrain, RepoNotAccessibleError, type BrainBuildJob } from "./brain-build.js";
import { PageStore } from "./pages.js";
import { WorkQueue } from "./queue.js";
import { reviewInChildProcess } from "./review-process.js";
import type { reviewPullRequest } from "./review.js";

/** A webhook body larger than this is not a pull_request event we can use. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Seams for tests: nothing here has a default that touches the network. */
export interface AppSeams {
  fetch?: Fetch;
  /** Swapped out so a test can assert what the route handed the builder without
   * cloning a repository or reaching GitHub. */
  brainBuild?: typeof buildRepoIntoBrain;
  /** Swapped out to assert what the queue was handed, without a clone — and, being
   * called in-process, without the fork the default reviewer does. */
  review?: typeof reviewPullRequest;
  now?: () => number;
}

export interface AppConfig extends AppCredentials {
  webhookSecret: string;
  /** Shared secret for `POST /brain/build`. That route is called by the
   * platform, not by GitHub, so it cannot use the webhook's payload signature —
   * it takes a bearer token instead. Unset disables the route entirely, which
   * is the right default for a deployment that only reviews pull requests. */
  brainBuildSecret?: string;
  /** Platform base URL the digest is posted to. Defaults to production. */
  brainBaseUrl?: string;
  /** Token for reading public repositories the App is not installed on.
   * Optional — without it those reads are anonymous, and anonymous runs out of
   * rate limit after about one repository an hour. */
  publicToken?: string;
  /** Public origin, for the links put in comments, e.g. https://graft.example.com */
  publicUrl: string;
  /** Where pages are kept, so a restart does not strand the links already posted. */
  pageDir?: string;
  port?: number;
  concurrency?: number;
  api?: string;
  log?: (msg: string) => void;
}

export function createApp(
  config: AppConfig,
  seams: AppSeams = {},
): { server: Server; queue: WorkQueue<ReviewJob>; pages: PageStore } {
  const log = config.log ?? ((msg: string) => console.log(msg));
  const fetchImpl = seams.fetch ?? (globalThis.fetch as unknown as Fetch);
  const review = seams.review ?? reviewInChildProcess;
  const tokens = new InstallationTokens(config, fetchImpl, seams.now ?? Date.now, config.api);
  const pages = new PageStore({ secret: config.webhookSecret, dir: config.pageDir });
  const origin = config.publicUrl.replace(/\/$/, "");

  const queue = new WorkQueue<ReviewJob>(
    async (job) => {
      const started = Date.now();
      const res = await review(job, {
        token: (id) => tokens.get(id),
        fetch: fetchImpl,
        api: config.api,
        publish: async (j, html) => {
          const { id, token } = pages.put(j.owner, j.repo, j.number, html);
          return `${origin}/p/${id}?t=${token}`;
        },
        log,
      });
      log(`${jobKey(job)}: ${res.areas} changed → ${res.affected} affected in ${Date.now() - started}ms`);
    },
    {
      concurrency: config.concurrency,
      onError: (err, key) => {
        // A token GitHub rejected is worth forgetting: the next delivery for that
        // installation should mint a fresh one rather than fail the same way.
        log(`${key}: FAILED ${err instanceof Error ? err.message : String(err)}`);
      },
    },
  );

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      log(`request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, "text/plain", "internal error");
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", origin);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return send(res, 200, "application/json", JSON.stringify({ ok: true, queued: queue.size, pages: pages.size }));
    }

    if (req.method === "GET" && url.pathname.startsWith("/p/")) {
      const html = pages.get(url.pathname.slice(3), url.searchParams.get("t") ?? undefined);
      // A bad token and a missing page are the same answer on purpose: probing
      // for which pull requests exist is not something this should help with.
      if (!html) return send(res, 404, "text/plain", "not found");
      return send(res, 200, "text/html; charset=utf-8", html, { "cache-control": "private, max-age=600" });
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const body = await readBody(req);
      if (body === null) return send(res, 413, "text/plain", "payload too large");
      if (!verifySignature(config.webhookSecret, body, header(req, "x-hub-signature-256"))) {
        return send(res, 401, "text/plain", "bad signature");
      }

      const event = header(req, "x-github-event") ?? "";
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        return send(res, 400, "text/plain", "bad json");
      }

      const decided = reviewJobFor(event, payload);
      if ("skip" in decided) return send(res, 204, "text/plain", "");
      queue.push(jobKey(decided.job), decided.job);
      log(`${jobKey(decided.job)}: queued${decided.job.fromFork ? " (fork)" : ""}`);
      return send(res, 202, "application/json", JSON.stringify({ queued: true }));
    }

    // Build one repository into a brain, on demand. Called by the platform when
    // someone pastes a repository URL during onboarding — there is no webhook
    // behind it, so it authenticates with a bearer token rather than a payload
    // signature.
    if (req.method === "POST" && url.pathname === "/brain/build") {
      if (!config.brainBuildSecret) return send(res, 404, "text/plain", "not found");
      // Compared in constant time for the same reason verifySignature is: this
      // is a long-lived shared secret, and a timing oracle on it is worth more
      // to an attacker than one on a per-payload signature.
      if (!bearerMatches(header(req, "authorization"), config.brainBuildSecret)) {
        return send(res, 401, "text/plain", "unauthorized");
      }
      const body = await readBody(req);
      if (body === null) return send(res, 413, "text/plain", "payload too large");
      let job: BrainBuildJob;
      try {
        job = JSON.parse(body) as BrainBuildJob;
      } catch {
        return send(res, 400, "text/plain", "bad json");
      }
      // brainId/brainToken are optional: without them the digest comes back in
      // the response for the caller to ingest itself. See BrainBuildJob.
      if (!job.owner || !job.repo) {
        return send(res, 400, "application/json", JSON.stringify({ error: "owner and repo are required" }));
      }
      // Synchronous on purpose: the caller is a person waiting on a screen, and
      // the platform's own import job is what makes the SLOW half (extraction and
      // placement) asynchronous. This half is a shallow clone and a graph build.
      try {
        // The deployment's platform URL wins over anything a caller sends, so a
        // request cannot redirect a repository's history to another host.
        if (config.brainBaseUrl) job.brainBaseUrl = config.brainBaseUrl;
        const built = await (seams.brainBuild ?? buildRepoIntoBrain)(job, {
          creds: config,
          fetch: fetchImpl,
          api: config.api,
          publicToken: config.publicToken,
          log,
          now: seams.now,
        });
        return send(res, 202, "application/json", JSON.stringify(built));
      } catch (e) {
        if (e instanceof RepoNotAccessibleError) {
          return send(res, 404, "application/json", JSON.stringify({ error: e.message, ...e.gap }));
        }
        const msg = e instanceof Error ? e.message : String(e);
        log(`brain build ${job.owner}/${job.repo} failed: ${msg}`);
        return send(res, 502, "application/json", JSON.stringify({ error: msg }));
      }
    }

    return send(res, 404, "text/plain", "not found");
  }

  if (config.port !== undefined) server.listen(config.port, () => log(`graft app listening on :${config.port}`));
  return { server, queue, pages };
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Constant-time `Authorization: Bearer <secret>` check. */
function bearerMatches(headerValue: string | undefined, secret: string): boolean {
  const prefix = "Bearer ";
  if (!headerValue || !headerValue.startsWith(prefix)) return false;
  const given = Buffer.from(headerValue.slice(prefix.length));
  const want = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, which is itself a leak of the
  // secret's length — but one byte of length is not worth a branch that skips
  // the comparison, and the lengths here are fixed by deployment config.
  return given.length === want.length && timingSafeEqual(given, want);
}

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, ...extra });
  res.end(body);
}

/** The raw body — needed verbatim, because the signature covers these bytes. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
