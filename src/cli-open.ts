/**
 * Handing a URL to the desktop's browser — `graft viz --open`'s last step, and the
 * one place the CLI launches a program it neither ships nor can check for.
 *
 * Split out of `cli.ts` because the failure it guards is invisible until it isn't:
 * `ChildProcess` is an `EventEmitter`, and an `'error'` event with no listener is
 * re-thrown as an uncaughtException. `xdg-open` does not exist in WSL without a
 * desktop, in a container, or on a headless server, so the ENOENT arrived one tick
 * after `graft viz` printed its URL and killed the process — taking the viz server
 * with it, on the machines where a served URL is the *only* way to see the graph.
 * There is no `process.on('uncaughtException')` anywhere in this codebase to catch
 * it, which is the right choice and also why this listener has to exist.
 *
 * Failing to open a browser is not a failure of `graft viz`: the URL is already on
 * screen and the server is already serving. Report and carry on.
 */
import { spawn } from "node:child_process";

/** The platform's "open this thing with whatever handles it" command. */
export function browserOpener(): string {
  if (process.platform === "darwin") return "open";
  // `start` is a cmd.exe builtin, not an executable — hence the shell below.
  if (process.platform === "win32") return "start";
  return "xdg-open";
}

export interface OpenOptions {
  /** Override the platform default (tests, and anyone with a $BROWSER opinion). */
  opener?: string;
  /** Override the platform default; `start` needs a shell, the others do not. */
  shell?: boolean;
  /** What to say when the opener can't be launched at all. */
  onError?: (err: Error) => void;
}

/**
 * Launch the browser opener, detached, and never let its failure reach the caller.
 * Returns nothing to await on purpose — the point is that `graft viz` moves on.
 */
export function openInBrowser(url: string, opts: OpenOptions = {}): void {
  const shell = opts.shell ?? process.platform === "win32";
  const child = spawn(opts.opener ?? browserOpener(), [url], { stdio: "ignore", detached: true, shell });
  const report =
    opts.onError ??
    (() => console.error(`· couldn't open a browser automatically — open ${url} yourself (the server is running).`));
  child.on("error", report);
  child.unref();
}
