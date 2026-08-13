/**
 * Generic "breadth" extractor tier — one language-agnostic extractor over any
 * tree-sitter grammar + its `tags.scm` (the standard tree-sitter tags convention). This is how
 * graft covers the long tail of languages for ~one registry row each, instead of
 * a hand-written extractor per language (the depth tier in extract.ts).
 *
 * Grammars are WASM (`tree-sitter-wasms` bundle) loaded via `web-tree-sitter`, so
 * a new language needs no native node-gyp build. Loading is async (WASM init), so
 * callers MUST `await warmGenericGrammars([...])` once before the synchronous
 * `extractGeneric()` is used in a build/check loop. If a grammar isn't warmed,
 * `extractGeneric` degrades to a file node only (never throws).
 *
 * What it emits (signature-only): a file node + one node per `@definition.<kind>`
 * capture, and bare-name `calls` raw edges from `@reference.call` attributed to
 * the innermost enclosing definition. resolve.ts then resolves those calls by
 * name for free (same-file → extracted, unique-global → inferred). Member-call
 * receiver typing (recvType) is NOT produced here — that needs a per-language
 * binding pass; the opt-in LSP tier fills that gap for popular languages.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { contentHash } from "../util/id.js";
import type { Kind, NodeV1 } from "./types.js";
import type { ExtractResult, RawEdge } from "./extract.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// queries/ ships beside the compiled JS (copied by the build); fall back to src.
const QUERY_DIRS = [join(HERE, "queries"), join(HERE, "..", "..", "src", "graph", "queries")];

/** A breadth-tier language: graft name, file extensions, and the wasm basename
 * in tree-sitter-wasms/out/tree-sitter-<wasm>.wasm. One row per language. */
export interface GenericLang {
  name: string;
  exts: string[];
  wasm: string;
}

/** The breadth registry. Add a row + a queries/<name>.scm to support a language.
 * Extensions here must NOT collide with the depth tier's EXTENSIONS (extract.ts) —
 * with ONE deliberate, documented exception, `java` (see its row). */
export const GENERIC_LANGS: readonly GenericLang[] = [
  { name: "rust", exts: [".rs"], wasm: "rust" },
  // The exception to the no-collision rule above, and it is a TEST FIXTURE, not a
  // language graft indexes this way: `.java` belongs to the depth tier (extract.ts),
  // which always wins in build.ts (`lang ? null : genericLangOf(...)`), so
  // `extractGeneric` never sees a .java file in a real build. The row exists because
  // test/generic-extract.test.ts uses Java as its method-heavy example for the
  // breadth tier's call-kind widening. Callers computing what to WARM must filter out
  // depth-tier files first, or every Java repo loads a multi-MB wasm for nothing.
  { name: "java", exts: [".java"], wasm: "java" },
  { name: "c", exts: [".c", ".h"], wasm: "c" },
  { name: "cpp", exts: [".cpp", ".cc", ".cxx", ".hpp", ".hh"], wasm: "cpp" },
  { name: "ruby", exts: [".rb"], wasm: "ruby" },
  { name: "php", exts: [".php"], wasm: "php" },
  { name: "c_sharp", exts: [".cs"], wasm: "c_sharp" },
  // The rows above and the next four ship a queries/<name>.scm (calls + symbols).
  // ocaml, zig and dart have none and use the node-kind walker fallback (symbols only,
  // no call edges) — still one row, zero query.
  { name: "kotlin", exts: [".kt", ".kts"], wasm: "kotlin" },
  { name: "scala", exts: [".scala", ".sc"], wasm: "scala" },
  { name: "swift", exts: [".swift"], wasm: "swift" },
  { name: "elixir", exts: [".ex", ".exs"], wasm: "elixir" },
  { name: "solidity", exts: [".sol"], wasm: "solidity" },
  { name: "ocaml", exts: [".ml", ".mli"], wasm: "ocaml" },
  { name: "zig", exts: [".zig"], wasm: "zig" },
  { name: "dart", exts: [".dart"], wasm: "dart" }, // surfaced by PR #38 (@muneebshere)
];

