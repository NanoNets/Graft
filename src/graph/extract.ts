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
// Deep import avoids the package's extensionless-main DEP0151 warning under ESM.
import PowerShell from "tree-sitter-powershell/bindings/node/index.js";
import { basename } from "node:path";
import { contentHash } from "../util/id.js";
import { collectBindings, goReceiverVarOf, psTypeName, resolveRecvType, type FileBindings } from "./bindings.js";
import type { Kind, NodeV1, Relation } from "./types.js";

export type Language = "typescript" | "tsx" | "python" | "go" | "powershell";

/**
 * Extension → the tree-sitter grammar that parses it, and the label a human expects
 * to see for it.
 *
 * The two are not the same, and conflating them under-reported coverage: `.mjs` is
 * parsed by the typescript grammar, so a JS repo's build banner read `[typescript]`
 * and a `.jsx` one read `[tsx]`. Both are true about the *parser* and misleading
 * about the repo — people went looking for why their JavaScript hadn't been indexed
 * when it had, and could not tell a language that was merely unlabelled from one
 * that really was skipped (see issue #36).
 *
 * One table, both readings derived from it, so adding an extension cannot fix
 * extraction and forget the label. Ordered longest-suffix-first: `.tsx` has to be
 * tested before `.ts` would match it.
 */
const EXTENSIONS: ReadonlyArray<{ ext: string; grammar: Language; label: string }> = [
  { ext: ".tsx", grammar: "tsx", label: "tsx" },
  { ext: ".jsx", grammar: "tsx", label: "jsx" },
  { ext: ".mts", grammar: "typescript", label: "typescript" },
  { ext: ".cts", grammar: "typescript", label: "typescript" },
  { ext: ".ts", grammar: "typescript", label: "typescript" },
  { ext: ".mjs", grammar: "typescript", label: "javascript" },
  { ext: ".cjs", grammar: "typescript", label: "javascript" },
  { ext: ".js", grammar: "typescript", label: "javascript" },
  { ext: ".pyi", grammar: "python", label: "python" },
  { ext: ".py", grammar: "python", label: "python" },
  { ext: ".go", grammar: "go", label: "go" },
  { ext: ".psm1", grammar: "powershell", label: "powershell" },
  { ext: ".ps1", grammar: "powershell", label: "powershell" },
];

function entryFor(path: string): (typeof EXTENSIONS)[number] | undefined {
  const p = path.toLowerCase();
  return EXTENSIONS.find((e) => p.endsWith(e.ext));
}

/** Map a file path to a supported language, or null if unsupported. */
export function languageOf(path: string): Language | null {
  return entryFor(path)?.grammar ?? null;
}

/**
 * What to *call* the language of this file, for a banner or a repo map — or null when
 * the file isn't indexed at all, which is the distinction {@link languageOf} shares
 * and the one that matters to a reader checking coverage.
 */
