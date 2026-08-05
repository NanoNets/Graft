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

  set(scopePath: string, name: string, type: string): void {
    this.map.set(`${scopePath}|${name}`, type);
  }

  /** Innermost-first: for scope ["a","b"] name "x", tries `a.b|x`, `a|x`, `|x`. */
  lookup(scope: string[], name: string): string | null {
    for (let i = scope.length; i >= 0; i--) {
      const hit = this.map.get(`${scope.slice(0, i).join(".")}|${name}`);
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
  if (lang === "java") {
    const javaDefTypes = new Set([
      "class_declaration",
      "interface_declaration",
      "record_declaration",
      "enum_declaration",
      "method_declaration",
      "constructor_declaration",
      "annotation_type_declaration",
      "annotation_type_element_declaration",
    ]);
    if (javaDefTypes.has(node.type)) return node.childForFieldName("name")?.text ?? null;
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
    // Java implicit field access: a bare `ra` in a method body that isn't a
    // local or parameter is an implicit `this.ra` — look it up under the
    // enclosing class scope. (Python/TS require an explicit `self.` / `this.`.)
    (ctx.lang === "java" && ctx.enclosingClass ? ctx.bindings.lookup([ctx.enclosingClass], `this.${receiver}`) : undefined) ??
    undefined
  );
}

function isClassNode(node: Parser.SyntaxNode, lang: Language): boolean {
  if (lang === "python") return node.type === "class_definition";
  if (lang === "typescript" || lang === "tsx") {
    return node.type === "class_declaration" || node.type === "abstract_class_declaration";
  }
  if (lang === "java") {
    // Classes, records, interfaces (default methods use `this`), enums (enum
    // methods use `this`), and annotation types all define a `this`-scope for
    // field bindings.
    return (
      node.type === "class_declaration" ||
      node.type === "record_declaration" ||
      node.type === "interface_declaration" ||
      node.type === "enum_declaration" ||
      node.type === "annotation_type_declaration"
    );
  }
  return false;
}

/** Pass 1 over a parsed file: collect variable->type bindings. Pure. */
export function collectBindings(root: Parser.SyntaxNode, lang: Language): FileBindings {
  const bindings = new FileBindings();
  const aliases = new Map<string, string>();
  collectAliases(root, lang, aliases);
  visit(root, lang, [], null, bindings, aliases);
  return bindings;
}

/** Import aliases (`... as F`) can be declared anywhere relative to their use
 * textually, so this scans the whole tree once, ahead of the scope-aware walk. */
function collectAliases(node: Parser.SyntaxNode, lang: Language, aliases: Map<string, string>): void {
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
  else if (lang === "java") handleJava(node, scope, classScope, bindings);
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

/** Java bindings: field declarations, local variables, parameter type
 * annotations (incl. varargs, try-with-resources, enhanced-for, and catch
 * parameters), for receiver-type resolution on member calls. Field types come
 * from the type annotation (or `new X()` initializer); locals likewise. Fields
 * bind under the enclosing class scope as `this.<name>` so `this.foo` lookups
 * resolve; locals and parameters bind under the lexical scope. */
function handleJava(
  node: Parser.SyntaxNode,
  scope: string[],
  classScope: string | null,
  bindings: FileBindings,
): void {
  const scopePath = scope.join(".");

  // field_declaration: `private final IFoo foo;` or `private int x, y;`
  if (node.type === "field_declaration") {
    const typeNode = node.childForFieldName("type");
    let typeName = javaTypeName(typeNode);
    for (const declarator of node.namedChildren.filter((c) => c.type === "variable_declarator")) {
      const name = declarator.childForFieldName("name")?.text;
      if (!name) continue;
      // Fallback: `Foo x = new Bar()` → resolve to `Bar` from the initializer.
      if (!typeName) {
        const value = declarator.childForFieldName("value");
        typeName = javaNewTypeName(value);
      }
      if (typeName) bindings.set(classScope ?? scopePath, `this.${name}`, typeName);
    }
    return;
  }

  // local_variable_declaration: `var x = new Foo();` or `Foo x = new Foo();`
  if (node.type === "local_variable_declaration") {
    const typeNode = node.childForFieldName("type");
    let typeName = javaTypeName(typeNode);
    for (const declarator of node.namedChildren.filter((c) => c.type === "variable_declarator")) {
      const name = declarator.childForFieldName("name")?.text;
      if (!name) continue;
      // Fallback: `var x = new Foo()` → resolve to `Foo` from the initializer.
      if (!typeName || typeName === "var") {
        const value = declarator.childForFieldName("value");
        typeName = javaNewTypeName(value);
      }
      if (typeName && typeName !== "var") bindings.set(scopePath, name, typeName);
    }
    return;
  }

  // formal_parameter: `Foo bar` in method/constructor signatures
  if (node.type === "formal_parameter") {
    const name = node.childForFieldName("name")?.text;
    const typeName = javaTypeName(node.childForFieldName("type"));
    if (name && typeName) bindings.set(scopePath, name, typeName);
    return;
  }

  // spread_parameter (varargs): `Foo... args` — tree-sitter gives this a distinct
  // node type with no field names; the type is the first named child and the name
  // lives inside a `variable_declarator`.
  if (node.type === "spread_parameter") {
    const typeNode = node.namedChildren.find((c) => c.type !== "variable_declarator");
    const name = node.namedChildren.find((c) => c.type === "variable_declarator")?.childForFieldName("name")?.text;
    const typeName = javaTypeName(typeNode);
    if (name && typeName) bindings.set(scopePath, name, typeName);
    return;
  }

  // resource (try-with-resources): `try (Foo f = new Foo())` — the `resource` node
  // has `type`, `name`, and `value` fields, binding like a local variable.
  if (node.type === "resource") {
    const name = node.childForFieldName("name")?.text;
    let typeName = javaTypeName(node.childForFieldName("type"));
    // Fallback: `try (var f = new Foo())` → resolve from the initializer.
    if (!typeName || typeName === "var") {
      typeName = javaNewTypeName(node.childForFieldName("value"));
    }
    if (name && typeName && typeName !== "var") bindings.set(scopePath, name, typeName);
    return;
  }

  // enhanced_for_statement: `for (Foo f : items)` — the loop variable `f` is
  // typed by the `type` field; bind it under the lexical scope so `f.method()`
  // inside the loop body resolves.
  if (node.type === "enhanced_for_statement") {
    const name = node.childForFieldName("name")?.text;
    const typeName = javaTypeName(node.childForFieldName("type"));
    if (name && typeName) bindings.set(scopePath, name, typeName);
    return;
  }

  // catch_formal_parameter: `catch (BizException e)` — tree-sitter gives this a
  // distinct node type (not `formal_parameter`); the type lives in a `catch_type`
  // child (which holds one `type_identifier`, or several for multi-catch
  // `IOException | BizException` — bind the first).
  if (node.type === "catch_formal_parameter") {
    const name = node.childForFieldName("name")?.text;
    const catchType = node.namedChildren.find((c) => c.type === "catch_type");
    const typeNode = catchType?.namedChildren.find((c) => c.type === "type_identifier" || c.type === "scoped_type_identifier" || c.type === "identifier");
    const typeName = javaTypeName(typeNode);
    if (name && typeName) bindings.set(scopePath, name, typeName);
  }
}

/** Extract a bare type name from a Java type node: `type_identifier` (`Foo`),
 * `scoped_type_identifier` (`com.example.Base` → `Base`), `generic_type`
 * (`List<String>` → `List`, `com.example.Base<Bar>` → `Base`), `array_type`
 * (`Foo[]` → `Foo`), or a primitive type (`int`, `void`, ...). A superset of
 * extract.ts's `javaTypeName` (which is used only for heritage edges and so
 * omits the primitive branches), duplicated here rather than imported, per
 * this file's no-value-import-of-extract rule. */
function javaTypeName(node: Parser.SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "type_identifier" || node.type === "identifier") return node.text;
  if (node.type === "scoped_type_identifier") return node.namedChildren.at(-1)?.text ?? null;
  if (node.type === "generic_type") {
    // `List<String>` → inner `type_identifier`; `com.example.Base<Bar>` → inner
    // `scoped_type_identifier`. tree-sitter-java gives `generic_type` no `type`
    // field, so find the type-bearing child and recurse to strip any scope.
    const inner = node.namedChildren.find(
      (c) => c.type === "type_identifier" || c.type === "scoped_type_identifier" || c.type === "identifier",
    );
    return inner ? javaTypeName(inner) : null;
  }
  if (node.type === "array_type") {
    // `Foo[]` → `Foo`; the element type is the `element` field (or first non-`dimensions` child).
    const el = node.childForFieldName("element") ?? node.namedChildren.find((c) => c.type !== "dimensions");
    return el ? javaTypeName(el) : null;
  }
  // Primitive types (`int`, `boolean`, `void`, ...) — keep the keyword; these
  // never resolve to a repo symbol, so the value only goes to callers that
  // ignore non-class types.
  if (node.type === "integral_type" || node.type === "void_type" || node.type === "boolean_type" || node.type === "floating_point_type") {
    return node.text;
  }
  return null;
}

/** Resolve `new Foo()` → `Foo` from a Java `object_creation_expression` value. */
function javaNewTypeName(value: Parser.SyntaxNode | null | undefined): string | null {
  if (value?.type !== "object_creation_expression") return null;
  const typeNode = value.childForFieldName("type");
  return javaTypeName(typeNode);
}
