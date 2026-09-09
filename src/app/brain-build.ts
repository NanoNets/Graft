/**
 * Building one repository into a brain, on demand.
 *
 * The whole point of the onboarding flow this serves: someone pastes a
 * repository URL, and a minute later they are looking at rules mined from their
 * own history. Nothing is installed and nobody has signed up yet, so this has to
 * work from the repository name alone.
 *
 * Runs in the app rather than in the platform because only the app has the
 * GitHub App credentials, only it can clone, and only graft can build a symbol
 * graph. What crosses back to the platform is a digest of messages and symbol
 * ids — never source.
 */
import { buildGraph } from "../graph/build.js";
import { contextDirFor } from "../context/node-file.js";
import { loadGraphCached } from "../graph/load.js";
import { checkoutRepository } from "./checkout.js";
import { appJwt, installationFor, repoAccessGap, type AppCredentials, type Fetch, type RepoAccessGap } from "./identity.js";
import { buildDigest, postDigest, readCommits, readSymbols, readThreads, type RepoDigest } from "./history.js";

/** One request to build a repository into a brain. */
export interface BrainBuildJob {
  owner: string;
  repo: string;
  /** Branch to read; empty means the repository's default. */
  ref?: string;
  /**
   * The brain the rules land in, and the workspace key to write it with.
   *
   * Both optional, and omitting them changes the mode: with them, the digest is
   * posted straight to the brain and only a job id comes back; without them the
   * digest is RETURNED and the caller ingests it itself.
   *
   * The second mode is what the platform's own proxy uses. It already holds the
   * user's session and can write to the brain directly, so handing graft a
   * workspace key just to have it call back would mean minting a credential per
   * build for no gain.
   */
  brainId?: string;
  brainToken?: string;
  /** Platform base URL. Defaults to production. */
  brainBaseUrl?: string;
  /** File the rules as approved rather than as drafts. Onboarding sets it:
   * a brain whose every rule is an invisible draft answers nothing. */
  autoApprove?: boolean;
}

export interface BrainBuildResult {
  /** Set only when the digest was posted; empty in return-the-digest mode. */
  jobId: string;
  headSha: string;
  commits: number;
  threads: number;
  symbols: number;
  /** Set only in return-the-digest mode. */
  digest?: RepoDigest;
}

export interface BrainBuildDeps {
  creds: AppCredentials;
  fetch: Fetch;
  api?: string;
  githubHost?: string;
  log?: (msg: string) => void;
  now?: () => number;
}

/** Raised when the App cannot see the repository. Distinct because the caller
 * turns it into a specific answer — "install the app, or run it locally" — and
 * not into a 500. */
export class RepoNotAccessibleError extends Error {
  constructor(
    message: string,
    /** Which gap it is, so the caller can send the user to the right place. */
    readonly gap: RepoAccessGap = { reason: "not_installed", ownerId: null, installationId: null },
  ) {
    super(message);
  }
}

/**
 * Read the repository and hand its history to the brain.
 *
 * Public repositories still go through the installation lookup, because the App
 * needs a token to clone at any useful rate limit, and a repository the App is
 * not installed on is exactly the case the UI has to distinguish.
 */
