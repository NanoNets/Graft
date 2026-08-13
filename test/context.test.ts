/**
 * End-to-end tests for the markdown-graph pipeline (`init` → `check`), driven by
 * offline test doubles so no LLM/network is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildContext } from "../src/context/build.js";
import { Graft } from "../src/engine.js";
import { checkContext, indexFreshness, staleBanner } from "../src/context/check.js";
import { contextDirFor, ensureGitignored, ensureSearchable } from "../src/context/node-file.js";
import { writeBuildConfig } from "../src/util/state.js";
import { fakeProviders, BracketSynthesizer, PassthroughSummarizer, rmDir } from "./helpers.js";
import type { Summarizer, Synthesizer, SynthNode, FileSummary } from "../src/index.js";
import type { ChatModel } from "../src/ai/llm/types.js";

// CLI-spawn helper (same pattern as test/graph-traverse-cli.test.ts) — these tests
// exercise the real process boundary (exit codes), which a unit-level call into
// checkContext()/checkGraph() can't: the pass/fail decision lives in cli.ts's
// `check` action, combining both layers' results.
function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-"));
  writeFileSync(
    join(dir, "auth.ts"),
    `// [[Auth Service]] ==depends_on==> [[Token Store]]\nexport const auth = 1;\n`,
  );
  writeFileSync(
    join(dir, "billing.ts"),
    `// [[Billing]] ==uses==> [[Auth Service]]\nexport const billing = 2;\n`,
  );
  return dir;
}

function buildOpts() {
  return { model: "fake", ...fakeProviders() };
}

test("init builds one markdown node per entity, with links and a manifest", async () => {
  const dir = makeFixture();
  try {
    const r = await buildContext(dir, buildOpts());
    // Auth Service, Token Store, Billing.
    assert.equal(r.nodes, 3);
    assert.equal(r.links, 2);
    assert.equal(r.files, 2);

    const ctx = join(dir, "graft");
    assert.ok(existsSync(join(ctx, "auth-service.md")));
    assert.ok(existsSync(join(ctx, "token-store.md")));
    assert.ok(existsSync(join(ctx, "billing.md")));
    assert.ok(existsSync(join(ctx, "manifest.json")));

    // Auth Service is referenced from BOTH files → multi-source provenance.
    const authMd = readFileSync(join(ctx, "auth-service.md"), "utf8");
    assert.match(authMd, /path: auth\.ts/);
    assert.match(authMd, /path: billing\.ts/);
    // Its edge to Token Store is rendered as a wiki-link.
    assert.match(authMd, /\[\[token-store\]\]/);

    const manifest = JSON.parse(readFileSync(join(ctx, "manifest.json"), "utf8"));
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.nodes.length, 3);
  } finally {
    rmDir(dir);
  }
});

test("check passes immediately after init", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    const r = checkContext(dir);
    assert.equal(r.ok, true);
    assert.equal(r.missing, false);
  } finally {
    rmDir(dir);
  }
});

test("check reports NO GRAPH when init never ran", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-"));
  try {
    const r = checkContext(dir);
    assert.equal(r.missing, true);
    assert.equal(r.ok, false);
  } finally {
    rmDir(dir);
  }
});

test("check detects content drift when a source file changes", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    writeFileSync(join(dir, "auth.ts"), `// [[Auth Service]]\nexport const auth = 999;\n`);
    const r = checkContext(dir);
    assert.equal(r.ok, false);
    assert.equal(r.contentDrift.length, 1);
    assert.equal(r.contentDrift[0].path, "auth.ts");
  } finally {
    rmDir(dir);
  }
});

test("indexFreshness/staleBanner: recorded files gone from disk (the branch-switch / stale-index case)", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    // Fresh right after build: nothing missing, no banner.
    const fresh = indexFreshness(dir);
    assert.ok(fresh && fresh.missing === 0, "fresh index reports zero missing");
    assert.equal(staleBanner(fresh), null, "no banner when fresh");
    // Simulate a checkout to a tree where a recorded file doesn't exist.
    rmSync(join(dir, "auth.ts"), { force: true });
    const stale = indexFreshness(dir);
    assert.ok(stale && stale.missing >= 1, "missing count rises when a recorded file vanishes");
    const banner = staleBanner(stale);
    assert.match(banner ?? "", /ahead of your working tree/, "banner fires when stale");
    assert.match(banner ?? "", /graft grep/, "banner steers to graft grep, not raw grep");
  } finally {
    rmDir(dir);
  }
});

test("indexFreshness returns null when there is no graph", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-fresh-nograph-"));
  try {
    assert.equal(indexFreshness(dir), null);
    assert.equal(staleBanner(null), null);
  } finally {
    rmDir(dir);
  }
});

test("check detects a new file not yet in the graph (coverage drift)", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    writeFileSync(join(dir, "new.ts"), `// [[New Thing]]\nexport const n = 3;\n`);
    const r = checkContext(dir);
    assert.equal(r.ok, false);
    assert.deepEqual(r.coverage, ["new.ts"]);
  } finally {
    rmDir(dir);
  }
});

// A5 — a persisted `--include-dir` override must reach the Tier-2 markdown
// pipeline (context/build.ts) and its freshness check (context/check.ts), not
// just the Tier-1 wiring graph (graph/build.ts, via source-files.ts). Both
// sides must agree, in both directions: build/ shows up in buildContext's
// file listing, and checkContext neither reports it removed (disagreeing
// about what "current" means) nor as new coverage.
test("A5: a persisted --include-dir override reaches context/build.ts's file listing and context/check.ts's freshness check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-include-dir-"));
  try {
    writeFileSync(
      join(dir, "auth.ts"),
      `// [[Auth Service]]\nexport const auth = 1;\n`,
    );
    mkdirSync(join(dir, "build"), { recursive: true });
    writeFileSync(
      join(dir, "build", "gen.ts"),
      `// [[Generated Widget]]\nexport const genWidget = 1;\n`,
    );
    writeBuildConfig(dir, { includeDirs: ["build"] });

    const r = await buildContext(dir, buildOpts());
    assert.deepEqual(r.errors, [], "build should not error");
    assert.ok(
      manifestFiles(dir).includes("build/gen.ts"),
      "build/gen.ts must be walked and recorded once --include-dir is persisted",
    );

    const check = checkContext(dir);
    assert.equal(check.ok, true, `expected no drift, got ${JSON.stringify(check)}`);
    assert.deepEqual(check.removed, [], "build/ must not be reported removed — check.ts must see it too");
    assert.deepEqual(check.coverage, [], "build/ must not be reported as new/uncovered — it's already in the manifest");
  } finally {
    rmDir(dir);
  }
});

function manifestFiles(dir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(dir, "graft", "manifest.json"), "utf8"));
  return manifest.files.map((f: { path: string }) => f.path);
}

test("re-running init clears drift", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    writeFileSync(join(dir, "new.ts"), `// [[New Thing]]\nexport const n = 3;\n`);
    assert.equal(checkContext(dir).ok, false);
    await buildContext(dir, buildOpts());
    assert.equal(checkContext(dir).ok, true);
  } finally {
    rmDir(dir);
  }
});

test("human notes below the generated block survive regeneration", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    const path = join(dir, "graft", "billing.md");
    const withNote = readFileSync(path, "utf8") + "\nHand-written note: watch out for retries.\n";
    writeFileSync(path, withNote);
    await buildContext(dir, buildOpts());
    assert.match(readFileSync(path, "utf8"), /Hand-written note: watch out for retries\./);
  } finally {
    rmDir(dir);
  }
});

// --- failure paths: an LLM outage must never cost the user their graph -------
//
// graft/ is git-ignored, so anything phase 5 deletes is gone for good — including
// whatever a human wrote under `## Notes`, which node-file.ts promises to keep
// verbatim. Every test below drives a REAL failure (an expired key, a rate limit,
// a truncated turn) through the same summarizer/synthesizer injection seam the
// engine exposes, and asserts the previous build survived it.

/** Every call fails, the way an expired key or a 429 storm fails: all of them. */
class FailingSummarizer implements Summarizer {
  calls = 0;
  constructor(private message = "401 invalid api key") {}
  async summarize(): Promise<string> {
    this.calls++;
    throw new Error(this.message);
  }
}