const byExt = new Map<string, GenericLang>();
for (const l of GENERIC_LANGS) for (const e of l.exts) byExt.set(e, l);

/** The generic language for a path, or null if no breadth grammar claims it. */
export function genericLangOf(path: string): GenericLang | null {
  const lower = path.toLowerCase();
  for (const [ext, l] of byExt) if (lower.endsWith(ext)) return l;
  return null;
}

/** Every file extension a breadth-tier (generic tree-sitter) grammar claims. */
export function genericExtensions(): string[] {
  return GENERIC_LANGS.flatMap((l) => l.exts);
}

// tags.scm @definition.<X>  →  graft Kind (types.ts). Unmapped → "function".
const KIND: Record<string, Kind> = {
  function: "function", method: "method", class: "class", interface: "interface",
  type: "type", struct: "struct", enum: "enum", module: "module",
  constant: "constant", variable: "variable", field: "variable",
  object: "class", property: "variable", // Scala object; Swift/Scala property
};

// Loaded grammars + compiled tags queries, keyed by graft lang name. Populated by
// warmGenericGrammars; read synchronously by extractGeneric.
//
// The Parser is built ONCE per language and kept here. web-tree-sitter's Parser, Tree
// and Query all live in the WASM heap, which V8's GC knows nothing about: a Parser
// constructed per file (and a Tree never `.delete()`d) is leaked for the life of the
// process. On a repo with thousands of breadth-tier files that grows monotonically
// through build.ts's whole parse loop and ends in hundreds of MB or an outright
// `Cannot enlarge memory arrays`. Rebuilding the parser per file was pure waste anyway
// — the grammar it is set to never changes.
interface Loaded { language: unknown; query: unknown | null; parser: TsParser }
const loaded = new Map<string, Loaded>();
let tsMod: typeof import("web-tree-sitter") | null = null;
let initPromise: Promise<void> | null = null;

function requireWasm(wasm: string): Buffer | null {
  // Resolve the grammar wasm from the tree-sitter-wasms bundle.
  try {
    const p = require.resolve(`tree-sitter-wasms/out/tree-sitter-${wasm}.wasm`);
    return readFileSync(p);
  } catch {
    return null;
  }
}

