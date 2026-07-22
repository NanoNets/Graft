/**
 * Tier-1 extraction: source file → {@link NodeV1}[] + raw edges, via tree-sitter.
 *
 * Deterministic and dependency-only (no LLM, no network). Emits one node per
 * definition (file, class, function, method, interface, type, enum, and TS
 * arrow-function consts) plus unresolved edge intents. Edge *targets* are
 * resolved against the whole-repo node index later, in build.ts.
 */
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import { basename } from "node:path";
import { contentHash } from "../util/id.js";
import { collectBindings, goReceiverVarOf, resolveRecvType, type FileBindings } from "./bindings.js";
import type { Kind, NodeV1, Relation } from "./types.js";

export type Language = "typescript" | "tsx" | "python" | "go";

/** Map a file path to a supported language, or null if unsupported. */
export function languageOf(path: string): Language | null {
  const p = path.toLowerCase();
  if (p.endsWith(".tsx") || p.endsWith(".jsx")) return "tsx";
  if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(p)) return "typescript";
  if (p.endsWith(".py") || p.endsWith(".pyi")) return "python";
  if (p.endsWith(".go")) return "go";
  return null;
}

/**
 * An edge whose target isn't resolved yet. build.ts turns these into EdgeV1 by
 * matching `name`/`specifier` against the repo-wide node index.
 */
export interface RawEdge {
  source: string; // resolved node id
  relation: Relation;
  file: string; // the file this edge originates in (scopes name resolution)
  targetId?: string; // already-resolved target (contains)
  specifier?: string; // module path to resolve (imports)
  name?: string; // symbol name to resolve (extends/implements/calls)
  viaMember?: boolean; // calls: was it `obj.foo()` (→ prefer method targets)?
  /** calls with viaMember: the receiver's resolved type name (from bindings /
   * self / this / Go receiver), when a confident local clue exists. */
  recvType?: string;
}

export interface ExtractResult {
  nodes: NodeV1[];
  rawEdges: RawEdge[];
}

/** Max chars of normalized body stored per symbol for search. Large enough that
 * essentially every real definition is stored whole — only a rare giant function
 * is clipped — while bounding how much the committed graph can grow. */
const MAX_BODY_CHARS = 5000;

/** Cap for a file node's module-level residual (imports, constants, module
 * docstring — everything not inside a symbol). Higher than the per-symbol cap
 * because a data-heavy module (constant tables, big config dicts) is legitimate
 * residual, and it's the recall play — but still bounded. */
const MAX_FILE_BODY_CHARS = 16000;

/** The searchable body of a definition: its source text, whitespace-collapsed
 * so every identifier becomes a token, capped at `max`. Search-only — the agent
 * still reads verbatim source via `ask --source`, which slices the file from
 * disk, so nothing here reaches the agent's context. */
function searchBody(text: string, max = MAX_BODY_CHARS): string {
  const norm = text.replace(/\s+/g, " ").trim();
  return norm.length > max ? norm.slice(0, max) : norm;
}

/** A file's module-level residual: the lines NOT covered by any symbol span.
 * Symbol bodies are already indexed on their own nodes, so this captures only
 * what they miss — top-of-file imports, module constants, module docstrings —
 * making a file findable by a term that lives outside every function/class.
 * `symbols` are the file's emitted nodes (with `Lx-Ly` spans); `source` is the
 * whole file. Far leaner than storing full-file bodies (no symbol duplication). */
function fileResidual(source: string, symbols: NodeV1[]): string {
  const lines = source.split("\n");
  const covered = new Uint8Array(lines.length + 2);
  for (const s of symbols) {
    const m = s.span.match(/^L(\d+)-L(\d+)$/);
    if (!m) continue;
    for (let r = Number(m[1]); r <= Number(m[2]) && r < covered.length; r++) covered[r] = 1;
  }
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) if (!covered[i + 1]) kept.push(lines[i]);
  return searchBody(kept.join(" "), MAX_FILE_BODY_CHARS);
}

