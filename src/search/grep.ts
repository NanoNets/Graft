/**
 * `graft grep` core: regex search over the graph's indexed files, with hits
 * grouped by their innermost enclosing symbol and ranked by incoming-edge
 * count (coupling) — a grep that answers "which of these hits matters",
 * because plain `grep -rn` gives no way to tell a hit inside a
 * heavily-depended-on function from one inside dead code.
 *
 * Pure I/O + regex, no CLI/MCP concerns: `grep-cli.ts` formats this into
 * human text and wires the CLI command; `mcp/tools.ts` renders the same
 * shape for the `graft_find_all` tool.
 */
import { join } from "node:path";
import type { GraphV1, NodeV1 } from "../graph/types.js";
import { WALK_RELATIONS } from "../graph/relations.js";
import { assertPrefixIndexed, pathUnderPrefix } from "../graph/scopes.js";
import { normalizePathPrefix } from "../util/paths.js";
import { savingsFor, type Savings } from "../context/savings.js";
import { readSourceFile } from "../util/source.js";

export interface GrepHit {
  line: number;
  /** Trimmed line text, capped at 160 chars. */
  text: string;
}

export interface GrepSymbolRef {
  id: string;
  /** Qualified scope-joined name (e.g. `FastAPI.include_router`), not just
   * the bare symbol name — the id's segment after the file-path `#`. */
  name: string;
  kind: string;
  path: string;
  span: string;
}

export interface GrepGroup {
  /** null → file-level: the hit lies outside every indexed symbol's span
   * (module-level code — imports, top-level statements, module constants). */
  symbol: GrepSymbolRef | null;
  path: string;
  /** Incoming WALK_RELATIONS edges targeting the symbol — always 0 for
   * file-level groups (there's no single symbol id to count edges against). */
  inDegree: number;
  hits: GrepHit[];
}

export interface GrepResult {
  pattern: string;
  /** Indexed file nodes considered (after the `in` filter), whether or not
   * each was actually readable — matches the CLI's "searched N indexed
   * files" wording. */
  filesSearched: number;
  /** Hits actually collected (<= maxHits). */
  totalHits: number;
  /** Sorted: inDegree desc, then path asc. */
  groups: GrepGroup[];
  /** Dropped counts — never silent. `files`: indexed file nodes that
   * couldn't be read from disk. `hits`: matches found beyond `maxHits`,
   * counted but not collected. `timeout`: the scan hit its wall-clock budget
   * and stopped early, so the remaining indexed files were never searched —
   * a zero-hit answer under this flag means "gave up", not "not there". */
  truncated: { files: number; hits: number; timeout?: boolean };
  /** Tokens-saved baseline: the files that had hits, read whole. Undefined
   * when there were no hits or the graph predates file sizing. */
  saved?: Savings;
}

export interface GrepOptions {
  ignoreCase?: boolean;
  /** Treat `pattern` as a literal string (regex-escaped), not a regex. */
  fixed?: boolean;
  /** Narrow to file nodes at or under this repo-relative path prefix — the same
   * segment-aware rule `ask --in` and `callers --in` use. Either separator. */
  in?: string;
  /** Stop collecting hits after this many; the rest are tallied into
   * `truncated.hits`. Default 300. */
  maxHits?: number;
  /** Wall-clock ceiling for the whole scan, in ms. Default
   * {@link DEFAULT_BUDGET_MS}. Exposed mainly so tests can pick a budget
   * small enough to observe without burning seconds. */
  budgetMs?: number;
}

/** Exported because workspace federation has to spend this ONE budget across the
 * children rather than give each its own — see `graph/workspace.ts#federateGrep`. */
export const DEFAULT_MAX_HITS = 300;

/**
 * Wall-clock ceiling for a single `grepGraph` call.
 *
 * The pattern is attacker-controlled in practice: it arrives raw from
 * `graft_find_all`, i.e. from whatever the model decided to type, and the MCP
 * server reads its JSON-RPC lines synchronously on the one event loop. A
 * classic catastrophic-backtracking pattern (`(a+)+$` against a line of a's)
 * takes exponential time per line, so without a ceiling one tool call wedges
 * the whole server for minutes — and `notifications/cancelled` is a no-op,
 * there is nothing to cancel with.
 *
 * This bounds the AGGREGATE scan, checked between lines. It cannot interrupt a
 * single `RegExp.test` already inside the engine — JS has no regex timeout and
 * `grepGraph` is synchronous by contract (both the CLI and the MCP tool call it
 * inline) — so one pathological line can still overshoot. What it does buy is
 * that the cost stops scaling with the repo: the damage is one line's
 * backtracking instead of one line's backtracking times every line of every
 * indexed file.
 */