export async function buildRepoIntoBrain(
  job: BrainBuildJob,
  deps: BrainBuildDeps,
): Promise<BrainBuildResult> {
  const log = deps.log ?? ((): void => {});
  const api = deps.api ?? "https://api.github.com";
  const tag = `${job.owner}/${job.repo}`;

  const installationId = await installationFor(
    deps.creds,
    job.owner,
    job.repo,
    deps.fetch,
    (deps.now ?? Date.now)(),
    api,
  );
  if (installationId === null) {
    // Which of the two gaps it is decides what the UI can offer, so it is
    // resolved here rather than guessed there.
    const gap = await repoAccessGap(deps.creds, job.owner, deps.fetch, (deps.now ?? Date.now)(), api);
    throw new RepoNotAccessibleError(
      gap.reason === "repo_not_selected"
        ? `graft is installed on ${job.owner} but ${tag} is not in the list of repositories it can see`
        : `graft is not installed on ${job.owner}`,
      gap,
    );
  }

  const tokenRes = await deps.fetch(`${api}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${appJwt(deps.creds, (deps.now ?? Date.now)())}`,
      accept: "application/vnd.github+json",
      "user-agent": "graft-app",
    },
  });
  if (!tokenRes.ok) {
    throw new Error(`installation token for ${tag} failed: ${tokenRes.status}`);
  }
  const token = (JSON.parse(await tokenRes.text()) as { token: string }).token;

  // Whether the repository is private decides what the UI may show before
  // signup, and the default branch is not discoverable from a shallow
  // single-ref fetch (there is no origin/HEAD to resolve), so both are read from
  // the API in one call rather than guessed.
  const meta = await repoMeta(job.owner, job.repo, token, deps.fetch, api);

  const checkout = checkoutRepository({
    owner: job.owner,
    repo: job.repo,
    ref: job.ref || meta.defaultBranch,
    token,
    api: deps.githubHost,
    log,
  });
  try {
    // `graphOnly`: the symbol ids and their hashes are all the digest needs, and
    // the markdown projections cost real time on a large repo.
    await buildGraph(checkout.dir, { graphOnly: true });
    const graph = loadGraphCached(contextDirFor(checkout.dir));

    const commits = readCommits(checkout.dir);
    const symbols = readSymbols(graph);
    // The threads are the slow part (two API calls per pull request), and the
    // one most likely to fail on a rate limit. A failure here degrades to a
    // commits-only ingest rather than losing the whole build.
    let threads: Awaited<ReturnType<typeof readThreads>> = [];
    try {
      threads = await readThreads(job.owner, job.repo, token, deps.fetch, api);
    } catch (e) {
      log(`${tag}: pull-request discussion unavailable (${e instanceof Error ? e.message : e}); mining commits only`);
    }

    log(`${tag}: read ${commits.length} commits, ${threads.length} threads, ${symbols.length} symbols`);

    const digest = buildDigest({
      owner: job.owner,
      name: job.repo,
      headSha: checkout.headSha,
      defaultBranch: job.ref || meta.defaultBranch,
      isPrivate: meta.isPrivate,
      commits,
      threads,
      symbols,
      autoApprove: job.autoApprove ?? false,
    });

    const counts = {
      headSha: checkout.headSha,
      commits: commits.length,
      threads: threads.length,
      symbols: symbols.length,
    };
    if (!job.brainId || !job.brainToken) {
      return { jobId: "", ...counts, digest };
    }
    const { jobId } = await postDigest(
      job.brainBaseUrl ?? "https://agents.nanonets.com",
      job.brainId,
      job.brainToken,
      digest,
      deps.fetch,
    );
    return { jobId, ...counts };
  } finally {
    // Always: the clone was made with an installation token and is not something
    // to leave in /tmp.
    checkout.cleanup();
  }
}

/**
 * The repository's visibility and default branch, in one call.
 *
 * Unknown counts as private: saying a repo is public when it is not would leak
 * its name into a pre-signup screen. An unknown default branch is left empty,
 * and the checkout then falls back to whatever the remote's HEAD points at,
 * which is the same thing by another route.
 */
async function repoMeta(
  owner: string,
  repo: string,
  token: string,
  fetchImpl: Fetch,
  api: string,
): Promise<{ isPrivate: boolean; defaultBranch: string }> {
  try {
    const res = await fetchImpl(`${api}/repos/${owner}/${repo}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "graft-app",
      },
    });
    if (!res.ok) return { isPrivate: true, defaultBranch: "" };
    const parsed = JSON.parse(await res.text()) as { private?: boolean; default_branch?: string };
    return {
      isPrivate: parsed.private !== false,
      defaultBranch: (parsed.default_branch ?? "").trim(),
    };
  } catch {
    return { isPrivate: true, defaultBranch: "" };
  }
}
