/**
 * Receiver-type binding pass: a pre-order walk over a parsed file that answers,
 * for every local variable / parameter / class field / `self`|`this` attribute,
 * "what type is this?" — so a later member-call site (`app.include_router()`)
 * can look up `app`'s bound type instead of resolving on the bare method name
 * alone. Pure and dependency-only: no LLM, no network, no mutation of the AST.
 *
 * Only `import type` from extract.ts (never a value) — extract.ts imports
 * `collectBindings` from here, so a value import back would be a cycle.
 */
import type Parser from "tree-sitter";
import type { Language, WalkCtx } from "./extract.js";

/** Variable/field → bare type name, keyed by scope. Scope keys mirror
 * extract.ts's own scope stack (`scope.join(".")`, `""` at module level) so a
 * lookup from extract.ts's walk finds exactly what was bound in the same
 * lexical position. */
export class FileBindings {
  private map = new Map<string, string>();

  constructor(private readonly caseInsensitive = false) {}

  private key(scopePath: string, name: string): string {
    const key = `${scopePath}|${name}`;
    return this.caseInsensitive ? key.toLowerCase() : key;
  }

  set(scopePath: string, name: string, type: string): void {
    this.map.set(this.key(scopePath, name), type);
  }

  /** Innermost-first: for scope ["a","b"] name "x", tries `a.b|x`, `a|x`, `|x`. */
  lookup(scope: string[], name: string): string | null {
    for (let i = scope.length; i >= 0; i--) {
      const hit = this.map.get(this.key(scope.slice(0, i).join("."), name));
      if (hit) return hit;
    }
    return null;
  }
}

const FN_VALUE_TYPES = new Set(["arrow_function", "function", "function_expression", "generator_function"]);

/** Definition-node types that push a new scope segment, mirroring extract.ts's
 * `describe()` closely enough to keep the two scope stacks in lockstep — but
 * duplicated here (not imported) to keep bindings.ts free of a value import on
 * extract.ts. Returns the def's scope segment (bare name, except a Go method
 * which is receiver-qualified — `Receiver.method` — exactly like extract.ts's
 * `idName`, so a binding recorded inside a Go method body is stored under the
 * same scope key extract.ts's walk will look it up with), or null if `node`
 * isn't a definition. */
export function defName(node: Parser.SyntaxNode, lang: Language): string | null {
  if (lang === "powershell") {
    if (node.type === "function_statement") {
      const name = node.namedChildren.find((c) => c.type === "function_name")?.text ?? null;
      // Lockstep contract: extract.ts's describePowerShell strips this same
      // qualifier from its own scope-stack segment. Must match exactly, or a
      // binding recorded under one scope key (e.g. "global:Setup") is invisible
      // to a lookup keyed by the other ("Setup") — duplicated regex, not
      // imported, per this file's no-value-import-of-extract rule (see header).
      return name ? name.replace(/^(global|script|local|private):/i, "") : null;
    }
    if (["class_statement", "class_method_definition", "enum_statement"].includes(node.type)) {
      return node.namedChildren.find((c) => c.type === "simple_name")?.text ?? null;
    }
    return null;
  }
  if (lang === "go") {
    if (node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (!name) return null;
      const recv = goReceiverTypeOf(node);
      return recv ? `${recv}.${name}` : name;
    }
    if (node.type === "function_declaration" || node.type === "type_spec") {
      return node.childForFieldName("name")?.text ?? null;
    }
    return null;
  }
  const defTypes =
    lang === "python"
      ? new Set(["class_definition", "function_definition"])
      : new Set([
          "class_declaration",
          "abstract_class_declaration",
          "function_declaration",
          "generator_function_declaration",
          "method_definition",
          "interface_declaration",
          "type_alias_declaration",
          "enum_declaration",
        ]);
  if (defTypes.has(node.type)) return node.childForFieldName("name")?.text ?? null;
  if ((lang === "typescript" || lang === "tsx") && node.type === "variable_declarator") {
    const value = node.childForFieldName("value");
    if (value && FN_VALUE_TYPES.has(value.type)) return node.childForFieldName("name")?.text ?? null;
  }
  return null;
}

/** The receiver parameter's own variable name for a Go method (`func (w *Worker) …`
 * → `w`). Null if it can't be read. */
export function goReceiverVarOf(node: Parser.SyntaxNode): string | null {
  const recv = node.childForFieldName("receiver");
  const param = recv?.namedChildren.find((c) => c.type === "parameter_declaration");
  return param?.childForFieldName("name")?.text ?? null;
}

