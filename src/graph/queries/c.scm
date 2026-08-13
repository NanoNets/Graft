(struct_specifier name: (type_identifier) @name body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name)) @definition.class

; graft: DEFINITIONS only, never prototypes. The upstream pattern is bare
; `(function_declarator declarator: (identifier) @name)`, which is right for "go to tag"
; and wrong for a dependency graph: `int run(void);` in a header parses as
; (declaration (function_declarator (identifier))) and matches it too. With a header +
; .c pair — i.e. every C project — every function then had TWO nodes of the same name in
; two different files, resolve.ts saw an ambiguous global match and dropped it, and the
; result was that only intra-file calls survived anywhere in the repo.
; Anchoring on function_definition costs the prototypes' nodes, which is the point: the
; definition is the thing calls should land on.
(function_definition
  declarator: (function_declarator declarator: (identifier) @name)) @definition.function

; …and the same through a pointer return type (`char *dup(const char *)`), whose
; declarator field is a pointer_declarator wrapping the function_declarator.
(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator declarator: (identifier) @name))) @definition.function

(type_definition declarator: (type_identifier) @name) @definition.type

(enum_specifier name: (type_identifier) @name) @definition.type

; graft: call sites (upstream c tags.scm is definition-only)
(call_expression
  function: (identifier) @name) @reference.call