/** Succeeds at the wire level and returns nothing — a truncated or refused turn. */
class EmptySummarizer implements Summarizer {
  async summarize(): Promise<string> {
    return "   ";
  }
}

class FailingSynthesizer implements Synthesizer {
  async synthesize(): Promise<SynthNode[]> {
    throw new Error("429 rate limited");
  }
}

/** Counts calls so a test can prove the second run paid for nothing. */
class CountingSummarizer implements Summarizer {
  calls = 0;
  private inner = new PassthroughSummarizer();
  async summarize(code: string, opts: { path: string }): Promise<string> {
    this.calls++;
    return this.inner.summarize(code, opts);
  }
}

function cacheFile(dir: string): string {
  return join(dir, "graft", ".cache", "summaries.json");
}

/**
 * Edit both fixture files so phase 1 misses the content-hash cache, keeping the
 * `[[…]]` markup (and therefore the node set) identical. Without this, a rebuild
 * calls the model zero times and no injected failure can fire at all.
 */
function editSources(dir: string): void {
  writeFileSync(join(dir, "auth.ts"), `// [[Auth Service]] ==depends_on==> [[Token Store]]\nexport const auth = 42;\n`);
  writeFileSync(join(dir, "billing.ts"), `// [[Billing]] ==uses==> [[Auth Service]]\nexport const billing = 43;\n`);
}