const TS_KINDS: Record<string, Kind> = {
  class_declaration: "class",
  abstract_class_declaration: "class",
  function_declaration: "function",
  generator_function_declaration: "function",
  method_definition: "method",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};

const PY_KINDS: Record<string, Kind> = {
  class_definition: "class",
  function_definition: "function", // → "method" inside a class (resolved in the walk)
};

// Go: `type_spec` is intentionally absent — its kind (struct/interface/type) depends on
// the named type's shape, so it's resolved dynamically in describe().
const GO_KINDS: Record<string, Kind> = {
  function_declaration: "function",
  method_declaration: "method",
};

const KINDS_BY_LANG: Record<Language, Record<string, Kind>> = {
  typescript: TS_KINDS,
  tsx: TS_KINDS,
  python: PY_KINDS,
  go: GO_KINDS,
};

const FUNCTION_VALUE_TYPES = new Set([
  "arrow_function",
  "function",
  "function_expression",
  "generator_function",
]);

const parser = new Parser();
const GRAMMARS: Record<Language, unknown> = {
  typescript: TypeScript.typescript,
  tsx: TypeScript.tsx,
  python: Python,
  go: Go,
};

export interface WalkCtx {
  rel: string;
  source: string;
  lang: Language;
  kinds: Record<string, Kind>;
  scope: string[]; // enclosing definition names, for id scoping
  enclosingKind: Kind | null; // kind of the nearest enclosing definition
  parentId: string; // nearest enclosing definition id, or the file id
  bindings: FileBindings; // variable/field -> type, for receiver-type lookups
  enclosingClass: string | null; // nearest enclosing class (py/ts `self`/`this`)
  goReceiverVar: string | null; // Go receiver var, e.g. `w` in `func (w *Worker)`
}

/** A definition we're about to emit, normalized across the shapes we handle. */
interface DefDescriptor {
  name: string; // the bare symbol name (used for the node's `name` and call resolution)
  idName?: string; // id-scope segment when it differs from `name` (Go: `Receiver.method`)
  kind: Kind;
  headerEnd: number; // char index where the signature ends (body starts)
  hashNode: Parser.SyntaxNode; // node whose text forms body_hash / span
}

/** tree-sitter's string `parse()` fails with "Invalid argument" on any input
 * ≥ 32 KB, which silently drops large files — often the most important ones (a
 * 2000-line command module, a core tab implementation). The callback form has
 * no such limit as long as each returned chunk is under 32 KB, so we always feed
 * the source in <32 KB slices. Code-unit indexing matches `String.slice`. */
const PARSE_CHUNK = 16384;
function parseSource(source: string): Parser.SyntaxNode {
  return parser.parse((index: number) => source.slice(index, index + PARSE_CHUNK)).rootNode;
}

export function extractFile(rel: string, source: string, lang: Language): ExtractResult {
  parser.setLanguage(GRAMMARS[lang] as never);
  const root = parseSource(source);
  const bindings = collectBindings(root, lang);

  const nodes: NodeV1[] = [
    {
      id: rel,
      name: basename(rel),
      kind: "file",
      path: rel,
      span: `L1-L${root.endPosition.row + 1}`,
      signature: null,
      exported: true,
      origin: "ast",
      body_hash: contentHash(source),
      chars: source.length,
      summary_state: "pending",
      summary: null,
      crux: null,
    },
  ];
  const rawEdges: RawEdge[] = [];

  const ctx: WalkCtx = {
    rel,
    source,
    lang,
    kinds: KINDS_BY_LANG[lang],
    scope: [],
    enclosingKind: null,
    parentId: rel,
    bindings,
    enclosingClass: null,
    goReceiverVar: null,
  };
  for (const child of root.namedChildren) walk(child, ctx, nodes, rawEdges);
  // nodes[0] is the file node; the rest are its symbols. Index the module-level
  // residual on the file node so a term outside every symbol still surfaces it.
  nodes[0].body_text = fileResidual(source, nodes.slice(1));
  return { nodes, rawEdges };
}

