/**
 * `graft viz --open`'s browser hand-off (`src/cli-open.ts`).
 *
 * The failure this pins down is asymmetric: on a desktop the opener always exists
 * and nothing is ever exercised, while in WSL without a desktop, in a container, or
 * on a headless server there is no `xdg-open` at all. `ChildProcess` is an
 * `EventEmitter`, so that ENOENT arrives as an `'error'` event one tick later, and
 * with no listener Node re-throws it as an uncaughtException — killing the process
 * immediately after it printed the URL, and taking the viz server down with it. On
 * exactly the machines where the served URL is the only way to see the graph.
 *
 * The opener is overridden explicitly (rather than left to the platform) so this
 * runs the same on both CI legs: on Windows the default is the `cmd.exe` builtin
 * `start`, which resolves through a shell and so never emits ENOENT.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserOpener, openInBrowser } from "../src/cli-open.js";

const MISSING = "graft-definitely-not-an-installed-opener";

/** Resolves with the error the spawn reported, or rejects if none arrives. */
function openAndCatch(opener: string): Promise<Error> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no 'error' event within 5s")), 5000);
    openInBrowser("http://127.0.0.1:4400/", {
      opener,
      // Without a shell the ENOENT surfaces as an 'error' event on every platform,
      // which is the case being guarded. Through a shell it becomes a non-zero
      // exit instead — invisible here, and harmless.
      shell: false,
      onError: (err) => {
        clearTimeout(timer);
        resolve(err);
      },
    });
  });
}

test("a missing browser opener is reported, not thrown", async () => {
  const err = await openAndCatch(MISSING);
  assert.match((err as NodeJS.ErrnoException).code ?? "", /ENOENT/);
});

test("the process survives the failed open", async () => {
  // The actual regression: an unhandled 'error' event is an uncaughtException, and
  // there is no `process.on('uncaughtException')` anywhere in this codebase to
  // absorb it. If the listener in `openInBrowser` were removed, this test file
  // would die here rather than reach the assertion.
  const uncaught: Error[] = [];
  const trap = (e: Error) => uncaught.push(e);
  process.on("uncaughtException", trap);
  try {
    await openAndCatch(MISSING);
    await new Promise((r) => setTimeout(r, 200)); // let a stray rethrow land
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", trap);
  }
});

test("the opener matches the platform's convention", () => {
  const expected = { darwin: "open", win32: "start" }[process.platform as string] ?? "xdg-open";
  assert.equal(browserOpener(), expected);
});