function loadQuery(name: string): string | null {
  for (const dir of QUERY_DIRS) {
    try {
      const raw = readFileSync(join(dir, `${name}.scm`), "utf8");
      // Sanitize editor-specific query predicates the tree-sitter Query compiler rejects.
      return raw.replace(
        /\(#(?:strip!|set!|set-adjacent!|select-adjacent!|make-range!|offset!|gsub!)[^()]*\)/g,
        "",
      );
    } catch {
      /* try next dir */
    }
  }
  return null;
}

/** Warm the WASM grammars for the given graft lang names. Idempotent; must be
 * awaited once before extractGeneric is used in a sync loop. Unknown/unavailable
 * grammars are silently skipped (their files then extract as file-only). */
export async function warmGenericGrammars(langNames: Iterable<string>): Promise<void> {
  const want = new Set(langNames);
  const need = [...want].filter((n) => !loaded.has(n) && GENERIC_LANGS.some((l) => l.name === n));
  if (need.length === 0) return;
  if (!tsMod) {
    tsMod = await import("web-tree-sitter");
    initPromise = initPromise ?? tsMod.Parser.init();
  }
  await initPromise;
  const { Language, Query } = tsMod;
  for (const name of need) {
    const row = GENERIC_LANGS.find((l) => l.name === name)!;
    const bytes = requireWasm(row.wasm);
    if (!bytes) continue;
    try {
      const language = await Language.load(bytes);
      const scm = loadQuery(name);
      let query: unknown | null = null;
      if (scm) {
        try { query = new Query(language, scm); } catch { query = null; }
      }
      const parser = new tsMod.Parser();
      parser.setLanguage(language as never);
      loaded.set(name, { language, query, parser: parser as unknown as TsParser });
    } catch {
      /* grammar failed to instantiate — skip; files extract as file-only */
    }
  }
}

/** True if a grammar has been warmed for this lang (else extractGeneric is file-only). */
export function isWarm(langName: string): boolean {
  return loaded.has(langName);
}

/**
 * Of `langNames`, the breadth languages that have NO usable grammar after a warmup —
 * their files extract to a file node and nothing else.
 *
 * A missing wasm and a grammar that fails to instantiate are both swallowed silently by
 * {@link warmGenericGrammars} (correctly: neither should fail a build), and the caller
 * had no way to notice. So a build over a repo whose `dart` wasm isn't in the bundle
 * announced `[dart]` in its language banner having indexed exactly zero dart symbols —
 * which reads as "graft is broken at querying dart", not "graft has no dart grammar
 * here". Call this after warming and report the gap instead of claiming coverage.
 */
export function unavailableGrammars(langNames: Iterable<string>): string[] {
  return [...new Set(langNames)].filter((n) => !loaded.has(n)).sort();
}

const PARSE_CHUNK = 16384; // <32KB slices — same tree-sitter limit workaround as extract.ts

function fileNode(rel: string, source: string): NodeV1 {
  return {
    id: rel, name: rel.split("/").pop() ?? rel, kind: "file", path: rel,
    span: `L1-L${Math.max(1, source.split("\n").length)}`, signature: null,
    exported: true, origin: "generic", body_hash: contentHash(source),
    chars: Buffer.byteLength(source), summary_state: "pending", summary: null, crux: null,
  };
}

export interface Def { id: string; startIndex: number; endIndex: number }

/** Extract a single generic-tier file. Synchronous; needs the grammar pre-warmed.
 * Uses the grammar's compiled tags.scm when present (symbols + call edges);
 * otherwise falls back to a node-kind tree walker (symbols only) so ANY warmed
 * grammar yields a graph even with no vendored query. */
export function extractGeneric(rel: string, source: string, langName: string): ExtractResult {
  const nodes: NodeV1[] = [fileNode(rel, source)];
  const rawEdges: RawEdge[] = [];
  const lang = headerGrammarFor(rel, source, langName);
  const entry = loaded.get(lang);
  if (!entry || !tsMod) return { nodes, rawEdges };

  let tree: TsTree | null;
  try {
    tree = entry.parser.parse((i: number) => source.slice(i, i + PARSE_CHUNK));
  } catch {
    return { nodes, rawEdges };
  }
  if (!tree) return { nodes, rawEdges };
  try {
    return extractFromTree(tree.rootNode, rel, source, lang, nodes, rawEdges);
  } finally {
    // The one place a Tree can be released: every early return above happens before one
    // exists, and every path below funnels through here. Without it each parsed file
    // leaves its whole syntax tree resident in the WASM heap forever (see `Loaded`).
    tree.delete();
  }
}

/**
 * The grammar a `.h` file should actually be parsed with.
 *
 * The registry maps an extension to exactly one grammar and `.h` is claimed by C — but
 * in a C++ project the headers are precisely where the classes, templates and namespaces
 * live, and c.scm has no `class_specifier` and no `namespace` pattern at all. Those
 * symbols simply did not exist in the graph (while resolve.ts happily treated the same
 * `.h` as a valid `#include` target), and templates additionally produced ERROR nodes.
 *
 * The extension cannot decide this — the same `.h` is C in one repo and C++ in the next
 * — so the content does. The `loaded.has("cpp")` gate is what keeps this safe: the cpp
 * grammar is warmed only when the repo has real C++ sources, so a pure-C project can
 * never be routed away from the C parse it had.
 *
 * Known seam: adding a repo's FIRST `.cpp` file flips this decision for headers whose
 * own bytes did not move, and the extraction memo is keyed on bytes — so those headers
 * keep their C parse until they are edited or the memo turns over. Re-parsing the whole
 * repo on that transition is not worth the machinery; `graft build --no-reuse` settles it.
 */
const CPP_HEADER = /^[ \t]*(?:template\s*<|namespace\s+[\w{]|class\s+\w|public:|private:|protected:|using\s+namespace\b)/m;
function headerGrammarFor(rel: string, source: string, langName: string): string {
  if (langName !== "c" || !rel.toLowerCase().endsWith(".h")) return langName;
  return loaded.has("cpp") && CPP_HEADER.test(source) ? "cpp" : langName;
}

function extractFromTree(
  root: TsNode,
  rel: string,
  source: string,
  langName: string,
  nodes: NodeV1[],
  rawEdges: RawEdge[],
): ExtractResult {
  const entry = loaded.get(langName)!;
  const minted = new Set<string>([rel]);
  const lines = source.split("\n");
  const defs: Def[] = [];
  // One definition per source span: a grammar's tags.scm can capture the same node
  // under two @definition kinds (Swift `func` is method AND function), and the
  // walker can revisit a nested match — both would emit near-duplicate nodes.
  const spanSeen = new Set<number>();
  // Mint one definition node from a whole-definition tree node. Shared by both
  // the tags.scm path and the walker fallback so id/span/signature/body_text are
  // built identically.
  const mkDef = (name: string, kind: Kind, whole: TsNode): void => {
    if (spanSeen.has(whole.startIndex)) return;
    spanSeen.add(whole.startIndex);
    const idBase = `${rel}#${name}`;
    let id = idBase, n = 2;
    while (minted.has(id)) id = `${idBase}~${n++}`;
    minted.add(id);
    const startRow = whole.startPosition.row, endRow = whole.endPosition.row;
    const sigLine = (lines[startRow] ?? "").trim().replace(/\s*\{?\s*$/, "");
    nodes.push({
      id, name, kind, path: rel,
      span: `L${startRow + 1}-L${endRow + 1}`,
      signature: sigLine || null, exported: true, origin: "generic",
      body_hash: contentHash(source.slice(whole.startIndex, whole.endIndex)),
      body_text: source.slice(whole.startIndex, whole.endIndex).replace(/\s+/g, " ").slice(0, 5000),
      summary_state: "pending", summary: null, crux: null,
    });
    defs.push({ id, startIndex: whole.startIndex, endIndex: whole.endIndex });
  };

  if (entry.query) {
    tagsExtract(entry.query, root, rel, mkDef, defs, rawEdges);
  } else {
    walkExtract(root, mkDef); // no tags.scm → symbols only
  }
  // The preprocessor is invisible to tags.scm, but in C/C++ a local `#include "x.h"`
  // IS the dependency graph — capture it as a file→file import. Likewise a Rust
  // `use crate::…` is an in-crate module dependency.
  if (langName === "c" || langName === "cpp") extractIncludes(root, rel, rawEdges);
  else if (langName === "rust") extractUses(root, rel, rawEdges);
  else if (langName === "php") extractPhpUses(root, rel, rawEdges);
  return { nodes, rawEdges };
}

/** PHP `use App\Models\User;` → a file→class-file `imports` raw edge, one per imported
 * name (a `{ … }` group expands to several). `use function`/`use const` are skipped —
 * those name a symbol, not a PSR-4 class file. resolve.ts settles the fully-qualified
 * name to the in-repo file by namespace suffix, and drops it when it can't. */
function extractPhpUses(root: TsNode, rel: string, rawEdges: RawEdge[]): void {
  const visit = (n: TsNode): void => {
    if (n.type === "namespace_use_declaration") {
      for (const fqn of phpUseNames(n.text)) rawEdges.push({ source: rel, relation: "imports", specifier: fqn, file: rel });
    }
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild?.(i);
      if (c) visit(c);
    }
  };
  visit(root);
}

/** The fully-qualified class names a PHP `use` declaration imports. Handles a plain
 * `use A\B\C;`, a comma list `use A\B, C\D;`, a group `use A\B\{C, D};`, and `as` aliases;
 * returns [] for `use function`/`use const` (symbol imports, not class files). */
function phpUseNames(text: string): string[] {
  let s = text.replace(/^\s*use\s+/, "").replace(/;\s*$/, "").trim();
  if (/^(function|const)\b/.test(s)) return [];
  const brace = s.indexOf("{");
  if (brace >= 0) {
    const prefix = s.slice(0, brace).replace(/\\\s*$/, "");
    const inner = s.slice(brace + 1, s.lastIndexOf("}"));
    return inner.split(",").map((m) => m.trim().replace(/\s+as\s+\w+$/i, "").trim()).filter(Boolean)
      .map((m) => `${prefix}\\${m}`);
  }
  return s.split(",").map((c) => c.trim().replace(/\s+as\s+\w+$/i, "").trim()).filter(Boolean);
}

/** Rust `use crate::a::b::Item` → a file→module `imports` raw edge whose specifier is the
 * crate-relative module path (`a/b`). Only in-crate imports are captured; `std::`,
 * `super::`, `self::`, external crates, and globs are skipped — resolve.ts settles the
 * path against the file's crate root, and drops it when it can't. */
function extractUses(root: TsNode, rel: string, rawEdges: RawEdge[]): void {
  const visit = (n: TsNode): void => {
    if (n.type === "use_declaration") {
      const spec = rustUseModule(n.text);
      if (spec !== null) rawEdges.push({ source: rel, relation: "imports", specifier: spec ? `crate/${spec}` : "crate", file: rel });
    }
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild?.(i);
      if (c) visit(c);
    }
  };
  visit(root);
}

/** The crate-relative path a Rust `use crate::…` names (`::`→`/`), or null when it is not
 * an in-crate import. The FULL path is returned — including any trailing item segment —
 * because a single `crate::lexical` can be either a module OR a crate-root item; the
 * resolver settles that by finding the longest prefix that is a real module file. A
 * `{ … }` group has no single item, so its prefix (before `{`) is the path. */
function rustUseModule(text: string): string | null {
  let s = text.replace(/^\s*use\s+/, "").replace(/;\s*$/, "").trim();
  const brace = s.indexOf("{");
  if (brace >= 0) s = s.slice(0, brace).replace(/::\s*$/, "");
  else s = s.replace(/\s+as\s+\w+$/, "");
  s = s.trim();
  if (s !== "crate" && !s.startsWith("crate::")) return null; // only in-crate absolute imports
  if (s.includes("*")) return null; // glob — no single module target
  return s.replace(/^crate::?/, "").replace(/\s+/g, "").replace(/::/g, "/"); // "" = crate root
}

/** C/C++ `#include "header.h"` → a file→file `imports` raw edge. Only LOCAL includes
 * (quoted) are captured; system includes (`<stdio.h>`) are skipped — high volume, and
 * there is no in-repo target to navigate to. resolve.ts settles the quoted path to an
 * in-repo header (relative to the including file, else a unique path-suffix match), and
 * keeps it as an external string when it cannot — never a guessed edge. */
function extractIncludes(root: TsNode, rel: string, rawEdges: RawEdge[]): void {
  const visit = (n: TsNode): void => {
    if (n.type === "preproc_include") {
      const raw = n.childForFieldName?.("path")?.text ?? "";
      if (raw.startsWith('"')) {
        const spec = raw.replace(/^"|"$/g, "").trim();
        if (spec) rawEdges.push({ source: rel, relation: "imports", specifier: spec, file: rel });
      }
    }
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild?.(i);
      if (c) visit(c);
    }
  };
  visit(root);
}