function walk(node: Parser.SyntaxNode, ctx: WalkCtx, out: NodeV1[], edges: RawEdge[]): void {
  const desc = describe(node, ctx);
  if (desc) {
    // `idName` scopes the id (e.g. a Go method under its receiver: `#DB.Count`) while
    // `name` stays the bare symbol name so member-call resolution matches it.
    const idPart = desc.idName ?? desc.name;
    const id = `${ctx.rel}#${[...ctx.scope, idPart].join(".")}`;
    out.push({
      id,
      name: desc.name,
      kind: desc.kind,
      path: ctx.rel,
      span: `L${desc.hashNode.startPosition.row + 1}-L${desc.hashNode.endPosition.row + 1}`,
      signature: clean(ctx.source.slice(desc.hashNode.startIndex, desc.headerEnd)),
      exported:
        ctx.lang === "python"
          ? !desc.name.startsWith("_")
          : ctx.lang === "go"
            ? goExported(desc.name)
            : tsExported(node),
      origin: "ast",
      body_hash: contentHash(desc.hashNode.text),
      body_text: searchBody(desc.hashNode.text),
      summary_state: "pending",
      summary: null,
      crux: null,
    });
    // structural containment
    edges.push({ source: ctx.parentId, relation: "contains", targetId: id, file: ctx.rel });
    // class heritage
    if (desc.kind === "class") edges.push(...heritageEdges(node, id, ctx));

    const isGoMethod = ctx.lang === "go" && node.type === "method_declaration";
    const enclosingClass = desc.kind === "class" ? desc.name : isGoMethod ? goReceiverType(node) : ctx.enclosingClass;
    const childCtx: WalkCtx = {
      ...ctx,
      scope: [...ctx.scope, idPart],
      enclosingKind: desc.kind,
      parentId: id,
      enclosingClass,
      goReceiverVar: isGoMethod ? goReceiverVarOf(node) : ctx.goReceiverVar,
    };
    for (const child of node.namedChildren) walk(child, childCtx, out, edges);
    return;
  }

  // not a definition — capture calls/imports, then descend with the same context
  const callType = ctx.lang === "python" ? "call" : "call_expression";
  if (node.type === callType) {
    const callee = calleeName(node, ctx.lang);
    if (callee) {
      const callEdge: RawEdge = {
        source: ctx.parentId,
        relation: "calls",
        name: callee.name,
        viaMember: callee.viaMember,
        file: ctx.rel,
      };
      const recvType = resolveRecvType(callee.receiver, ctx);
      edges.push(recvType ? { ...callEdge, recvType } : callEdge);
    }
  } else if (isImport(node, ctx.lang)) {
    const spec = importSpecifier(node, ctx.lang);
    if (spec) edges.push({ source: ctx.rel, relation: "imports", specifier: spec, file: ctx.rel });
  }

  for (const child of node.namedChildren) walk(child, ctx, out, edges);
}

/** Recognize the definition shapes: mapped node types, Go's type/method forms, and
 * TS arrow-consts. */
function describe(node: Parser.SyntaxNode, ctx: WalkCtx): DefDescriptor | null {
  if (ctx.lang === "go") return describeGo(node, ctx);

  const mapped = ctx.kinds[node.type];
  if (mapped) {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    let kind = mapped;
    if (ctx.lang === "python" && mapped === "function" && ctx.enclosingKind === "class") {
      kind = "method";
    }
    const body = node.childForFieldName("body");
    return { name, kind, headerEnd: body ? body.startIndex : node.endIndex, hashNode: node };
  }

  // TS: `const foo = (…) => …` / `const foo = function () {}`
  if ((ctx.lang === "typescript" || ctx.lang === "tsx") && node.type === "variable_declarator") {
    const value = node.childForFieldName("value");
    if (value && FUNCTION_VALUE_TYPES.has(value.type)) {
      const name = node.childForFieldName("name")?.text;
      if (!name) return null;
      const vbody = value.childForFieldName("body");
      return {
        name,
        kind: "function",
        headerEnd: vbody ? vbody.startIndex : node.endIndex,
        hashNode: node,
      };
    }
  }
  return null;
}

