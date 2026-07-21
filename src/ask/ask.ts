/**
 * `graft ask "<task>"` — the ACTIVE channel.
 *
 * One tool that routes a plain-words query to the right graph and returns a lean,
 * ranked context pack (prose + exact `file:line` + related), never raw JSON and
 * never whole files:
 *
 *   - Structural intent ("what calls X", "callers of X", "what does X import")
 *     → walk the wiring graph's edges and return the neighbour symbols with spans.
 *   - Everything else → lexical rank over concept nodes (prose) and wiring symbols
 *     (name + signature + summary), returning the best few with pointers.
 *
 * v1 is deterministic and $0 (term-overlap scoring, no LLM, no embeddings). The
 * output is markdown so it drops straight into an agent's context.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import matter from "gray-matter";
import { contextDirFor } from "../context/node-file.js";
import { loadGraphCached, loadAskIndexCached } from "../graph/load.js";
import type { EdgeV1, GraphV1, NodeV1, Relation } from "../graph/types.js";
import { personalizedPageRank } from "./graphrank.js";
import { counts, tokenize, type AskIndex, type AskIndexDoc } from "./index-file.js";

export interface AskHit {
  kind: "concept" | "symbol" | "caller" | "callee";
  title: string;
  /** A `file` or `file:Lx-Ly` pointer the agent can open directly. */
  pointer: string;
  snippet: string;
  relation?: Relation;
  related?: string[];
  score: number;
  /** The actual source at `pointer`, sliced from disk when `source` is on.
   * This is what makes `ask` substitutive — the agent reads the span here
   * instead of opening the file, so no source read happens on top of the query. */
  code?: string;
}

/** Max source lines to inline per hit — a definition longer than this is
 * truncated with a marker, so one giant function can't blow up the pack. */
const MAX_SPAN_LINES = 80;

export interface AskResult {
  query: string;
  mode: "structural" | "lexical" | "empty";
  /** For structural mode: the symbol whose neighbours we walked. */
  subject?: string;
  hits: AskHit[];
  note?: string;
  /** Token-saving estimate, set only in `--source` (retriever) mode: the whole
   * size of the distinct files these hits point into, i.e. the baseline cost of
   * reading them instead of this pack. Computed from file sizes stored at build. */
  saved?: { files: number; baselineChars: number };
}

/** First real prose line of a node body (skips headings, markers, blanks). */
function firstProse(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--") || line.startsWith("-")) continue;
    return line;
  }
  return "";
}

interface Corpus {
  concepts: Array<{ slug: string; name: string; sources: string[]; related: string[]; snippet: string; text: string }>;
  graph: GraphV1 | null;
  /** Build-time token/df sidecar (`.cache/ask-index.json`), or null when absent,
   * unparseable, an unknown version, or stale (checked against `graph.nodes.length`
   * by the caller — see `lexical()`). Null means: fall back to live tokenization. */
  askIndex: AskIndex | null;
}

function loadCorpus(outDir: string): Corpus {
  const concepts: Corpus["concepts"] = [];
  if (existsSync(outDir)) {
    for (const entry of readdirSync(outDir)) {
      if (!entry.endsWith(".md") || entry === "INDEX.md") continue;
      const parsed = matter(readFileSync(join(outDir, entry), "utf8"));
      const fm = parsed.data as Record<string, unknown>;
      const sources = Array.isArray(fm.sources)
        ? (fm.sources as Array<{ path: string }>).map((s) => s.path)
        : [];
      const related = Array.isArray(fm.links)
        ? (fm.links as Array<{ to: string }>).map((l) => l.to)
        : [];
      const snippet = firstProse(parsed.content);
      concepts.push({
        slug: String(fm.slug ?? entry.replace(/\.md$/, "")),
        name: String(fm.name ?? ""),
        sources,
        related,
        snippet,
        text: `${fm.name ?? ""} ${snippet} ${sources.join(" ")}`,
      });
    }
  }
  return { concepts, graph: loadGraphCached(outDir), askIndex: loadAskIndexCached(outDir) };
}