/** tags.scm path: @definition.<kind> → nodes, @reference.call/@reference.send →
 * bare-name call edges attributed to the innermost enclosing definition. */
function tagsExtract(
  query: unknown,
  root: TsNode,
  rel: string,
  mkDef: (name: string, kind: Kind, whole: TsNode) => void,
  defs: Def[],
  rawEdges: RawEdge[],
): void {
  const q = query as { matches(n: unknown): Array<{ captures: Array<{ name: string; node: TsNode }> }> };
  const matches = q.matches(root);
  // Some grammars' tags.scm capture a definition's own NAME token as a
  // @reference.call too (Ruby tags `def foo`'s `foo` as both @name and a call),
  // producing bogus self-loops (foo→foo). Skip any call at a definition's name token.
  const defNameAt = new Set<number>();
  const calls: Array<{ name: string; at: number }> = [];
  const refs: Array<{ name: string; at: number }> = [];
  for (const m of matches) {
    const cap: Record<string, TsNode> = {};
    for (const c of m.captures) cap[c.name] = c.node;
    const defKey = Object.keys(cap).find((k) => k.startsWith("definition."));
    if (defKey && cap.name) {
      defNameAt.add(cap.name.startIndex);
      mkDef(cap.name.text, KIND[defKey.slice("definition.".length)] ?? "function", defScope(cap[defKey]));
    }
    if (("reference.call" in cap || "reference.send" in cap) && cap.name)
      calls.push({ name: cap.name.text, at: cap.name.startIndex });
    // Structural references the grammar already marks: a supertype (extends), an
    // implemented interface, an object creation (`new Foo`), a module alias. Grammars
    // label these @reference.class/.interface/.implementation/.module — heterogeneous
    // syntactically but all "names this symbol without calling it". They become
    // `references` edges the same precision-first resolver settles to a type-like def
    // (same-file certain, unique cross-file inferred, ambiguous dropped), so a data
    // class that's only ever extended or instantiated stops being an orphan.
    if (("reference.class" in cap || "reference.interface" in cap ||
         "reference.implementation" in cap || "reference.module" in cap) && cap.name)
      refs.push({ name: cap.name.text, at: cap.name.startIndex });
  }
  const callEnc = enclosingDefs(defs, calls.map((c) => c.at));
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (defNameAt.has(c.at)) continue;
    const enc = callEnc[i];
    rawEdges.push({ source: enc ? enc.id : rel, relation: "calls", file: rel, name: c.name });
  }
  const refEnc = enclosingDefs(defs, refs.map((r) => r.at));
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    if (defNameAt.has(r.at)) continue;
    const enc = refEnc[i];
    if (!enc) continue; // a reference with no enclosing definition has no sound source
    rawEdges.push({ source: enc.id, relation: "references", file: rel, name: r.name });
  }
}

