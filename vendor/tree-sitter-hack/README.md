# tree-sitter-hack (vendored)

A tree-sitter grammar for [Hack](https://hacklang.org/) (Hacklang), vendored so
Graft can index `.hack`/`.hhi` files at the depth tier (`src/graph/extract.ts`).

## Why vendored, not an npm dependency

The grammar sources (`src/parser.c`, `src/scanner.c`, `src/node-types.json`,
`src/tree_sitter/parser.h`) come from the upstream Hack grammar
(`slackhq/tree-sitter-hack`, published as `tree-sitter-hacklang`). Its node
binding is `nan`-based (built with `tree-sitter-cli ~0.20.6`): it stashes the
raw `TSLanguage*` in a V8 internal field with no `napi_type_tag`. Graft pins
`tree-sitter@0.21.1`, whose native binding validates a `napi_type_tag` on the
language `External` and rejects the untagged `nan` object ("Invalid language
object"). So `bindings/node/binding.cc` here is re-bound with `node-addon-api`
(see `LANGUAGE_TYPE_TAG`) to produce a language object 0.21 accepts — the one
change from upstream. `LANGUAGE_VERSION` is 13, inside 0.21's
supported 13–14 range, and tagless `.hack` parses natively (no `<?hh` shim).

## Build

`npm install` runs the `install: node-gyp rebuild` script, compiling
`parser.c` + `scanner.c` + `binding.cc` into
`build/Release/tree_sitter_hack_binding.node`. `build/` and `node_modules/` are
git-ignored — they are regenerated on every install. `bindings/node/index.js`
loads the built addon and attaches `nodeTypeInfo` from `src/node-types.json`.

## Regenerating the parser

`src/parser.c` is generated, not hand-written — do not edit it. To update the
grammar, regenerate upstream (`tree-sitter generate`) and re-copy the `src/`
artifacts here, keeping `bindings/node/binding.cc` as-is.