export function languageLabelOf(path: string): string | null {
  return entryFor(path)?.label ?? null;
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
  specifier?: string; // module path to resolve (imports / imported-symbol references)
  name?: string; // symbol name to resolve (extends/implements/calls)
  viaMember?: boolean; // calls: was it `obj.foo()` (→ prefer method targets)?
  /** calls with viaMember: the receiver's resolved type name (from bindings /
   * self / this / Go receiver), when a confident local clue exists. */
  recvType?: string;
  lang?: Language; // PowerShell edges carry this for case-insensitive resolution.
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

const PS_KINDS: Record<string, Kind> = {
  function_statement: "function",
  class_statement: "class",
  enum_statement: "enum",
  class_method_definition: "method",
};

const KINDS_BY_LANG: Record<Language, Record<string, Kind>> = {
  typescript: TS_KINDS,
  tsx: TS_KINDS,
  python: PY_KINDS,
  go: GO_KINDS,
  powershell: PS_KINDS,
};

const CALL_NODE_TYPES: Record<Language, ReadonlySet<string>> = {
  typescript: new Set(["call_expression"]),
  tsx: new Set(["call_expression"]),
  python: new Set(["call"]),
  go: new Set(["call_expression"]),
  powershell: new Set(["command", "invokation_expression"]),
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
  powershell: PowerShell,
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
  importedSymbols: ReadonlyMap<string, { name: string; specifier: string }>;
}

/** A definition we're about to emit, normalized across the shapes we handle. */
interface DefDescriptor {
  name: string; // the bare symbol name (used for the node's `name` and call resolution)
  idName?: string; // id-scope segment when it differs from `name` (Go: `Receiver.method`)
  kind: Kind;
  headerEnd: number; // char index where the signature ends (body starts)
  hashNode: Parser.SyntaxNode; // node whose text forms body_hash / span
}

/** The chunked-callback parse predates tree-sitter 0.25, which lifted the
 * string `parse()` size limit that used to fail with "Invalid argument" on
 * any input ≥ 32 KB and silently drop large files — often the most important
 * ones (a 2000-line command module, a core tab implementation). Kept because
 * it is behavior-identical and exercised by existing tests. Code-unit
 * indexing matches `String.slice`. */
const PARSE_CHUNK = 16384;
function parseSource(source: string): Parser.SyntaxNode {
  return parser.parse((index: number) => source.slice(index, index + PARSE_CHUNK)).rootNode;
}

export function extractFile(rel: string, source: string, lang: Language): ExtractResult {
  parser.setLanguage(GRAMMARS[lang] as never);
  const root = parseSource(source);
  const bindings = collectBindings(root, lang);
  const importedSymbols = collectImportedSymbols(root, lang);

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
    importedSymbols,
  };
  // Every id minted this file, seeded with the file node's own id (`rel`) so a
  // top-level definition can never collide with it. Threaded as its own
  // parameter rather than living on WalkCtx — WalkCtx is spread into every
  // childCtx, so a by-ref Set there would read as ordinary inherited context
  // when it's actually accidental shared mutable state across the whole walk.
  const minted = new Set<string>([rel]);
  for (const child of root.namedChildren) walk(child, ctx, nodes, rawEdges, minted);
  // nodes[0] is the file node; the rest are its symbols. Index the module-level
  // residual on the file node so a term outside every symbol still surfaces it.
  nodes[0].body_text = fileResidual(source, nodes.slice(1));
  return { nodes, rawEdges };
}