/** Go definition shapes: top-level funcs, receiver methods, and named types
 * (struct / interface / type alias). Methods carry no nesting — they're qualified
 * by their receiver type (`User.Save`) so calls can resolve and cards read clearly. */
function describeGo(node: Parser.SyntaxNode, _ctx: WalkCtx): DefDescriptor | null {
  if (node.type === "function_declaration") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    const body = node.childForFieldName("body");
    return { name, kind: "function", headerEnd: body ? body.startIndex : node.endIndex, hashNode: node };
  }

  if (node.type === "method_declaration") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    const recv = goReceiverType(node);
    const body = node.childForFieldName("body");
    // Bare `name` (so `recv.Method()` calls resolve); receiver-qualified `idName`
    // (so the id is `file.go#Receiver.Method` and stays unique per receiver).
    return {
      name,
      idName: recv ? `${recv}.${name}` : name,
      kind: "method",
      headerEnd: body ? body.startIndex : node.endIndex,
      hashNode: node,
    };
  }

  // `type Name <shape>` — one type_spec per name (grouped `type ( … )` yields several).
  if (node.type === "type_spec") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    const type = node.childForFieldName("type");
    const kind: Kind =
      type?.type === "struct_type" ? "struct" : type?.type === "interface_type" ? "interface" : "type";
    // Header ends where the body opens (`{`) for struct/interface, else the whole node
    // (a one-line alias like `type ID int`).
    const headerEnd = type && (kind === "struct" || kind === "interface") ? type.startIndex : node.endIndex;
    return { name, kind, headerEnd, hashNode: node };
  }

  return null;
}

/** The receiver's base type name for a Go method, unwrapping a pointer receiver
 * (`func (u *User) …` → `User`). Null if it can't be read. */
function goReceiverType(node: Parser.SyntaxNode): string | null {
  const recv = node.childForFieldName("receiver"); // parameter_list
  const param = recv?.namedChildren.find((c) => c.type === "parameter_declaration");
  let type = param?.childForFieldName("type");
  if (type?.type === "pointer_type") type = type.namedChildren.at(-1) ?? null;
  return type?.type === "type_identifier" ? type.text : null;
}

/** Go visibility: a symbol is exported iff its own name starts with an uppercase
 * letter. For a receiver-qualified method name, the own name is the part after the dot. */