/** The receiver's base type name for a Go method, unwrapping a pointer receiver
 * (`func (w *Worker) …` → `Worker`). Mirrors extract.ts's own `goReceiverType`
 * (duplicated, not imported, per this file's no-value-import-of-extract rule).
 * Null if it can't be read. */
function goReceiverTypeOf(node: Parser.SyntaxNode): string | null {
  const recv = node.childForFieldName("receiver");
  const param = recv?.namedChildren.find((c) => c.type === "parameter_declaration");
  let type = param?.childForFieldName("type");
  if (type?.type === "pointer_type") type = type.namedChildren.at(-1) ?? null;
  return type?.type === "type_identifier" ? type.text : null;
}

/** Resolves a call site's receiver text (from `calleeName`) to a bound type
 * name, given the enclosing walk state. `self`/`cls`/`this`/the Go receiver
 * var resolve directly to the enclosing class; anything else is a bindings-map
 * lookup, normalizing `this.` to `self.` since both are stored the same way. */
export function resolveRecvType(
  receiver: string | undefined,
  ctx: Pick<WalkCtx, "scope" | "enclosingClass" | "goReceiverVar" | "lang" | "bindings">,
): string | undefined {
  if (!receiver) return undefined;
  if (ctx.lang === "powershell") {
    if (receiver.toLowerCase() === "$this") return ctx.enclosingClass ?? undefined;
    const key = receiver.replace(/^\$this\./i, "self.");
    return ctx.bindings.lookup(ctx.scope, key) ?? undefined;
  }
  if (receiver === "self" || receiver === "cls" || receiver === "this") return ctx.enclosingClass ?? undefined;
  if (receiver.startsWith("self.") || receiver.startsWith("this.")) {
    return (
      ctx.bindings.lookup(ctx.scope, receiver) ??
      ctx.bindings.lookup(ctx.scope, receiver.replace(/^this\./, "self.")) ??
      undefined
    );
  }
  return (
    (ctx.lang === "go" && receiver === ctx.goReceiverVar ? ctx.enclosingClass : undefined) ??
    ctx.bindings.lookup(ctx.scope, receiver) ??
    undefined
  );
}

function isClassNode(node: Parser.SyntaxNode, lang: Language): boolean {
  if (lang === "python") return node.type === "class_definition";
  if (lang === "typescript" || lang === "tsx") {
    return node.type === "class_declaration" || node.type === "abstract_class_declaration";
  }
  if (lang === "powershell") return node.type === "class_statement";
  return false;
}

/** Pass 1 over a parsed file: collect variable->type bindings. Pure. */
export function collectBindings(root: Parser.SyntaxNode, lang: Language): FileBindings {
  const bindings = new FileBindings(lang === "powershell");
  const aliases = new Map<string, string>();
  collectAliases(root, lang, aliases);
  visit(root, lang, [], null, bindings, aliases);
  return bindings;
}

/** Import aliases (`... as F`) can be declared anywhere relative to their use
 * textually, so this scans the whole tree once, ahead of the scope-aware walk. */
function collectAliases(node: Parser.SyntaxNode, lang: Language, aliases: Map<string, string>): void {
  if (lang === "go" || lang === "powershell") return;
  if (lang === "python" && node.type === "aliased_import") {
    const nameNode = node.childForFieldName("name");
    const aliasNode = node.childForFieldName("alias");
    if (nameNode && aliasNode) {
      const orig = nameNode.type === "dotted_name" ? (nameNode.namedChildren.at(-1)?.text ?? nameNode.text) : nameNode.text;
      aliases.set(aliasNode.text, orig);
    }
  } else if ((lang === "typescript" || lang === "tsx") && node.type === "import_specifier") {
    const nameNode = node.childForFieldName("name");
    const aliasNode = node.childForFieldName("alias");
    if (nameNode && aliasNode) aliases.set(aliasNode.text, nameNode.text);
  }
  for (const child of node.namedChildren) collectAliases(child, lang, aliases);
}

/** `scope`/`classScope` mirror extract.ts's walk: `scope` is the enclosing
 * definition-name stack; `classScope` is the nearest enclosing class's scope
 * path (distinct from `scope` once we're inside one of its methods) — that's
 * where `self.attr`/`this.attr` bindings live. */