/** Score a document's token counts against the query counts (name field
 * pre-weighted by caller). Each shared term is weighted by its inverse document
 * frequency (`idf`), so a word that appears in many nodes — "overlay" across a
 * whole widget subsystem, or a repeated word in a pasted issue body — counts for
 * far less than a rare, discriminating identifier ("scrolling"). Without idf,
 * pure term-frequency lets an incidental common word dominate the ranking; this
 * is the lexical half of the keyword-collision fix (graph-rank is the other). */
function score(
  query: Map<string, number>,
  doc: Map<string, number>,
  idf: Map<string, number>,
): number {
  let s = 0;
  for (const [t, qn] of query) {
    const dn = doc.get(t);
    if (dn) s += qn * dn * (idf.get(t) ?? 1);
  }
  return s;
}

/** Inverse document frequency over the scored corpus. `df` counts how many
 * documents (concept nodes + symbol nodes) contain each token; N is the corpus
 * size. `log(1 + N/(1+df))` is the smoothed standard form: monotonically
 * decreasing in df, always positive, ~0 extra weight for a token in every doc. */
function idfFromDf(df: Map<string, number>, n: number): Map<string, number> {
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + n / (1 + d)));
  return idf;
}

function computeIdf(docBags: Array<Set<string>>): Map<string, number> {
  const df = new Map<string, number>();
  for (const bag of docBags)
    for (const t of bag) df.set(t, (df.get(t) ?? 0) + 1);
  return idfFromDf(df, docBags.length);
}

/** Same idf as {@link computeIdf}, but the symbol half of `df` and the doc
 * count come from the build-time sidecar instead of tokenizing the corpus
 * live; only the concept bags (always tokenized live — there are only dozens)
 * are folded in here, the same way `computeIdf` would fold them into the full
 * docBags array. `df` is a commutative sum and `n` is the same total document
 * count either way, so this produces byte-identical idf values to `computeIdf`
 * run over concept-bags + live-tokenized-symbol-bags. */
function computeIdfFromIndex(index: AskIndex, conceptBags: Array<Set<string>>): Map<string, number> {
  const df = new Map(index.df);
  for (const bag of conceptBags)
    for (const t of bag) df.set(t, (df.get(t) ?? 0) + 1);
  return idfFromDf(df, index.docCount + conceptBags.length);
}

/** BM25 term score for a document field, used for the (potentially large) body
 * field. Unlike raw term-frequency, BM25 saturates repeated occurrences (`k1`)
 * and normalizes by document length (`b`, against the corpus-average length
 * `avgdl`), so a big definition — a sprawling test class — can't outrank a
 * tight, on-point function merely by containing more words. Standard params. */
function bm25(
  query: Map<string, number>,
  doc: Map<string, number>,
  idf: Map<string, number>,
  dl: number,
  avgdl: number,
): number {
  const k1 = 1.2;
  const b = 0.75;
  const norm = k1 * (1 - b + (b * dl) / (avgdl || 1));
  let s = 0;
  for (const t of query.keys()) {
    const tf = doc.get(t);
    if (tf) s += (idf.get(t) ?? 1) * ((tf * (k1 + 1)) / (tf + norm));
  }
  return s;
}

// ── Structural intent ──────────────────────────────────────────────────────

const INCOMING = /\b(caller|callers|calls?\s+into|who\s+calls|what\s+calls|called\s+by|used\s+by|uses)\b/;
const OUTGOING = /\b(callee|callees|what\s+does\s+\w+\s+call|calls\s+what|imports?|depends\s+on)\b/;
const INCOMING_RELS: Relation[] = ["calls", "references", "implements", "extends"];
const OUTGOING_RELS: Relation[] = ["calls", "references", "imports", "implements", "extends"];