function goExported(name: string): boolean {
  const own = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  const first = own[0] ?? "";
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

function heritageEdges(node: Parser.SyntaxNode, classId: string, ctx: WalkCtx): RawEdge[] {
  const edges: RawEdge[] = [];
  if (ctx.lang === "python") {
    const supers = node.childForFieldName("superclasses"); // argument_list
    for (const c of supers?.namedChildren ?? []) {
      if (c.type === "identifier") {
        edges.push({ source: classId, relation: "extends", name: c.text, file: ctx.rel });
      }
    }
    return edges;
  }
  const heritage = node.namedChildren.find((c) => c.type === "class_heritage");
  for (const clause of heritage?.namedChildren ?? []) {
    const relation: Relation | null =
      clause.type === "implements_clause"
        ? "implements"
        : clause.type === "extends_clause"
          ? "extends"
          : null;
    if (!relation) continue;
    for (const t of clause.namedChildren) {
      if (t.type === "identifier" || t.type === "type_identifier") {
        edges.push({ source: classId, relation, name: t.text, file: ctx.rel });
      }
    }
  }
  return edges;
}

function calleeName(
  node: Parser.SyntaxNode,
  lang: Language,
): { name: string; viaMember: boolean; receiver?: string } | null {
  const fn = node.childForFieldName("function");
  if (!fn) return null;
  if (fn.type === "identifier") return { name: fn.text, viaMember: false };
  if (lang === "python" && fn.type === "attribute") {
    const a = fn.childForFieldName("attribute") ?? fn.namedChildren.at(-1);
    return a ? { name: a.text, viaMember: true, receiver: pyReceiver(fn) } : null;
  }
  if (lang === "go" && fn.type === "selector_expression") {
    // `pkg.Fn()` / `recv.Method()` — the called name is the trailing field.
    const p = fn.childForFieldName("field") ?? fn.namedChildren.at(-1);
    const operand = fn.childForFieldName("operand");
    const receiver = operand?.type === "identifier" ? operand.text : undefined;
    return p ? { name: p.text, viaMember: true, receiver } : null;
  }
  if ((lang === "typescript" || lang === "tsx") && fn.type === "member_expression") {
    const p = fn.childForFieldName("property") ?? fn.namedChildren.at(-1);
    return p ? { name: p.text, viaMember: true, receiver: tsReceiver(fn) } : null;
  }
  return null;
}

/** py `attribute` node's receiver text: bare identifier, or `self.x` for a
 * chained `self.x.y()`. Anything else (e.g. a chained call `f().g()`) → none. */
function pyReceiver(fn: Parser.SyntaxNode): string | undefined {
  const obj = fn.childForFieldName("object");
  if (obj?.type === "identifier") return obj.text;
  if (obj?.type === "attribute") {
    const innerObj = obj.childForFieldName("object");
    const innerAttr = obj.childForFieldName("attribute");
    if (innerObj?.type === "identifier" && innerObj.text === "self" && innerAttr) return `self.${innerAttr.text}`;
  }
  return undefined;
}

/** ts `member_expression` node's receiver text: `this`, `this.x`, or a bare identifier. */
function tsReceiver(fn: Parser.SyntaxNode): string | undefined {
  const obj = fn.childForFieldName("object");
  if (obj?.type === "this") return "this";
  if (obj?.type === "identifier") return obj.text;
  if (obj?.type === "member_expression") {
    const innerObj = obj.childForFieldName("object");
    const innerProp = obj.childForFieldName("property");
    if (innerObj?.type === "this" && innerProp) return `this.${innerProp.text}`;
  }
  return undefined;
}

function isImport(node: Parser.SyntaxNode, lang: Language): boolean {
  // Go: match the per-import leaf, so single (`import "fmt"`) and grouped
  // (`import ( … )`) forms each yield one edge as the walk recurses into the list.
  if (lang === "go") return node.type === "import_spec";
  return node.type === "import_statement" || node.type === "import_from_statement";
}

function importSpecifier(node: Parser.SyntaxNode, lang: Language): string | null {
  if (lang === "python") {
    const m =
      node.childForFieldName("module_name") ??
      node.namedChildren.find((c) => c.type === "dotted_name" || c.type === "relative_import");
    return m?.text ?? null;
  }
  if (lang === "go") {
    // import_spec's `path` is an interpreted_string_literal, e.g. `"mymod/pkg/util"`.
    const path = node.childForFieldName("path") ?? node.namedChildren.at(-1);
    return path ? path.text.replace(/^["`]|["`]$/g, "") : null;
  }
  const str = node.namedChildren.find((c) => c.type === "string");
  if (!str) return null;
  const frag = str.namedChildren.find((c) => c.type === "string_fragment");
  return frag?.text ?? str.text.replace(/^['"]|['"]$/g, "");
}

/** Signature = the definition header, whitespace-collapsed, trailing punctuation stripped. */
function clean(raw: string): string | null {
  const sig = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(=>|[{:=])\s*$/, "")
    .trim();
  return sig || null;
}

/** TS: a definition is exported if any ancestor is an `export` statement. */
function tsExported(node: Parser.SyntaxNode): boolean {
  let p = node.parent;
  while (p) {
    if (p.type === "export_statement") return true;
    p = p.parent;
  }
  return false;
}