function visit(
  node: Parser.SyntaxNode,
  lang: Language,
  scope: string[],
  classScope: string | null,
  bindings: FileBindings,
  aliases: Map<string, string>,
): void {
  if (lang === "python") handlePy(node, scope, classScope, bindings, aliases);
  else if (lang === "go") handleGo(node, scope, bindings);
  else if (lang === "powershell") handlePs(node, scope, classScope, bindings);
  else handleTs(node, scope, classScope, bindings, aliases);

  const name = defName(node, lang);
  let childScope = scope;
  let childClassScope = classScope;
  if (name !== null) {
    childScope = [...scope, name];
    if (isClassNode(node, lang)) childClassScope = childScope.join(".");
  }
  for (const child of node.namedChildren) visit(child, lang, childScope, childClassScope, bindings, aliases);
}

/** Resolves a bare type name through `aliases` — every annotation path must
 * consult it, so an aliased import (`import Foo as Bar`) still binds to the
 * original name callers actually search for. See the "aliases already
 * resolved" contract above. */
function resolveAlias(name: string, aliases: Map<string, string>): string {
  return aliases.get(name) ?? name;
}

function pyTypeName(node: Parser.SyntaxNode | null | undefined, aliases: Map<string, string>): string | null {
  if (!node) return null;
  if (node.type === "identifier") return resolveAlias(node.text, aliases);
  if (node.type === "type") {
    const inner = node.namedChildren[0];
    return inner?.type === "identifier" ? resolveAlias(inner.text, aliases) : null;
  }
  return null;
}

function callTypeName(node: Parser.SyntaxNode | null | undefined, aliases: Map<string, string>): string | null {
  if (node?.type !== "call") return null;
  const fn = node.childForFieldName("function");
  if (fn?.type !== "identifier") return null;
  return aliases.get(fn.text) ?? fn.text;
}

function handlePy(
  node: Parser.SyntaxNode,
  scope: string[],
  classScope: string | null,
  bindings: FileBindings,
  aliases: Map<string, string>,
): void {
  const scopePath = scope.join(".");
  if (node.type === "typed_parameter") {
    const nameNode = node.namedChildren.find((c) => c.type === "identifier");
    const typeName = pyTypeName(node.childForFieldName("type"), aliases);
    if (nameNode && typeName) bindings.set(scopePath, nameNode.text, typeName);
    return;
  }
  if (node.type !== "assignment") return;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left) return;
  if (left.type === "identifier") {
    const typeField = node.childForFieldName("type");
    const typeName = typeField ? pyTypeName(typeField, aliases) : callTypeName(right, aliases);
    if (typeName) bindings.set(scopePath, left.text, typeName);
  } else if (left.type === "attribute") {
    const obj = left.childForFieldName("object");
    const attr = left.childForFieldName("attribute");
    if (obj?.type === "identifier" && (obj.text === "self" || obj.text === "cls") && attr) {
      const typeName = callTypeName(right, aliases);
      if (typeName) bindings.set(classScope ?? scopePath, `self.${attr.text}`, typeName);
    }
  }
}

function tsAnnotationTypeName(
  typeAnn: Parser.SyntaxNode | null | undefined,
  aliases: Map<string, string>,
): string | null {
  if (!typeAnn || typeAnn.type !== "type_annotation") return null;
  const t = typeAnn.namedChildren[0];
  return t?.type === "type_identifier" ? resolveAlias(t.text, aliases) : null;
}

function tsNewTypeName(value: Parser.SyntaxNode | null | undefined, aliases: Map<string, string>): string | null {
  if (value?.type !== "new_expression") return null;
  const ctor = value.childForFieldName("constructor");
  if (ctor?.type !== "identifier") return null;
  return aliases.get(ctor.text) ?? ctor.text;
}

function handleTs(
  node: Parser.SyntaxNode,
  scope: string[],
  classScope: string | null,
  bindings: FileBindings,
  aliases: Map<string, string>,
): void {
  const scopePath = scope.join(".");
  if (node.type === "variable_declarator") {
    const value = node.childForFieldName("value");
    if (value && FN_VALUE_TYPES.has(value.type)) return; // a function def, not a type binding
    const name = node.childForFieldName("name");
    if (name?.type !== "identifier") return;
    const typeName = tsNewTypeName(value, aliases) ?? tsAnnotationTypeName(node.childForFieldName("type"), aliases);
    if (typeName) bindings.set(scopePath, name.text, typeName);
  } else if (node.type === "public_field_definition") {
    const name = node.childForFieldName("name");
    if (!name) return;
    const typeName =
      tsAnnotationTypeName(node.childForFieldName("type"), aliases) ??
      tsNewTypeName(node.childForFieldName("value"), aliases);
    if (typeName) bindings.set(classScope ?? scopePath, `this.${name.text}`, typeName);
  } else if (node.type === "required_parameter") {
    const pattern = node.childForFieldName("pattern");
    if (pattern?.type !== "identifier") return;
    const typeName = tsAnnotationTypeName(node.childForFieldName("type"), aliases);
    if (typeName) bindings.set(scopePath, pattern.text, typeName);
  }
}