/** Pick the query word that names a real symbol (longest exact name match wins). */
function findSubject(query: string, graph: GraphV1): NodeV1[] {
  const byName = new Map<string, NodeV1[]>();
  for (const n of graph.nodes) {
    if (n.kind === "file") continue;
    const key = n.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), n]);
  }
  const words = query.split(/[^A-Za-z0-9_.]+/).filter(Boolean);
  let best: NodeV1[] = [];
  let bestLen = 0;
  for (const w of words) {
    const hit = byName.get(w.toLowerCase());
    if (hit && w.length > bestLen) {
      best = hit;
      bestLen = w.length;
    }
  }
  return best;
}

function structural(query: string, graph: GraphV1, limit: number): AskResult | null {
  const wantsIn = INCOMING.test(query);
  const wantsOut = OUTGOING.test(query);
  if (!wantsIn && !wantsOut) return null;

  const subjects = findSubject(query, graph);
  if (subjects.length === 0) return null;

  const ids = new Set(subjects.map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = wantsOut && !wantsIn; // "what does X call / import" — else default to callers
  const rels = new Set(outgoing ? OUTGOING_RELS : INCOMING_RELS);

  const hits: AskHit[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges as EdgeV1[]) {
    if (!rels.has(e.relation)) continue;
    const anchor = outgoing ? e.source : e.target;
    const other = outgoing ? e.target : e.source;
    if (!ids.has(anchor) || seen.has(other + e.relation)) continue;
    seen.add(other + e.relation);
    const node = byId.get(other);
    hits.push({
      kind: outgoing ? "callee" : "caller",
      title: node ? node.name : other, // unresolved import target → raw module string
      pointer: node ? `${node.path}:${node.span}` : other,
      snippet: node?.summary?.split("\n")[0].trim() ?? node?.signature ?? "",
      relation: e.relation,
      score: 1,
    });
  }
  hits.sort((a, b) => a.pointer.localeCompare(b.pointer));
  return {
    query,
    mode: "structural",
    subject: subjects[0].name,
    hits: hits.slice(0, limit),
    note: outgoing
      ? `outgoing edges from ${subjects[0].name}`
      : `callers / references of ${subjects[0].name}`,
  };
}

// ── Lexical rank ─────────────────────────────────────────────────────────────

/** How much a node's graph-centrality (0..1) can lift its blended score. A
 * lexically-perfect node scores 1.0 on the lexical axis; a graph weight of 0.5
 * lets connectivity reorder near-ties and separate a connected hit from an
 * isolated same-word collision, without letting structure override a clear
 * lexical winner. */
const GRAPH_WEIGHT = 0.5;

/** A node the query never word-matched is pulled into the results only if the
 * walk gives it at least this share of the top node's mass — i.e. it is
 * genuinely central to the matched cluster, not incidentally reachable. This is
 * what surfaces the config/helper a task depends on but didn't name. */
const RESCUE_FLOOR = 0.15;

function lexical(query: string, corpus: Corpus, limit: number, graphRank: boolean): AskResult {
  // Binary query terms: a word repeated in a pasted issue body counts once, so a
  // ranty description can't linearly amplify an incidental word.
  const q = new Map([...counts(tokenize(query)).keys()].map((t) => [t, 1]));
  const graph = corpus.graph;

  // ── Pass 1: tokenize every scored field once, and collect per-document token
  // bags so IDF can down-weight words that occur across the whole corpus. ──
  const conceptDocs = corpus.concepts.map((c) => ({
    c,
    name: counts(tokenize(c.name)),
    body: counts(tokenize(c.text)),
  }));

  // A build-time sidecar (`.cache/ask-index.json`) is usable only when it covers
  // every node in the current graph: `docs.length === graph.nodes.length` is a
  // cheap staleness guard (an id-level check below catches a same-count but
  // mismatched set, e.g. a hand-edited or corrupt sidecar). Anything short of
  // that — missing, unparseable, unknown version, wrong count, mismatched ids —
  // falls back to live tokenization so results never depend on the sidecar
  // existing; see `readAskIndex`'s own null-on-anything-off contract.
  let docById: Map<string, AskIndexDoc> | null = null;
  if (corpus.askIndex && graph && corpus.askIndex.docs.length === graph.nodes.length) {
    const map = new Map(corpus.askIndex.docs.map((d) => [d.id, d]));
    if (graph.nodes.every((n) => map.has(n.id))) docById = map;
  }
  const askIndex = docById ? corpus.askIndex : null;

  // Symbols AND file nodes are scored: a symbol's body_text is its definition;
  // a file's body_text is the module-level residual (imports/constants not in
  // any symbol). Including files closes the recall gap where a gold file's only
  // query-relevant text lives outside every function/class.
  const symbolDocs = (graph?.nodes ?? []).map((n) => {
    const d = docById?.get(n.id);
    if (d) return { n, name: new Map(d.name), path: new Map(d.path), body: new Map(d.body) };
    return {
      n,
      name: counts(tokenize(n.name)),
      path: counts(tokenize(n.path)),
      // The body (indexed at build) joins the signature + summary as the low-weight
      // body field, so a term that appears only in the code — not the name/signature
      // — still makes the node findable. IDF (from these same bags) keeps a word
      // common across many bodies from dominating. `body_text` is absent on every
      // node loaded from a wiring.json written after the slim-serialization change
      // (it's stripped there — see `write.ts`) as well as on file nodes and
      // pre-body_text graphs; `?? ""` degrades gracefully to signature+summary
      // only, it never crashes on the missing field.
      body: counts(tokenize(`${n.signature ?? ""} ${n.summary ?? ""} ${n.body_text ?? ""}`)),
    };
  });

  const conceptBags = conceptDocs.map((d) => new Set([...d.name.keys(), ...d.body.keys()]));
  // IDF must see the SAME inputs either way: with a sidecar, its `df` (stored
  // WITHOUT concepts) plus these live concept bags reproduces exactly what
  // `computeIdf` below would compute from concept+symbol bags tokenized live.
  const idf = askIndex
    ? computeIdfFromIndex(askIndex, conceptBags)
    : computeIdf([...conceptBags, ...symbolDocs.map((d) => new Set([...d.name.keys(), ...d.path.keys(), ...d.body.keys()]))]);

  // ── Concepts (prose nodes; not in the wiring graph) ──
  const conceptHits: AskHit[] = [];
  let maxConcept = 0;
  for (const { c, name, body } of conceptDocs) {
    const total = score(q, name, idf) * 3 + score(q, body, idf);
    if (total > 0) {
      maxConcept = Math.max(maxConcept, total);
      conceptHits.push({
        kind: "concept",
        title: c.name || c.slug,
        pointer: c.sources.join(", ") || c.slug,
        snippet: c.snippet,
        related: c.related,
        score: total,
      });
    }
  }

  // ── Symbols (wiring graph): lexical score per node, keyed by id ──
  const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const bodyLen = (m: Map<string, number>) => {
    let s = 0;
    for (const v of m.values()) s += v;
    return s;
  };
  const avgBodyLen = askIndex
    ? askIndex.avgBodyLen
    : symbolDocs.length
      ? symbolDocs.reduce((a, d) => a + bodyLen(d.body), 0) / symbolDocs.length
      : 0;
  const lex = new Map<string, number>(); // node id → lexical score (>0 only)
  let maxLex = 0;
  for (const { n, name, path, body } of symbolDocs) {
    // Name and path are short identifiers → plain idf-weighted overlap; the body
    // is length-normalized via BM25 so long definitions don't win on bulk.
    const total =
      score(q, name, idf) * 3 +
      score(q, path, idf) * 2 +
      bm25(q, body, idf, bodyLen(body), avgBodyLen);
    if (total > 0) {
      lex.set(n.id, total);
      maxLex = Math.max(maxLex, total);
    }
  }

  // ── Graph-rank: let connectivity to the matched set reorder and rescue ──
  const pr = graphRank && graph && lex.size > 0
    ? personalizedPageRank(graph, lex)
    : new Map<string, number>();

  // Candidate symbols = everything the query word-matched, plus nodes the walk
  // found strongly central even without a word match (RESCUE_FLOOR).
  const candidates = new Set<string>(lex.keys());
  for (const [id, p] of pr) if (p >= RESCUE_FLOOR) candidates.add(id);

  const symbolHits: AskHit[] = [];
  for (const id of candidates) {
    const n = byId.get(id);
    if (!n) continue;
    const lexN = maxLex > 0 ? (lex.get(id) ?? 0) / maxLex : 0;
    const blended = lexN + GRAPH_WEIGHT * (pr.get(id) ?? 0);
    if (blended <= 0) continue;
    symbolHits.push({
      kind: "symbol",
      title: `${n.name} · ${n.kind}`,
      // A file node points at the whole file (locator, no span) so `--source`
      // never inlines an entire file; symbol nodes keep their exact span.
      pointer: n.kind === "file" ? n.path : `${n.path}:${n.span}`,
      snippet: n.summary?.split("\n")[0].trim() ?? n.signature ?? "",
      score: blended,
    });
  }

  // Concepts and symbols live on comparable 0..~1.5 scales so they merge fairly:
  // concept scores are normalized to their own max, symbol scores are the
  // lexical-normalized + graph-weighted blend.
  for (const h of conceptHits) h.score = maxConcept > 0 ? h.score / maxConcept : 0;

  const scored = [...conceptHits, ...symbolHits];
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return {
    query,
    mode: scored.length ? "lexical" : "empty",
    hits: scored.slice(0, limit),
    note: scored.length ? undefined : "no matching nodes — try different words, or `graft build` if graft/ is empty",
  };
}

export interface AskOptions {
  contextDir?: string;
  limit?: number;
  /** Inline the source at each `path:Lx-Ly` hit, sliced from `dir`. Turns the
   * pack from a locator into a retriever so the agent needn't re-open the file. */
  source?: boolean;
  /** Re-rank lexical hits by graph connectivity (personalized PageRank over the
   * wiring edges), demoting same-word collisions and rescuing strongly-connected
   * neighbours the query didn't name. On by default; set false for pure lexical. */
  graphRank?: boolean;
}

/** Parse a `path:Lx-Ly` pointer into its parts, or null if it isn't one
 * (concept multi-path lists and raw import strings return null). */
function parseSpan(pointer: string): { path: string; from: number; to: number } | null {
  const m = pointer.match(/^(.*):L(\d+)-L(\d+)$/);
  if (!m) return null;
  return { path: m[1], from: Number(m[2]), to: Number(m[3]) };
}

/** Read the source lines [from, to] (1-indexed, inclusive) of `path` under `root`,
 * capped at {@link MAX_SPAN_LINES}. Returns null if the file can't be read. */
function sliceSpan(root: string, path: string, from: number, to: number): string | null {
  try {
    const lines = readFileSync(join(root, path), "utf8").split("\n");
    const start = Math.max(1, from);
    const end = Math.min(lines.length, to);
    const slice = lines.slice(start - 1, end);
    if (slice.length > MAX_SPAN_LINES) {
      const head = slice.slice(0, MAX_SPAN_LINES);
      head.push(`… (+${slice.length - MAX_SPAN_LINES} more lines; open ${path}:L${start}-L${end})`);
      return head.join("\n");
    }
    return slice.join("\n");
  } catch {
    return null;
  }
}

/** Attach inlined source to every hit whose pointer is a real `path:span`. */
function inlineSource(root: string, hits: AskHit[]): void {
  for (const h of hits) {
    const s = parseSpan(h.pointer);
    if (!s) continue;
    const code = sliceSpan(root, s.path, s.from, s.to);
    if (code) h.code = code;
  }
}

/** Every repo-relative file path a set of hits points into (dedup). A symbol
 * pointer is `path:span`; a concept pointer is a comma-joined path list. */
function hitFiles(hits: AskHit[]): Set<string> {
  const files = new Set<string>();
  for (const h of hits) {
    const span = parseSpan(h.pointer);
    if (span) { files.add(span.path); continue; }
    for (const p of h.pointer.split(",").map((s) => s.trim()))
      if (p && !p.includes(" ")) files.add(p);
  }
  return files;
}

/** Baseline = whole size of the files these hits cover, read from the sizes the
 * build stored on each file node. Zero when the graph predates the `chars` field
 * (a pre-upgrade index) — the caller then just omits the estimate. */
function baselineFor(hits: AskHit[], graph: GraphV1 | null): AskResult["saved"] | undefined {
  if (!graph) return undefined;
  const size = new Map<string, number>();
  for (const n of graph.nodes)
    if (n.kind === "file" && typeof n.chars === "number") size.set(n.path, n.chars);

  let baselineChars = 0;
  let files = 0;
  for (const path of hitFiles(hits)) {
    const c = size.get(path);
    if (c === undefined) continue;
    baselineChars += c;
    files++;
  }
  return files > 0 ? { files, baselineChars } : undefined;
}

/** Answer a query from the graft/ graph at `dir`. Deterministic, $0. */
export function ask(dir: string, query: string, opts: AskOptions = {}): AskResult {
  const root = resolve(dir);
  const outDir = contextDirFor(root, opts.contextDir);
  const limit = opts.limit ?? 8;
  const corpus = loadCorpus(outDir);
  const graphRank = opts.graphRank ?? true;

  let result: AskResult;
  if (corpus.graph) {
    const s = structural(query, corpus.graph, limit);
    result = s ?? lexical(query, corpus, limit, graphRank);
  } else {
    result = lexical(query, corpus, limit, graphRank);
  }
  if (opts.source) {
    inlineSource(root, result.hits);
    // The pack is truly substitutive only in retriever mode (spans inlined), so
    // the "vs reading whole files" estimate is only honest here.
    result.saved = baselineFor(result.hits, corpus.graph);
  }
  return result;
}

/** Rough tokens for a byte length (≈ 4 chars/token; good enough for an estimate). */
function toTokens(chars: number): number {
  return Math.round(chars / 4);
}

/** Render an {@link AskResult} as a compact markdown context pack. */
export function formatAsk(r: AskResult): string {
  const head = `graft ask — "${r.query}"  (${r.mode}${r.note ? `: ${r.note}` : ""})`;
  if (r.hits.length === 0) {
    return `${head}\n\n${r.note ?? "no matches."}`;
  }
  const lines = [head, ""];
  if (r.mode === "structural") {
    for (const h of r.hits) {
      const tail = h.snippet ? ` — ${h.snippet}` : "";
      lines.push(`- ${h.title}  ${h.pointer}  (${h.relation})${tail}`);
      if (h.code) lines.push("", "```", h.code, "```", "");
    }
  } else {
    r.hits.forEach((h, i) => {
      lines.push(`${i + 1}. ${h.title}  [${h.kind}]`);
      lines.push(`   ${h.pointer}`);
      if (h.snippet) lines.push(`   ${h.snippet}`);
      if (h.related?.length) lines.push(`   related: ${h.related.join(", ")}`);
      if (h.code) lines.push("", "```", h.code, "```");
      lines.push("");
    });
  }
  const body = lines.join("\n").trimEnd();
  return body + savingsFooter(r, body) + "\n";
}

/** The one-line token-saving estimate `ask` appends in retriever mode, so the
 * agent gets the number for free in the tool output — no extra work on its end.
 * `packChars` is measured from the rendered body: exactly what the agent reads. */
function savingsFooter(r: AskResult, body: string): string {
  if (!r.saved || r.saved.baselineChars <= 0) return "";
  const pack = toTokens(body.length);
  const base = toTokens(r.saved.baselineChars);
  if (base <= pack) return ""; // no saving to claim (tiny files); stay quiet
  const saved = base - pack;
  const pct = Math.round((saved / base) * 100);
  return (
    `\n\n[graft] tokens saved ≈ ${saved.toLocaleString()} (${pct}%) — this pack ≈ ` +
    `${pack.toLocaleString()} tok vs reading the ${r.saved.files} source file(s) whole ≈ ` +
    `${base.toLocaleString()} tok. Estimate (baseline = those files read in full).`
  );
}
