{
  "targets": [
    {
      "target_name": "tree_sitter_hack_binding",
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except",
      ],
      "include_dirs": [ "src" ],
      "sources": [
        "src/parser.c",
        "src/scanner.c",
        "bindings/node/binding.cc",
      ],
      "cflags_c": [ "-std=c99", "-Wno-trigraphs" ],
      "xcode_settings": { "OTHER_CFLAGS": [ "-Wno-trigraphs" ] },
    }
  ]
}