const PS_EXPR_WRAPPERS = new Set([
  "logical_expression", "bitwise_expression", "comparison_expression",
  "additive_expression", "multiplicative_expression", "format_expression", "range_expression",
  "logical_argument_expression", "bitwise_argument_expression", "comparison_argument_expression",
  "additive_argument_expression", "multiplicative_argument_expression", "format_argument_expression",
  "range_argument_expression", "array_literal_expression", "unary_expression", "expression_with_unary_operator",
]);

function unwrapExpr(node: Parser.SyntaxNode | null | undefined): Parser.SyntaxNode | null {
  let current = node ?? null;
  while (current && PS_EXPR_WRAPPERS.has(current.type) && current.namedChildCount === 1) {
    current = current.namedChild(0);
  }
  return current;
}

/** A `type_literal`'s bare type name (`[Widget]` → `"Widget"`). Shared with
 * extract.ts (its own psCalleeName needs the same lookup for a static-constructor
 * receiver) — mirrors the existing goReceiverVarOf precedent of exporting a
 * helper from here rather than duplicating it; the no-value-import rule only
 * forbids the reverse direction (this file importing a value from extract.ts). */
export function psTypeName(node: Parser.SyntaxNode | null | undefined): string | null {
  if (node?.type !== "type_literal") return null;
  const spec = node.namedChildren.find((c) => c.type === "type_spec");
  const name = spec?.namedChildren.find((c) => c.type === "type_name");
  return name?.namedChildren.find((c) => c.type === "type_identifier")?.text ?? null;
}

function psAssignmentTarget(node: Parser.SyntaxNode): { name: string; type: string | null } | null {
  const left = node.namedChildren.find((c) => c.type === "left_assignment_expression");
  const value = unwrapExpr(left?.namedChild(0));
  if (value?.type === "variable") return { name: value.text, type: null };
  if (value?.type !== "cast_expression") return null;
  const type = psTypeName(value.namedChildren.find((c) => c.type === "type_literal"));
  const variable = unwrapExpr(value.namedChildren.find((c) => c.type !== "type_literal"));
  return type && variable?.type === "variable" ? { name: variable.text, type } : null;
}

/** `New-Object`'s type argument, parameter-aware: `-TypeName`'s value always wins
 * (wherever it falls among the command's elements — `-ArgumentList`'s own value
 * must never be mistaken for it just because it comes first). Without an explicit
 * `-TypeName`: a switch parameter (e.g. `-Verbose`) takes no value, so when the
 * command has exactly one candidate element left (neither a parameter nor
 * `-ArgumentList`'s own value), that lone element is the type regardless of which
 * parameter it happens to sit next to — `New-Object -Verbose Widget` must still
 * bind "Widget". Only `-ArgumentList` is known to actually consume the element
 * after it (`-ArgumentList Widget`'s "Widget" is an argument, not a type name), so
 * it alone disqualifies an adjacent lone candidate. With multiple candidates
 * remaining, position is genuinely ambiguous without cmdlet metadata; fall back to
 * the first element that is neither a parameter nor immediately after one. */
function psNewObjectType(command: Parser.SyntaxNode): string | null {
  if (command.childForFieldName("command_name")?.text.toLowerCase() !== "new-object") return null;
  const elements = (command.childForFieldName("command_elements")?.namedChildren ?? []).filter(
    (c) => c.type !== "command_argument_sep",
  );
  const clean = (text: string) => text.replace(/^['"]|['"]$/g, "");

  const typeNameIdx = elements.findIndex((c) => c.type === "command_parameter" && /^-TypeName$/i.test(c.text));
  if (typeNameIdx !== -1) {
    const value = elements[typeNameIdx + 1];
    return value && value.type !== "command_parameter" ? clean(value.text) : null;
  }

  const candidates = elements.filter((c) => c.type !== "command_parameter");
  if (candidates.length === 1) {
    const only = candidates[0];
    const precedingParam = elements[elements.indexOf(only) - 1];
    const ownedByArgumentList =
      precedingParam?.type === "command_parameter" && /^-ArgumentList$/i.test(precedingParam.text);
    return ownedByArgumentList ? null : clean(only.text);
  }

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === "command_parameter") continue;
    if (elements[i - 1]?.type === "command_parameter") continue; // that param's own value
    return clean(el.text);
  }
  return null;
}