function walk(node: Parser.SyntaxNode, ctx: WalkCtx, out: NodeV1[], edges: RawEdge[], minted: Set<string>): void {
  const desc = describe(node, ctx);
  if (desc) {
    // `idName` scopes the id (e.g. a Go method under its receiver: `#DB.Count`) while
    // `name` stays the bare symbol name so member-call resolution matches it.
    const idPart = desc.idName ?? desc.name;
    const base = `${ctx.rel}#${[...ctx.scope, idPart].join(".")}`;
    // Mint-time uniqueness: a document-order duplicate (same name reopened, or two
    // sibling defs that happen to collide) gets `~2`, `~3`, ... instead of silently
    // shadowing the first. The while-loop (not a single `~2` guess) is what makes
    // this collision-proof against a literal source name that already contains
    // `~N` (PowerShell can forge one) — it keeps incrementing until truly free
    // rather than trusting one candidate suffix is unused.
    let id = base;
    let k = 2;
    while (minted.has(id)) id = `${base}~${k++}`;
    minted.add(id);
    const isGoMethod = ctx.lang === "go" && node.type === "method_declaration";
    // The bare name of this node's OWN immediate enclosing class/receiver — for a
    // Go method that's its receiver type (methods aren't nested, so ctx.enclosingClass
    // wouldn't see it); for every other method it's simply what the nearest ancestor
    // class already set as ctx.enclosingClass. Only method nodes carry it — resolve.ts's
    // ownerMethod index is the sole consumer (see NodeV1.owner's doc comment).
    const owner: string | undefined =
      desc.kind === "method" ? (isGoMethod ? (goReceiverType(node) ?? undefined) : (ctx.enclosingClass ?? undefined)) : undefined;
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
            : ctx.lang === "powershell"
              ? psExported(node, ctx)
              : tsExported(node),
      origin: "ast",
      body_hash: contentHash(desc.hashNode.text),
      body_text: searchBody(desc.hashNode.text),
      summary_state: "pending",
      summary: null,
      crux: null,
      ...(owner !== undefined ? { owner } : {}),
    });
    // structural containment
    edges.push({ source: ctx.parentId, relation: "contains", targetId: id, file: ctx.rel });
    // class heritage
    if (desc.kind === "class") edges.push(...heritageEdges(node, id, ctx));

    const enclosingClass = desc.kind === "class" ? desc.name : isGoMethod ? goReceiverType(node) : ctx.enclosingClass;
    const childCtx: WalkCtx = {
      ...ctx,
      scope: [...ctx.scope, idPart],
      enclosingKind: desc.kind,
      parentId: id,
      enclosingClass,
      goReceiverVar: isGoMethod ? goReceiverVarOf(node) : ctx.goReceiverVar,
      importedSymbols:
        desc.kind === "function" || desc.kind === "method"
          ? withoutShadowedImports(ctx.importedSymbols, node)
          : ctx.importedSymbols,
    };
    for (const child of node.namedChildren) walk(child, childCtx, out, edges, minted);
    return;
  }

  // not a definition — capture calls/imports/references, then descend with the same context
  if (CALL_NODE_TYPES[ctx.lang].has(node.type) && !psSkipsCall(node, ctx.lang)) {
    const callee = calleeName(node, ctx.lang);
    if (callee) {
      const callEdge: RawEdge = {
        source: ctx.parentId,
        relation: "calls",
        name: callee.name,
        viaMember: callee.viaMember,
        file: ctx.rel,
        ...(ctx.lang === "powershell" ? { lang: ctx.lang } : {}),
      };
      const recvType = callee.recvType ?? resolveRecvType(callee.receiver, ctx);
      edges.push(recvType ? { ...callEdge, recvType } : callEdge);
    }
  } else if (isImport(node, ctx.lang)) {
    const spec = importSpecifier(node, ctx.lang);
    if (spec) {
      edges.push({
        source: ctx.rel,
        relation: "imports",
        specifier: spec,
        file: ctx.rel,
        ...(ctx.lang === "powershell" ? { lang: ctx.lang } : {}),
      });
    }
    // Imported identifiers are declarations, not uses. The import-binding pass
    // above already recorded them, so do not descend and emit false references.
    // PowerShell is the exception: a dot-source can wrap a whole script block
    // (`. { ... }`), whose body must still be walked for its own calls.
    if (ctx.lang !== "powershell") return;
  } else if (
    node.type === "identifier" &&
    !isDirectCallee(node, CALL_NODE_TYPES[ctx.lang]) &&
    !isDeclarationName(node)
  ) {
    const imported = ctx.importedSymbols.get(node.text);
    if (imported) {
      edges.push({
        source: ctx.parentId,
        relation: "references",
        name: imported.name,
        specifier: imported.specifier,
        file: ctx.rel,
      });
    }
  }

  for (const child of node.namedChildren) walk(child, ctx, out, edges, minted);
}

/**
 * Named imports whose local binding can be recognized later as a symbol use.
 * Namespace/default imports are intentionally excluded: they do not tell us
 * the exported symbol name, so wiring them would require guessing.
 */
