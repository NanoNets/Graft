/**
 * The pre-query rebuild lock's crash recovery (`src/graph/refresh.ts`).
 *
 * `releaseOnSignal` covers the polite exits. It cannot cover Windows, which has no
 * SIGTERM: the Claude Code prompt hook runs `graft ask` under a timeout enforced
 * with `execFileSync`, and there the process is terminated outright — no signal
 * handler, no `exit` listener, no `finally`. The lock file survives its owner, and
 * for the next five minutes (`LOCK_STALE_MS`) every query waits out `LOCK_WAIT_MS`
 * and then answers from the stale graph with "a graph rebuild is already in flight".
 * A hard kill or a crash does the same on every platform.
 *
 * So the owner's liveness, not the file's age, is what these pin down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { reclaimDeadLock } from "../src/graph/refresh.js";
import { acquireLockIn, releaseLockIn } from "../src/util/state.js";
import { tmpRepo } from "./helpers.js";

const LOCK = ".sync.lock";

function cache(): string {
  const d = join(tmpRepo("refresh-lock"), "graft", ".cache");
  mkdirSync(d, { recursive: true });
  return d;
}

function writeLock(dir: string, pid: unknown): string {
  const p = join(dir, LOCK);
  writeFileSync(p, JSON.stringify({ pid, at: new Date().toISOString() }));
  return p;
}

/** A pid that is definitely not running: a child we watched exit. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  assert.ok(r.pid, "could not spawn a throwaway child to harvest a dead pid");
  return r.pid!;
}

test("a lock left behind by a killed process is reclaimed immediately", () => {
  const dir = cache();
  const p = writeLock(dir, deadPid());
  assert.equal(reclaimDeadLock(dir), true);
  assert.equal(existsSync(p), false, "the dead owner's lock is removed");
  // The point of removing it: the next query rebuilds instead of waiting out
  // LOCK_WAIT_MS and answering from a graph it knows is stale.
  assert.equal(acquireLockIn(dir), true);
  releaseLockIn(dir);
});

test("a lock held by a live process is never reclaimed", async () => {
  const dir = cache();
  // A real, live, foreign process — `process.kill(pid, 0)` answering is the whole
  // signal, so a made-up pid would prove nothing.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 200));
  try {
    const p = writeLock(dir, child.pid);
    assert.equal(reclaimDeadLock(dir), false);
    assert.equal(existsSync(p), true, "an in-flight rebuild keeps its lock");
    assert.equal(acquireLockIn(dir), false, "and nobody else gets to build");
  } finally {
    child.kill("SIGKILL");
  }
});

test("our own lock is left alone", () => {
  const dir = cache();
  assert.equal(acquireLockIn(dir), true);
  const before = readFileSync(join(dir, LOCK), "utf8");
  assert.equal(reclaimDeadLock(dir), false, "reclaiming the lock we hold would be the bug");
  assert.equal(readFileSync(join(dir, LOCK), "utf8"), before);
  releaseLockIn(dir);
});

test("an unreadable or pid-less lock falls back to the age rule", () => {
  const dir = cache();
  // Written by a graft old enough to predate the pid field, or truncated by a
  // crash mid-write. Unknown ownership must read as "someone else's", not as
  // permission to delete — LOCK_STALE_MS still ages it out.
  for (const body of ["{ not json", JSON.stringify({ at: "now" }), JSON.stringify({ pid: "1234" })]) {
    writeFileSync(join(dir, LOCK), body);
    assert.equal(reclaimDeadLock(dir), false, `left alone: ${body}`);
    assert.equal(existsSync(join(dir, LOCK)), true);
  }
});

test("no lock at all is not an error", () => {
  assert.equal(reclaimDeadLock(cache()), false);
});
