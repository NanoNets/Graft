#include <napi.h>

typedef struct TSLanguage TSLanguage;

extern "C" TSLanguage *tree_sitter_hack();

// "tree-sitter", "language" hashed with BLAKE2
const napi_type_tag LANGUAGE_TYPE_TAG = {
    0x8AF2E5212AD58ABF, 0xD5006CAD83ABBA16
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    auto hack = Napi::Object::New(env);
    hack["name"] = Napi::String::New(env, "hack");
    auto hack_language = Napi::External<TSLanguage>::New(env, tree_sitter_hack());
    hack_language.TypeTag(&LANGUAGE_TYPE_TAG);
    hack["language"] = hack_language;
    exports["hack"] = hack;
    return exports;
}

NODE_API_MODULE(tree_sitter_hack_binding, Init)