/**
 * The innermost definition enclosing each of `offsets`, positionally.
 *
 * The obvious per-token `defs.filter(contains).sort(bySize)[0]` is O(D·C) and allocates
 * two arrays PER TOKEN. On a generated file — a 100k-line C# API client, Rust bindings,
 * compiled protobuf — that is ~15k definitions against ~50k call sites: 750M comparisons
 * and 50k throwaway arrays, tens of seconds inside build.ts's synchronous per-file loop,
 * for bookkeeping nobody would believe costs anything.
 *
 * Definition spans come from syntax-tree nodes, so they NEST — no two of them partially
 * overlap. That is what makes a single ordered sweep sufficient: walk the offsets in
 * order, push definitions as their start passes, pop them as their end passes, and the
 * top of the stack is the innermost one still open. O((D+C) log(D+C)) overall.
 *
 * Exported so a test can pin the behaviour and the scale directly, without having to
 * synthesize a 100k-line source file to reach the path.
 */
export function enclosingDefs(defs: Def[], offsets: number[]): Array<Def | undefined> {
  // `.fill` because a bare `new Array(n)` is SPARSE, and a hole is not the same value
  // as `undefined` to anything that inspects the array (deepEqual, JSON, spread).
  const out = new Array<Def | undefined>(offsets.length).fill(undefined);
  if (defs.length === 0) return out;
  // Ties on startIndex: the wider span is the outer one, so it must be pushed first.
  const byStart = [...defs].sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
  const order = offsets.map((_, i) => i).sort((a, b) => offsets[a] - offsets[b]);
  const open: Def[] = [];
  let next = 0;
  for (const i of order) {
    const at = offsets[i];
    while (next < byStart.length && byStart[next].startIndex <= at) open.push(byStart[next++]);
    while (open.length && open[open.length - 1].endIndex <= at) open.pop();
    out[i] = open[open.length - 1];
  }
  return out;
}