function readCache(dir: string): { summaries: Record<string, unknown>; synth: Record<string, unknown> } {
  return JSON.parse(readFileSync(cacheFile(dir), "utf8"));
}

test("a --deep run where EVERY summary fails leaves the concept layer (and its human notes) untouched", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    const path = join(dir, "graft", "billing.md");
    writeFileSync(path, readFileSync(path, "utf8") + "\nHand-written note: watch out for retries.\n");
    const manifestBefore = readFileSync(join(dir, "graft", "manifest.json"), "utf8");
    editSources(dir); // the code moved on; the key expired in the meantime

    const summarizer = new FailingSummarizer();
    const r = await buildContext(dir, { model: "fake", summarizer, synthesizer: new BracketSynthesizer() });

    assert.equal(summarizer.calls, 2, "each file was still attempted");
    assert.ok(r.errors.length > 0, "the failure must be reported, not swallowed");
    assert.match(r.errors.join("\n"), /left untouched/, "and it must say the graph was preserved");

    assert.ok(existsSync(join(dir, "graft", "auth-service.md")), "an outage is not evidence a concept disappeared");
    assert.match(readFileSync(path, "utf8"), /Hand-written note: watch out for retries\./);
    assert.equal(readFileSync(join(dir, "graft", "manifest.json"), "utf8"), manifestBefore, "the roster still describes what is on disk");
    // The layer is internally consistent (drift against the edited code is the
    // honest signal: `check` should say "rebuild me", not "your concepts are gone").
    assert.deepEqual(checkContext(dir).indexDrift, []);
  } finally {
    rmDir(dir);
  }
});

test("a summary that comes back empty is an error, never a cache entry", async () => {
  const dir = makeFixture();
  try {
    // Empty is cached by CONTENT HASH, so caching it once makes it permanent: the
    // next run hits it, phase 2 filters the file out of synthesis, and the file is
    // silently absent from the graph forever with no error to explain it.
    const r = await buildContext(dir, { model: "fake", summarizer: new EmptySummarizer(), synthesizer: new BracketSynthesizer() });
    assert.equal(r.summarized, 0, "an empty string is not a summary");
    assert.equal(r.errors.length > 0, true);
    assert.match(r.errors.join("\n"), /empty summary/);
    assert.deepEqual(readCache(dir).summaries, {}, "nothing may be written to the content-hash cache");
  } finally {
    rmDir(dir);
  }
});