export const DEFAULT_BUDGET_MS = 5_000;
const MAX_HIT_TEXT = 160;
const SPAN_RE = /^L(\d+)-L(\d+)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function spanBounds(span: string): { start: number; end: number } | null {
  const m = SPAN_RE.exec(span);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

interface SymbolSpan {
  node: NodeV1;
  start: number;
  end: number;
}

/**
 * Every file's symbol nodes, bucketed by path and sorted ascending by span
 * start — the order `enclosingSymbol` scans in to find the innermost
 * containing span.
 *
 * Built ONCE per call rather than re-scanned per file. The per-file version
 * walked all of `graph.nodes` for each file node, so grouping alone cost
 * O(files x nodes) — 33k nodes over 3k files (the scale this repo's own ask
 * index cites) burned ~0.5s of CPU before a single byte was read from disk,
 * and doubling the repo quadrupled it. Every `graft_find_all` call paid that.
 */
function symbolsByPath(graph: GraphV1): Map<string, SymbolSpan[]> {
  const byPath = new Map<string, SymbolSpan[]>();
  for (const n of graph.nodes) {
    if (n.kind === "file") continue;
    const b = spanBounds(n.span);
    if (!b) continue;
    let bucket = byPath.get(n.path);
    if (!bucket) byPath.set(n.path, (bucket = []));
    bucket.push({ node: n, start: b.start, end: b.end });
  }
  for (const bucket of byPath.values()) bucket.sort((a, b) => a.start - b.start);
  return byPath;
}

/** Innermost symbol containing `line`: among spans that contain it, the one
 * with the greatest start line. Symbols are pre-sorted ascending by start,
 * so the last containing match seen wins, and the scan can stop as soon as
 * a span starts after `line` — nothing later in the sort can contain it. */
function enclosingSymbol(symbols: SymbolSpan[], line: number): NodeV1 | null {
  let found: NodeV1 | null = null;
  for (const s of symbols) {
    if (s.start > line) break;
    if (line <= s.end) found = s.node;
  }
  return found;
}

/** Incoming WALK_RELATIONS edge count per target id — one pass over
 * `graph.edges`, computed once per call and shared across every hit. */
function computeInDegree(graph: GraphV1): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of graph.edges) {
    if (!WALK_RELATIONS.has(e.relation)) continue;
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return deg;
}

function toSymbolRef(n: NodeV1): GrepSymbolRef {
  const hash = n.id.indexOf("#");
  return { id: n.id, name: hash >= 0 ? n.id.slice(hash + 1) : n.name, kind: n.kind, path: n.path, span: n.span };
}

export function grepGraph(graph: GraphV1, repoRoot: string, pattern: string, opts: GrepOptions = {}): GrepResult {
  const maxHits = opts.maxHits ?? DEFAULT_MAX_HITS;
  const source = opts.fixed ? escapeRegExp(pattern) : pattern;
  const regex = new RegExp(source, opts.ignoreCase ? "i" : "");

  const inDegree = computeInDegree(graph);
  // Same segment-aware prefix rule as `ask --in` / `callers --in`, and the same
  // loud failure when it matches nothing — `--in` used to mean a bare substring
  // here and a path prefix there, so `--in src` also swept up `lib/mysrc/`.
  const inPrefix = opts.in ? normalizePathPrefix(opts.in) : undefined;
  if (inPrefix) assertPrefixIndexed(graph, inPrefix);
  const fileNodes = graph.nodes.filter(
    (n) => n.kind === "file" && (inPrefix === undefined || pathUnderPrefix(n.path, inPrefix)),
  );

  const symbolIndex = symbolsByPath(graph);
  const groups = new Map<string, GrepGroup>();
  let collected = 0;
  let truncatedHits = 0;
  let truncatedFiles = 0;
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  let timedOut = false;

  // Counted as we go rather than taken from `fileNodes.length`: on a timeout
  // the remaining files were never opened, and reporting them as "searched"
  // would make the give-up look like a complete pass.
  let filesSearched = 0;

  for (const file of fileNodes) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    filesSearched++;
    let text: string;
    try {
      const decoded = readSourceFile(join(repoRoot, file.path));
      if (decoded === null) {
        truncatedFiles++; // unsupported encoding (e.g. UTF-16BE) — same posture as unreadable
        continue;
      }
      text = decoded;
    } catch {
      truncatedFiles++;
      continue;
    }

    const symbols = symbolIndex.get(file.path) ?? [];
    // `\r?` matters: with git's Windows default (core.autocrlf=true) the whole
    // working tree is CRLF on disk, and splitting on "\n" alone leaves a
    // trailing \r on every line. Any end-anchored pattern — `foo$`, `;\s*$`,
    // `=>\s*{$` — then matches nothing at all, silently, on the platform where
    // most of the tree looks like that. readSourceFile hands back the bytes
    // untouched, so the normalization has to happen here.
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }
      const raw = lines[i];
      if (!regex.test(raw)) continue;

      if (collected >= maxHits) {
        truncatedHits++;
        continue;
      }
      collected++;

      const lineNo = i + 1;
      const sym = enclosingSymbol(symbols, lineNo);
      const key = sym ? sym.id : `file:${file.path}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          symbol: sym ? toSymbolRef(sym) : null,
          path: file.path,
          inDegree: sym ? (inDegree.get(sym.id) ?? 0) : 0,
          hits: [],
        };
        groups.set(key, group);
      }
      const trimmed = raw.trim();
      group.hits.push({ line: lineNo, text: trimmed.length > MAX_HIT_TEXT ? trimmed.slice(0, MAX_HIT_TEXT) : trimmed });
    }
  }

  const sortedGroups = [...groups.values()].sort((a, b) => b.inDegree - a.inDegree || a.path.localeCompare(b.path));

  return {
    pattern,
    filesSearched,
    totalHits: collected,
    groups: sortedGroups,
    truncated: timedOut
      ? { files: truncatedFiles, hits: truncatedHits, timeout: true }
      : { files: truncatedFiles, hits: truncatedHits },
    saved: savingsFor(graph, sortedGroups.map((g) => g.path)),
  };
}