function collectImportedSymbols(
  root: Parser.SyntaxNode,
  lang: Language,
): Map<string, { name: string; specifier: string }> {
  const out = new Map<string, { name: string; specifier: string }>();
  if (lang !== "typescript" && lang !== "tsx") return out;

  const visit = (node: Parser.SyntaxNode): void => {
    if (node.type === "import_statement") {
      const specifier = importSpecifier(node, lang);
      if (!specifier) return;
      collectTsImportBindings(node, specifier, out);
      return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return out;
}

function collectTsImportBindings(
  node: Parser.SyntaxNode,
  specifier: string,
  out: Map<string, { name: string; specifier: string }>,
): void {
  if (node.type === "import_specifier") {
    const name = node.childForFieldName("name")?.text;
    const local = node.childForFieldName("alias")?.text ?? name;
    if (name && local) out.set(local, { name, specifier });
    return;
  }
  for (const child of node.namedChildren) collectTsImportBindings(child, specifier, out);
}

/**
 * A parameter or local declaration wins over an import inside that function.
 * Drop that imported binding for the whole function rather than create a false
 * dependency. Nested functions are separate scopes and filter themselves.
 */
function withoutShadowedImports(
  imports: ReadonlyMap<string, { name: string; specifier: string }>,
  definition: Parser.SyntaxNode,
): ReadonlyMap<string, { name: string; specifier: string }> {
  if (imports.size === 0) return imports;
  const shadowed = new Set<string>();
  const definitionValue = definition.childForFieldName("value");
  const visit = (node: Parser.SyntaxNode): void => {
    if (node !== definition && node !== definitionValue && isFunctionBoundary(node)) {
      const name = node.childForFieldName("name");
      if (name?.type === "identifier") shadowed.add(name.text);
      return;
    }
    if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name");
      if (name?.type === "identifier") shadowed.add(name.text);
    } else if (node.type === "required_parameter" || node.type === "optional_parameter") {
      const pattern = node.childForFieldName("pattern");
      if (pattern?.type === "identifier") shadowed.add(pattern.text);
    } else if (node.type === "identifier" && node.parent?.type === "formal_parameters") {
      shadowed.add(node.text);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(definition);
  if (![...shadowed].some((name) => imports.has(name))) return imports;
  return new Map([...imports].filter(([local]) => !shadowed.has(local)));
}

function isFunctionBoundary(node: Parser.SyntaxNode): boolean {
  return (
    node.type === "function_declaration" ||
    node.type === "generator_function_declaration" ||
    node.type === "method_definition" ||
    node.type === "arrow_function" ||
    node.type === "function_expression" ||
    node.type === "function"
  );
}

/** A direct invocation already emits a stronger `calls` edge. */
function isDirectCallee(node: Parser.SyntaxNode, callTypes: ReadonlySet<string>): boolean {
  const parent = node.parent;
  return parent != null && callTypes.has(parent.type) && parent.childForFieldName("function")?.id === node.id;
}

/** Definition/declaration identifiers name a new binding; they do not use one. */
function isDeclarationName(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return parent?.childForFieldName("name")?.id === node.id;
}

/** Recognize the definition shapes: mapped node types, Go's type/method forms, and
 * TS arrow-consts. */
function describe(node: Parser.SyntaxNode, ctx: WalkCtx): DefDescriptor | null {
  if (ctx.lang === "go") return describeGo(node, ctx);
  if (ctx.lang === "powershell") return describePowerShell(node, ctx);

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

/** Function-definition scope qualifiers PowerShell allows (`function global:Foo`,
 * `script:Foo`, …). Call sites already strip these (see psCalleeName below) — a
 * definition's OWN name must too, or a globally-qualified def stores its
 * verbatim "global:Foo" name and can never match a call site's stripped "Foo". */
const PS_SCOPE_QUALIFIER = /^(global|script|local|private):/i;

/** PowerShell definitions have no fields, so names and header boundaries are positional. */
function describePowerShell(node: Parser.SyntaxNode, ctx: WalkCtx): DefDescriptor | null {
  const kind = ctx.kinds[node.type];
  if (!kind) return null;
  const nameNode =
    node.type === "function_statement"
      ? node.namedChildren.find((c) => c.type === "function_name")
      : node.namedChildren.find((c) => c.type === "simple_name");
  if (!nameNode) return null;
  const open = node.children.find((c) => c.type === "{");
  const name = node.type === "function_statement" ? nameNode.text.replace(PS_SCOPE_QUALIFIER, "") : nameNode.text;
  return {
    name,
    kind,
    headerEnd: open?.startIndex ?? node.endIndex,
    hashNode: node,
  };
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
  if (ctx.lang === "powershell") {
    // PS class base lists conflate the base class and any implemented interfaces
    // (no separate `implements` clause) — every entry emits "extends" here.
    // Harmless: PS cannot itself define an interface, so an interface entry is
    // always an external type anyway (never a repo symbol misclassified as a class).
    const bases = node.namedChildren.filter((c) => c.type === "simple_name").slice(1);
    for (const base of bases) {
      edges.push({ source: classId, relation: "extends", name: base.text, file: ctx.rel, lang: ctx.lang });
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
): { name: string; viaMember: boolean; receiver?: string; recvType?: string } | null {
  if (lang === "powershell") return psCalleeName(node);
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

function psCalleeName(
  node: Parser.SyntaxNode,
): { name: string; viaMember: boolean; receiver?: string; recvType?: string } | null {
  if (node.type === "command") {
    const raw = psStaticCommandName(node.childForFieldName("command_name") ?? null);
    if (!raw) return null;
    const name = raw
      .replace(PS_SCOPE_QUALIFIER, "")
      .replace(/^.*\\/, "");
    return name ? { name, viaMember: false } : null;
  }
  if (node.type !== "invokation_expression") return null;
  const receiverNode = node.child(0);
  const member = node.namedChildren.find((c) => c.type === "member_name");
  if (!receiverNode || !member) return null;
  if (receiverNode.type === "type_literal") {
    const recvType = psTypeName(receiverNode);
    return recvType ? { name: member.text, viaMember: true, recvType } : null;
  }
  return { name: member.text, viaMember: true, receiver: receiverNode.text };
}

/** The static command name text for a `command` node's `command_name` field, or
 * null when it's absent or names dynamic/string content. Plain commands
 * (`Get-Helper`) type the field `command_name` directly; the call operator (`&`)
 * and dot-source (`.`) both wrap it in `command_name_expr` instead — a static
 * bareword through `&` shows up one level deeper as `path_command_name` →
 * `path_command_name_token` (a qualified/dotted name like `script:Get-Helper`
 * types straight to `command_name` even there). A `variable`/`string_literal`/
 * `script_block_expression`/`parenthesized_expression` child means dynamic or
 * non-command content — never treated as static. A `path_command_name` can
 * ALSO carry a `variable` sibling of its `path_command_name_token` (`&
 * $dir\Get-Helper`) — the trailing token's text alone still reads as a plain
 * name, so that variable prefix must be checked explicitly rather than
 * inferred from the token shape. */
function psStaticCommandName(command: Parser.SyntaxNode | null): string | null {
  if (!command) return null;
  if (command.type === "command_name") return command.text;
  if (command.type !== "command_name_expr") return null;
  const inner = command.namedChildren[0];
  if (inner?.type === "command_name") return inner.text;
  if (inner?.type === "path_command_name") {
    if (inner.descendantsOfType("variable").length > 0) return null;
    return inner.namedChildren.find((c) => c.type === "path_command_name_token")?.text ?? null;
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
  if (lang === "powershell") return psImportKind(node) !== null;
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
  if (lang === "powershell") return psImportSpecifier(node);
  const str = node.namedChildren.find((c) => c.type === "string");
  if (!str) return null;
  const frag = str.namedChildren.find((c) => c.type === "string_fragment");
  return frag?.text ?? str.text.replace(/^['"]|['"]$/g, "");
}

type PsImportKind = "dotsource" | "import-module" | "using-module";

/** PowerShell's grammar represents all imports as commands (there is no
 * using_statement). `$PSScriptRoot` interpolation, Join-Path, wildcard/dynamic
 * Import-Module, manifest RootModule/NestedModules, and `using namespace`
 * intentionally remain raw or absent rather than erroring. */
function psImportKind(node: Parser.SyntaxNode): PsImportKind | null {
  if (node.type !== "command") return null;
  const operator = node.namedChildren.find((c) => c.type === "command_invokation_operator");
  if (operator?.text === ".") return "dotsource";
  const command = node.childForFieldName("command_name")?.text.toLowerCase();
  if (command === "import-module") return "import-module";
  if (command !== "using") return null;
  const tokens = psCommandElements(node).filter((c) => c.type === "generic_token");
  return tokens[0]?.text.toLowerCase() === "module" && tokens[1] ? "using-module" : null;
}

function psCommandElements(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  return node.childForFieldName("command_elements")?.namedChildren ?? [];
}

function psImportSpecifier(node: Parser.SyntaxNode): string | null {
  const kind = psImportKind(node);
  let raw: string | undefined;
  if (kind === "dotsource") {
    const commandNameField = node.childForFieldName("command_name") ?? null;
    // A dot-sourced script block (`. { … }`) or subexpression (`. ( … )`) has no
    // path at all — classify by the field's NODE TYPE rather than guessing from
    // its text, so a quoted path that merely starts with `(` (e.g.
    // `. "(helpers).ps1"`) is never mistaken for one (see psDotSourcePathShaped).
    if (!psDotSourcePathShaped(commandNameField)) return null;
    raw = commandNameField?.text;
  } else if (kind === "import-module") {
    raw = psImportModuleSpecifier(node) ?? undefined;
  } else if (kind === "using-module") {
    raw = psCommandElements(node).filter((c) => c.type === "generic_token")[1]?.text;
  }
  if (!raw) return null;
  return raw.replace(/^['"]|['"]$/g, "").replace(/\\/g, "/");
}

/** Import-Module's module specifier, parameter-aware: a `-Name` parameter's
 * value always wins, wherever it falls among the command's elements — in
 * `-Force -ErrorAction stop`, `-ErrorAction`'s own value ("stop") must never be
 * mistaken for the module target just because it's the first non-parameter
 * element left. Without an explicit `-Name`, the specifier is the first element
 * that is neither a parameter NOR immediately preceded by one (that element
 * belongs to the preceding parameter, not the module) — this also keeps a
 * positional specifier before a trailing switch working
 * (`Import-Module ./Mod.psm1 -Force`). No qualifying candidate → null (no
 * edge), never a guess. Mirrors bindings.ts's psNewObjectType, which solves the
 * same parameter-vs-positional ambiguity for `New-Object`. */
function psImportModuleSpecifier(node: Parser.SyntaxNode): string | null {
  const elements = psCommandElements(node).filter((c) => c.type !== "command_argument_sep");
  const nameIdx = elements.findIndex((c) => c.type === "command_parameter" && /^-Name$/i.test(c.text));
  if (nameIdx !== -1) {
    const value = elements[nameIdx + 1];
    return value && value.type !== "command_parameter" ? value.text : null;
  }
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === "command_parameter") continue;
    if (elements[i - 1]?.type === "command_parameter") continue; // that param's own value
    return el.text;
  }
  return null;
}

/** Whether a dot-sourced command's `command_name` field names a real path
 * rather than a script block or subexpression. A plain bareword path types
 * this field `command_name` directly. The call operator's `command_name_expr`
 * wrapper (also used here for `.`) is drilled one level: a qualified/dotted
 * bareword still types `command_name`, a variable-rooted path (`$dir\Foo.ps1`)
 * types `path_command_name` — accepted only when its trailing token actually
 * starts with a path separator, so a property-access-like suffix
 * (`$obj.Method`, token ".Method") is never mistaken for a path — and a
 * quoted path types `string_literal` (its surrounding quotes are stripped by
 * the caller). A POSIX-separator variable-rooted path (`$PSScriptRoot/Foo.ps1`)
 * parses as `member_access` instead (with a grammar-level ERROR node from the
 * bare `/`) — accepted only when its text is a bare `$Var/…` shape,
 * mirroring the backslash form's specifier so `$PSScriptRoot` resolution
 * sees the same raw text either way. `script_block_expression` (`. { … }`) and
 * `parenthesized_expression` (`. ( … )`) carry no path at all and are rejected
 * outright. */
function psDotSourcePathShaped(commandNameField: Parser.SyntaxNode | null): boolean {
  if (!commandNameField) return false;
  if (commandNameField.type === "command_name") return true;
  if (commandNameField.type !== "command_name_expr") return false;
  const inner = commandNameField.namedChildren[0];
  if (inner?.type === "command_name" || inner?.type === "string_literal") return true;
  if (inner?.type === "path_command_name") {
    const token = inner.namedChildren.find((c) => c.type === "path_command_name_token")?.text ?? "";
    return /^[\\/]/.test(token);
  }
  if (inner?.type === "member_access") return /^\$[A-Za-z_]\w*\//.test(inner.text);
  return false;
}

function psSkipsCall(node: Parser.SyntaxNode, lang: Language): boolean {
  if (lang !== "powershell" || node.type !== "command") return false;
  // psImportKind already returns non-null for every dot-sourced command (whatever
  // it dot-sources), so this alone keeps `.` out of the call graph. `&` is
  // deliberately NOT blanket-skipped here — psCalleeName decides per-callee
  // whether a call-operator target is static (a real call) or dynamic (none).
  if (psImportKind(node)) return true;
  return node.childForFieldName("command_name")?.text.toLowerCase() === "using";
}

/** PowerShell has no file-local syntactic export marker. Export-ModuleMember and
 * `.psd1` FunctionsToExport need cross-file/manifest context extractFile cannot
 * see (and the common unquoted Export-ModuleMember list does not parse). Class
 * members and top-level definitions are public; a function nested inside another
 * function OR a class method body is local. */
function psExported(node: Parser.SyntaxNode, ctx: WalkCtx): boolean {
  return node.type !== "function_statement" || (ctx.enclosingKind !== "function" && ctx.enclosingKind !== "method");
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