test("a synthesis failure keeps the per-file summaries already paid for, and the graph on disk", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    editSources(dir);

    // Phase 1 succeeds (N calls, real money on a real repo); phase 2 dies on a 429.
    const first = new CountingSummarizer();
    const r = await buildContext(dir, { model: "fake", summarizer: first, synthesizer: new FailingSynthesizer() });
    assert.equal(r.errors.length > 0, true, "the batch failure must surface");
    assert.match(r.errors.join("\n"), /synthesis batch/);
    assert.ok(existsSync(join(dir, "graft", "auth-service.md")), "a partial run must not prune");

    // The retry must be cheap: every summary from the failed run is on disk.
    const second = new CountingSummarizer();
    const again = await buildContext(dir, { model: "fake", summarizer: second, synthesizer: new BracketSynthesizer() });
    assert.equal(second.calls, 0, "phase 1 was persisted before synthesis ran, so nothing is repaid");
    assert.equal(again.cached, 2);
    assert.equal(again.nodes, 3, "and the run that finally synthesizes writes the graph normally");
  } finally {
    rmDir(dir);
  }
});

test("a failed batch is not cached as an empty result — the next run retries it", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, { model: "fake", summarizer: new PassthroughSummarizer(), synthesizer: new FailingSynthesizer() });
    // `[]` is a legitimate cached answer ("this batch yields no nodes"), so writing
    // one for a batch that 429'd would turn a transient failure into a permanent
    // cache hit that never calls the model again.
    assert.deepEqual(readCache(dir).synth, {}, "a batch that never answered has no answer to cache");

    const r = await buildContext(dir, buildOpts());
    assert.equal(r.nodes, 3, "the retry actually re-ran synthesis");
  } finally {
    rmDir(dir);
  }
});

test("buildContext honours the concurrency it is given (this is what -j promises)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-conc-"));
  try {
    for (let i = 0; i < 12; i++) writeFileSync(join(dir, `f${i}.ts`), `// [[Thing ${i}]]\nexport const x${i} = ${i};\n`);

    // A user who passes `-j 1` is working around a rate limit — or, with the
    // claude-cli provider, avoiding N simultaneous Claude Code processes. The
    // phase-1 loop used to ignore the option entirely and always run 8 in flight.
    const track = (limit: number) => {
      let inFlight = 0;
      let peak = 0;
      const summarizer: Summarizer = {
        async summarize(code: string) {
          peak = Math.max(peak, ++inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return code;
        },
      };
      return { summarizer, run: () => buildContext(dir, { model: "fake", concurrency: limit, summarizer, synthesizer: new BracketSynthesizer() }), peak: () => peak };
    };

    const one = track(1);
    await one.run();
    assert.equal(one.peak(), 1, "-j 1 must mean ONE call at a time");

    // A fresh dir: the run above cached every summary, so nothing would be called.
    rmDir(join(dir, "graft"));
    const three = track(3);
    await three.run();
    assert.equal(three.peak(), 3);
  } finally {
    rmDir(dir);
  }
});

test("Graft.init forwards the concurrency it is given down to the concept pass", async () => {
  // The half above proves buildContext honours the option; this proves the option
  // can be REACHED from the only entry point anyone actually uses. `-j` was parsed
  // in cli.ts and handed to `engine.graph` alone, so `InitOptions` had no field to
  // carry it: the flag that exists to survive a rate limit left the phase that
  // makes the most calls running 5 at a time regardless.
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-engine-conc-"));
  try {
    for (let i = 0; i < 8; i++) writeFileSync(join(dir, `f${i}.ts`), `// [[Thing ${i}]]\nexport const x${i} = ${i};\n`);
    let inFlight = 0;
    let peak = 0;
    const summarizer: Summarizer = {
      async summarize(code: string) {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return code;
      },
    };
    await new Graft({ summarizer, synthesizer: new BracketSynthesizer() }).init(dir, { concurrency: 1 });
    assert.equal(peak, 1, "-j 1 must mean ONE call at a time through the engine too");
  } finally {
    rmDir(dir);
  }
});