// Node-type → Kind for the walker fallback. A node is a definition when its type
// ends with a declaration-ish suffix AND names a construct — matched most-specific
// first (method before function). Covers the common tree-sitter grammar vocab
// without any per-language query.
const DEF_SUFFIX = /(declaration|definition|_item|_specifier|_decl|_def|_binding)$/;
function classifyKind(type: string): Kind | null {
  const t = type.toLowerCase();
  if (!DEF_SUFFIX.test(t) && !/^(class|struct|enum|interface|trait|module|namespace)/.test(t)) return null;
  if (/method|constructor/.test(t)) return "method";
  if (/func|function|def\b|subroutine|procedure/.test(t)) return "function";
  if (/class/.test(t)) return "class";
  if (/struct|record/.test(t)) return "struct";
  if (/interface|trait|protocol/.test(t)) return "interface";
  if (/enum/.test(t)) return "enum";
  if (/module|namespace|package|mod_/.test(t)) return "module";
  if (/const/.test(t)) return "constant";
  if (/typedef|type_alias|type_def|alias/.test(t)) return "type";
  if (/type/.test(t)) return "type";
  if (/(^|_)(val|var|let|field|property)/.test(t)) return "variable";
  return null;
}
/** The declared name of a node: its `name` field, else the first identifier-ish
 * descendant within a couple of levels. */
