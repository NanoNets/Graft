; Emacs Lisp — the grammar exposes dedicated node types for common defining
; forms. `defun`/`defsubst` and `defvar`/`defconst` use `function_definition`
; and `special_form` nodes with terminal keyword children; `defmacro`,
; `defcustom`, and others are plain `list` forms headed by a `symbol`.

; Definitions

; * defun / defsubst
(function_definition name: (symbol) @name) @definition.function

; * defmacro
(macro_definition name: (symbol) @name) @definition.function

; * defvar / defconst — special_form nodes with terminal keyword children
(special_form "defvar" (symbol) @name) @definition.variable
(special_form "defconst" (symbol) @name) @definition.variable

; * defcustom / defvar-local / defvar-keymap — list forms headed by a symbol
(list
  .
  (symbol) @_kw
  .
  (symbol) @name
  (#any-of? @_kw "defcustom" "defvar-local" "defvar-keymap")) @definition.variable

; * defface
(list
  .
  (symbol) @_kw
  .
  (symbol) @name
  (#eq? @_kw "defface")) @definition.variable

; References

; * function calls — any list headed by a symbol
(list . (symbol) @name) @reference.call