test("Graft counts the tokens every op spends, including a caller's own chatModel", async () => {
  // The adapters normalize `Usage` (uncached input kept apart from cache reads and
  // cache writes, per provider) and every op then discarded it, so a --deep build
  // over thousands of files could not say afterwards how many calls it had made.
  // Counted by wrapping the transport once — which has to hold for an INJECTED
  // chatModel too, since that path skips the factory entirely.
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-usage-"));
  try {
    for (let i = 0; i < 3; i++) writeFileSync(join(dir, `f${i}.ts`), `// [[Thing ${i}]]\nexport const x${i} = ${i};\n`);
    const chatModel: ChatModel = {
      label: "fake:model",
      async create() {
        return {
          text: "a summary",
          toolCalls: [],
          usage: { input: 10, output: 5, cacheRead: 2, cacheCreate: 1 },
          stopReason: "stop",
          assistant: { role: "assistant" as const, content: "a summary" },
        };
      },
    };
    const engine = new Graft({ chatModel });
    assert.deepEqual(engine.usage(), { calls: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

    await engine.init(dir);
    const u = engine.usage();
    assert.ok(u.calls >= 3, `one call per file at least, got ${u.calls}`);
    assert.equal(u.input, 10 * u.calls);
    assert.equal(u.output, 5 * u.calls);
    assert.equal(u.cacheRead, 2 * u.calls, "cache reads stay separate — they are billed differently");
    assert.equal(u.cacheCreate, 1 * u.calls);
    // A copy, not the live counter: a caller holding the result must not watch it move.
    const snapshot = engine.usage();
    await engine.init(dir);
    assert.equal(snapshot.calls, u.calls);
  } finally {
    rmDir(dir);
  }
});

// `graft check` on the CLI combines the markdown-context layer (checkContext) and the
// wiring-graph layer (checkGraph). A keyless `graft build` (no --deep) only ever produces
// the wiring layer — manifest.json (markdown layer) is never written — so `check` must not
// treat that absence as failure on its own.
test("graft check: keyless build (no --deep) exits 0 — wiring graph present, markdown layer never built", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-cli-"));
  try {
    writeFileSync(join(dir, "math.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const built = runCli(["build", dir]);
    assert.equal(built.status, 0);

    const r = runCli(["check", dir]);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /deep layer: not built/);
    assert.match(r.stdout, /wiring graph is the source of truth/);
    assert.match(r.stdout, /graph check: OK/);
  } finally {
    rmDir(dir);
  }
});

test("graft check: neither layer ever built exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-cli-"));
  try {
    const r = runCli(["check", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /NO GRAPH/);
    assert.match(r.stdout, /graft build/);
  } finally {
    rmDir(dir);
  }
});

test("graft check: keyless build then code changes (wiring stale) exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-cli-"));
  try {
    const file = join(dir, "math.ts");
    writeFileSync(file, "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const built = runCli(["build", dir]);
    assert.equal(built.status, 0);

    // Change the code without rebuilding — the wiring graph (the only layer that
    // exists) is now stale, so check must fail even though the markdown layer is
    // still just "not built" rather than "stale".
    writeFileSync(
      file,
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n" +
        "export function sub(a: number, b: number): number {\n  return a - b;\n}\n",
    );

    const r = runCli(["check", dir]);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /graph check: STALE/);
  } finally {
    rmDir(dir);
  }
});