function psInvocationType(node: Parser.SyntaxNode | null): string | null {
  if (node?.type !== "invokation_expression") return null;
  const receiver = node.child(0);
  const member = node.namedChildren.find((c) => c.type === "member_name");
  return receiver?.type === "type_literal" && member?.text.toLowerCase() === "new"
    ? psTypeName(receiver)
    : null;
}

function psRhsType(node: Parser.SyntaxNode): string | null {
  const pipeline = node.childForFieldName("value");
  const chain = pipeline?.namedChildren.find((c) => c.type === "pipeline_chain");
  const value = chain?.namedChild(0) ?? null;
  if (value?.type === "command") return psNewObjectType(value);
  return psInvocationType(unwrapExpr(value));
}

function psParameterBinding(node: Parser.SyntaxNode): { name: string; type: string } | null {
  const variable = node.namedChildren.find((c) => c.type === "variable");
  let typeLiteral = node.namedChildren.find((c) => c.type === "type_literal");
  if (!typeLiteral) {
    // The type can sit behind ANY attribute, not just the first — e.g.
    // `[Parameter(Mandatory=$true)][Widget]$w` puts `Parameter` at index 0 and the
    // type_literal at index 1. Scan every attribute for one that carries it.
    const attrs = node.namedChildren.find((c) => c.type === "attribute_list");
    typeLiteral = attrs?.namedChildren
      .map((a) => a.namedChildren.find((c) => c.type === "type_literal"))
      .find(Boolean);
  }
  const type = psTypeName(typeLiteral);
  return variable && type ? { name: variable.text, type } : null;
}

function handlePs(
  node: Parser.SyntaxNode,
  scope: string[],
  classScope: string | null,
  bindings: FileBindings,
): void {
  const scopePath = scope.join(".");
  if (node.type === "assignment_expression") {
    const target = psAssignmentTarget(node);
    const type = target?.type ?? psRhsType(node);
    if (target && type) bindings.set(scopePath, target.name, type);
  } else if (node.type === "script_parameter" || node.type === "class_method_parameter") {
    const param = psParameterBinding(node);
    if (param) bindings.set(scopePath, param.name, param.type);
  } else if (node.type === "class_property_definition") {
    const property = psParameterBinding(node);
    if (property) bindings.set(classScope ?? scopePath, `self.${property.name.replace(/^\$/, "")}`, property.type);
  }
}

function handleGo(node: Parser.SyntaxNode, scope: string[], bindings: FileBindings): void {
  const scopePath = scope.join(".");
  if (node.type === "var_spec") {
    const name = node.childForFieldName("name");
    let type = node.childForFieldName("type");
    if (type?.type === "pointer_type") type = type.namedChildren.at(-1) ?? null;
    if (name?.type === "identifier" && type?.type === "type_identifier") {
      bindings.set(scopePath, name.text, type.text);
    }
    return;
  }
  if (node.type !== "short_var_declaration") return;
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return;
  const names = left.namedChildren;
  const exprs = right.namedChildren;
  for (let i = 0; i < names.length; i++) {
    const nameNode = names[i];
    let expr = exprs[i];
    if (!nameNode || nameNode.type !== "identifier" || !expr) continue;
    if (expr.type === "unary_expression") {
      expr = expr.namedChildren.find((c) => c.type === "composite_literal") ?? expr;
    }
    let typeName: string | null = null;
    if (expr.type === "composite_literal") {
      const t = expr.childForFieldName("type");
      typeName = t?.type === "type_identifier" ? t.text : null;
    } else if (expr.type === "call_expression") {
      const fn = expr.childForFieldName("function");
      // Go convention: NewX(...) binds to X.
      if (fn?.type === "identifier" && /^New[A-Z]/.test(fn.text)) typeName = fn.text.slice(3);
    }
    if (typeName) bindings.set(scopePath, nameNode.text, typeName);
  }
}
