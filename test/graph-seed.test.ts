/**
 * Seeding a git worktree's graph from its parent checkout.
 *
 * Two things have to hold. The worktree *shape* detection must be exactly right —
 * it decides whether graft reaches into a neighbouring directory at all, and a
 * submodule has the same `.git`-is-a-file shape while being a different repo — and
 * the copy must leave the parent checkout untouched while ending up with a graph
 * that describes *this* checkout's code, not the parent's.
 *
 * The end-to-end test drives real `git init` / `git worktree add` rather than
 * hand-written `.git` files, because the whole feature rests on an assumption about
 * git's on-disk layout and a fixture can't falsify that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { ensureFreshGraph, refreshNote } from "../src/graph/refresh.js";
import { mainWorktreeRoot, seedGraph } from "../src/graph/seed.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { callTool } from "../src/mcp/tools.js";

const MATH = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
const MUL = "export function mul(a: number, b: number): number {\n  return a * b;\n}\n";

const outOf = (d: string): string => join(d, "graft");
const tmp = (tag: string): string => mkdtempSync(join(tmpdir(), `graft-seed-${tag}-`));

/* ------------------------------------------------------------------ *
 * mainWorktreeRoot: telling the shapes apart
 * ------------------------------------------------------------------ */

/** A parent checkout with one registered worktree, built by hand. */
function fakePair(): { main: string; wt: string } {
  const box = tmp("shape");
  const main = join(box, "main");
  const wt = join(box, "wt");
  const gitdir = join(main, ".git", "worktrees", "w");
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${gitdir}\n`);
  return { main, wt };
}

test("mainWorktreeRoot finds the parent checkout of a linked worktree", () => {
  const { main, wt } = fakePair();
  assert.equal(mainWorktreeRoot(wt), main);
});

test("mainWorktreeRoot returns null for the main checkout itself", () => {
  const d = tmp("plain");
  mkdirSync(join(d, ".git"), { recursive: true });
  assert.equal(mainWorktreeRoot(d), null, "a .git directory means this *is* the checkout");
});

test("mainWorktreeRoot refuses a submodule", () => {
  // Same file shape as a worktree, but `.git/modules/<name>`: a submodule is its own
  // repo, and the superproject's graph describes entirely different code. Treating it
  // as a worktree would seed a repo with a graph full of paths it doesn't contain.
  const box = tmp("submodule");
  const sub = join(box, "sub");
  const gitdir = join(box, "super", ".git", "modules", "sub");
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, ".git"), `gitdir: ${gitdir}\n`);
  assert.equal(mainWorktreeRoot(sub), null);
});

test("mainWorktreeRoot survives every broken .git it can be handed", () => {
  const d = tmp("broken");
  assert.equal(mainWorktreeRoot(d), null, "no .git at all");

  writeFileSync(join(d, ".git"), "this is not a gitdir line\n");
  assert.equal(mainWorktreeRoot(d), null, "unparseable .git file");

  const { wt } = fakePair();
  rmSync(join(mainWorktreeRoot(wt)!, ".git", "worktrees", "w", "commondir"));
  assert.equal(mainWorktreeRoot(wt), null, "worktree shape but no commondir");

  // A bare repo (`repo.git/worktrees/w`): the common dir isn't named `.git` and there
  // is no working tree above it to hold a graph.
  const box = tmp("bare");
  const gitdir = join(box, "repo.git", "worktrees", "w");
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  const bareWt = join(box, "wt");
  mkdirSync(bareWt, { recursive: true });
  writeFileSync(join(bareWt, ".git"), `gitdir: ${gitdir}\n`);
  assert.equal(mainWorktreeRoot(bareWt), null);
});

/* ------------------------------------------------------------------ *
 * The real thing: git makes the worktree, graft seeds it
 * ------------------------------------------------------------------ */

/** Isolated from the developer's own git config, so CI and a laptop behave alike. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "graft test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "graft test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
}

/** A committed repo with one source file and `graft/` gitignored, as a real repo has. */
function gitRepo(): string {
  const d = tmp("repo");
  git(d, "init", "-b", "main");
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "math.ts"), MATH);
  writeFileSync(join(d, ".gitignore"), "graft/\n");
  git(d, "add", "-A");
  git(d, "commit", "-m", "init");
  return d;
}

function addWorktree(main: string, name: string): string {
  const wt = join(mkdtempSync(join(tmpdir(), "graft-seed-wt-")), name);
  git(main, "worktree", "add", "--detach", wt, "HEAD");
  return wt;
}

test("a git worktree starts with no graph, and one query gives it a correct one", async () => {
  const main = gitRepo();
  await buildGraph(main);
  const parentGraph = readFileSync(wiringPath(outOf(main)), "utf8");

  // State that belongs to the checkout that produced it, and must not travel.
  mkdirSync(join(outOf(main), ".cache", "session"), { recursive: true });
  writeFileSync(join(outOf(main), ".cache", "session", "abc.json"), "{}");
  writeFileSync(join(outOf(main), ".cache", "stats.json"), '{"tokens_saved":999}');

  const wt = addWorktree(main, "feature");
  assert.equal(existsSync(outOf(wt)), false, "git does not check out the gitignored cache");
  assert.equal(existsSync(wiringPath(outOf(wt))), false);

  // The worktree's code differs from the parent's — that difference is the whole
  // reason the copied graph can't just be used as-is.
  writeFileSync(join(wt, "src", "math.ts"), `${MATH}${MUL}`);

  const r = await ensureFreshGraph(wt);
  assert.equal(existsSync(wiringPath(outOf(wt))), true, "the worktree now has its own graph");
  assert.match(refreshNote(r) ?? "", /copied the graph from the main checkout/);
  assert.match(refreshNote(r) ?? "", /^\[graft\] refreshed the graph \(1 file changed\)/);

  const graph = readGraph(wiringPath(outOf(wt)));
  assert.ok(
    graph?.nodes.some((n) => n.id === "src/math.ts#mul"),
    "the graph describes the worktree's code, not the parent's",
  );
  assert.ok(graph?.nodes.some((n) => n.id === "src/math.ts#add"), "and kept what didn't change");

  // The passive surface came across too — it's what `grep` and the repo map read.
  assert.equal(existsSync(join(outOf(wt), "INDEX.md")), true);

  assert.equal(existsSync(join(outOf(wt), ".cache", "session")), false, "no session transcripts");
  assert.equal(existsSync(join(outOf(wt), ".cache", "stats.json")), false, "no borrowed savings");

  // Seeding reads the parent; it must never write to it.
  assert.equal(readFileSync(wiringPath(outOf(main)), "utf8"), parentGraph, "parent graph untouched");

  rmSync(main, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

test("a worktree nested inside the repo is seeded too, and isn't double-indexed", async () => {
  // Claude Code's own worktree feature puts them at `<repo>/.claude/worktrees/<name>`
  // rather than off in a temp dir. Same `.git`-file shape, but nested — so the parent's
  // own walk has to keep ignoring it (it does: `walkDir` skips dot-directories), or the
  // parent would index a second copy of its own source.
  const main = gitRepo();
  await buildGraph(main);
  const nested = join(main, ".claude", "worktrees", "inner");
  git(main, "worktree", "add", "--detach", nested, "HEAD");

  assert.equal(existsSync(wiringPath(outOf(nested))), false, "still nothing checked out");
  await ensureFreshGraph(nested);
  assert.equal(existsSync(wiringPath(outOf(nested))), true, "nested worktrees seed the same way");

  await buildGraph(main);
  const parent = readGraph(wiringPath(outOf(main)));
  assert.equal(
    parent?.nodes.filter((n) => n.id.includes(".claude")).length,
    0,
    "the parent must not index the worktree's copy of its own files",
  );

  rmSync(main, { recursive: true, force: true });
});

test("the MCP tool answers from a seeded worktree instead of refusing", async () => {
  const main = gitRepo();
  await buildGraph(main);
  const wt = addWorktree(main, "mcp");

  const res = await callTool(wt, "graft_find_code", { query: "add two numbers" });
  assert.equal(res.isError, false);
  assert.doesNotMatch(res.text, /no graph found/);
  assert.match(res.text, /math\.ts/);

  rmSync(main, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

test("GRAFT_NO_SEED leaves the worktree exactly as it was", async () => {
  const main = gitRepo();
  await buildGraph(main);
  const wt = addWorktree(main, "off");

  process.env.GRAFT_NO_SEED = "1";
  try {
    const r = await ensureFreshGraph(wt);
    assert.equal(existsSync(wiringPath(outOf(wt))), false, "no graph copied");
    assert.equal(refreshNote(r), null, "and nothing claimed");
    // The pre-seeding symptom, verbatim: `find_code` on an ungraphed checkout doesn't
    // say "no graph", it says "no matching nodes" — which reads like "your question
    // was bad" rather than "there is nothing to search". Worth pinning so the failure
    // mode this feature removes stays recognisable.
    const res = await callTool(wt, "graft_find_code", { query: "add" });
    assert.match(res.text, /no matching nodes/, "back to the pre-seeding behaviour");
  } finally {
    delete process.env.GRAFT_NO_SEED;
  }

  rmSync(main, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

test("seedGraph declines a --dir override and a checkout that already has a graph", async () => {
  const main = gitRepo();
  await buildGraph(main);
  const wt = addWorktree(main, "guards");

  // A custom output dir can't be mapped onto a sibling checkout, so don't guess.
  const elsewhere = tmp("dir");
  assert.deepEqual(seedGraph(wt, { contextDir: elsewhere }), { seeded: false });
  assert.equal(existsSync(wiringPath(elsewhere)), false);

  assert.equal(seedGraph(wt).seeded, true, "first call copies");
  assert.deepEqual(seedGraph(wt), { seeded: false }, "second call has nothing to do");

  rmSync(main, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

test("a plain repo with no parent checkout is left to `graft build`", async () => {
  const solo = gitRepo(); // a main checkout, never built
  const r = await ensureFreshGraph(solo);
  assert.equal(existsSync(wiringPath(outOf(solo))), false, "no surprise full build under a query");
  assert.equal(refreshNote(r), null);
  rmSync(solo, { recursive: true, force: true });
});

test("`graft build` in a worktree starts from the parent's graph, not from scratch", async () => {
  const main = gitRepo();
  await buildGraph(main);
  const wt = addWorktree(main, "build");
  writeFileSync(join(wt, "src", "math.ts"), `${MATH}${MUL}`);

  const g = await buildGraph(wt);
  // `realpathSync`: git writes the canonical path into the worktree's `.git`, and on
  // macOS the temp dir arrives here as the `/var` symlink to `/private/var`.
  assert.equal(g.seededFrom, realpathSync(main), "reported, because the user never built here");
  assert.equal(g.parsed, 1, "only the file this checkout changed was re-parsed");
  assert.ok(g.cards > 0, "and the passive surface is rebuilt for this checkout");

  rmSync(main, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});