// ensureGitignored — every `graft build` self-ignores its regenerable graph dir.
test("ensureGitignored: creates .gitignore with the graft/ entry when none exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgi-"));
  try {
    ensureGitignored(dir, contextDirFor(dir));
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.match(gi, /^graft\/$/m);
    assert.match(gi, /regenerable, not committed/);
  } finally {
    rmDir(dir);
  }
});

test("ensureGitignored: appends to an existing .gitignore without clobbering it", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgi-"));
  try {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n");
    ensureGitignored(dir, contextDirFor(dir));
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.match(gi, /node_modules\//);
    assert.match(gi, /dist\//);
    assert.match(gi, /^graft\/$/m);
  } finally {
    rmDir(dir);
  }
});

test("ensureGitignored: idempotent — a second build adds nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgi-"));
  try {
    ensureGitignored(dir, contextDirFor(dir));
    const once = readFileSync(join(dir, ".gitignore"), "utf8");
    ensureGitignored(dir, contextDirFor(dir));
    const twice = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.equal(once, twice);
    assert.equal((twice.match(/^graft\/$/gm) ?? []).length, 1);
  } finally {
    rmDir(dir);
  }
});

test("ensureGitignored: recognizes a pre-existing bare `graft` entry (no slash) and stays silent", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgi-"));
  try {
    writeFileSync(join(dir, ".gitignore"), "graft\n");
    ensureGitignored(dir, contextDirFor(dir));
    assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "graft\n");
  } finally {
    rmDir(dir);
  }
});

test("ensureGitignored: no-op when the graph dir is outside the repo root", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgi-"));
  try {
    ensureGitignored(dir, join(tmpdir(), "somewhere-else-graft"));
    assert.equal(existsSync(join(dir, ".gitignore")), false);
  } finally {
    rmDir(dir);
  }
});

// ensureSearchable — gitignoring the graph must not also hide it from `grep`.
// ripgrep honours .gitignore, so without this the cards are unreachable by the
// one mechanism they were designed around.
test("ensureSearchable: re-admits the card tree while excluding the caches", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxsearch-"));
  try {
    ensureSearchable(dir, contextDirFor(dir));
    const ig = readFileSync(join(dir, ".ignore"), "utf8");
    assert.match(ig, /^!graft\/$/m, "the tree is re-admitted to search");
    assert.match(ig, /^graft\/\.cache\/$/m, "but not the multi-MB parse memo");
    assert.match(ig, /^graft\/\.graph\/$/m, "and not wiring.json");
    assert.match(ig, /ripgrep reads/, "carries the why, for whoever finds this file");
  } finally {
    rmDir(dir);
  }
});

test("ensureSearchable: appends to an existing .ignore, and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxsearch-"));
  try {
    writeFileSync(join(dir, ".ignore"), "vendor/\n");
    ensureSearchable(dir, contextDirFor(dir));
    const once = readFileSync(join(dir, ".ignore"), "utf8");
    assert.match(once, /vendor\//, "existing entries survive");
    ensureSearchable(dir, contextDirFor(dir));
    const twice = readFileSync(join(dir, ".ignore"), "utf8");
    assert.equal(once, twice);
    assert.equal((twice.match(/^!graft\/$/gm) ?? []).length, 1);
  } finally {
    rmDir(dir);
  }
});

test("ensureSearchable: leaves a hand-written negation alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxsearch-"));
  try {
    // Someone already had an opinion here — don't append a competing block.
    writeFileSync(join(dir, ".ignore"), "# mine\n!graft/\n");
    ensureSearchable(dir, contextDirFor(dir));
    assert.equal(readFileSync(join(dir, ".ignore"), "utf8"), "# mine\n!graft/\n");
  } finally {
    rmDir(dir);
  }
});

test("ensureSearchable: no-op when the graph dir is outside the repo root", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxsearch-"));
  try {
    ensureSearchable(dir, join(tmpdir(), "somewhere-else-graft"));
    assert.equal(existsSync(join(dir, ".ignore")), false);
  } finally {
    rmDir(dir);
  }
});