function nodeName(node: TsNode): string | null {
  const byField = node.childForFieldName?.("name");
  if (byField?.text) return byField.text;
  const stack: Array<{ n: TsNode; d: number }> = [{ n: node, d: 0 }];
  while (stack.length) {
    const { n, d } = stack.shift()!;
    if (d > 0 && /identifier|name/.test(n.type) && n.text && !n.text.includes("\n")) return n.text;
    if (d < 3) for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild?.(i);
      if (c) stack.push({ n: c, d: d + 1 });
    }
  }
  return null;
}
/** Walker fallback: DFS every named node, emit a def for each classified one
 * (symbols only — no call resolution without a query). */
function walkExtract(root: TsNode, mkDef: (name: string, kind: Kind, whole: TsNode) => void): void {
  const visit = (n: TsNode): void => {
    const kind = classifyKind(n.type);
    if (kind) {
      const name = nodeName(n);
      if (name) mkDef(name, kind, n);
    }
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild?.(i);
      if (c) visit(c);
    }
  };
  visit(root);
}

/** The slice of web-tree-sitter's Tree we use. `delete()` is not optional bookkeeping:
 * it is the only way a tree's WASM-heap memory is ever reclaimed. */
interface TsTree {
  rootNode: TsNode;
  delete(): void;
}

interface TsParser {
  parse(input: (index: number) => string): TsTree | null;
}

interface TsNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  parent: TsNode | null;
  namedChildCount?: number;
  namedChild?(i: number): TsNode | null;
  childForFieldName?(field: string): TsNode | null;
}

// Some grammars' tags.scm put @definition.<X> on a narrow node (C tags the
// `function_declarator`, not the whole `function_definition` with its body), so
// the capture's span stops before the body and calls inside it can't be
// attributed to the function. Expand up to the outermost enclosing
// declaration/definition node so a def's span covers its body.
const DEF_CONTAINER = /(definition|declaration|specifier|_item)$/;
function defScope(node: TsNode): TsNode {
  let n = node;
  while (n.parent && DEF_CONTAINER.test(n.parent.type)) n = n.parent;
  return n;
}
