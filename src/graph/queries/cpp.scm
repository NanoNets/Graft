(struct_specifier name: (type_identifier) @name body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name)) @definition.class

; graft: DEFINITIONS only, never declarations — see the same note in c.scm. A C++
; project declares each method in the header and defines it in the .cpp, so the upstream
; unanchored `function_declarator` patterns minted two nodes per function in two files;
; resolve.ts drops an ambiguous global match, so every cross-file call edge in the
; project disappeared. Anchoring on function_definition keeps one node per function, at
; the place its body actually is.
(function_definition
  declarator: (function_declarator declarator: (identifier) @name)) @definition.function

(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator declarator: (identifier) @name))) @definition.function

; an inline member definition inside a class body (`void draw() { … }`)
(function_definition
  declarator: (function_declarator declarator: (field_identifier) @name)) @definition.method

; the out-of-line definition (`void Widget::draw() { … }`)
(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier scope: (namespace_identifier) @local.scope
                                      name: (identifier) @name))) @definition.method

(type_definition declarator: (type_identifier) @name) @definition.type

(enum_specifier name: (type_identifier) @name) @definition.type

(class_specifier name: (type_identifier) @name) @definition.class

; graft: call sites (upstream cpp tags.scm is definition-only)
(call_expression
  function: [
    (identifier) @name
    (field_expression field: (field_identifier) @name)
    (qualified_identifier name: (identifier) @name)
  ]) @reference.call
