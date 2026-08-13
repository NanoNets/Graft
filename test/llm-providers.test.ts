/**
 * Config resolution and factory wiring — the layer between "what the user typed"
 * and "which model id goes on the wire". Everything here is env-only and
 * network-free.
 *
 * (The claude-cli half of resolveConfig — auto-detection, credentialProblem —
 * lives in llm-claude-cli.test.ts, next to the adapter it exists for.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, DEFAULT_MODELS } from "../src/ai/providers.js";
import { createChatModel } from "../src/ai/llm/factory.js";

/** Run `fn` with a scrubbed provider environment, restoring it afterwards. */
function withEnv(over: Record<string, string | undefined>, fn: () => void): void {
  const keys = [
    "GRAFT_PROVIDER", "GRAFT_API_KEY", "OPENROUTER_API_KEY", "GRAFT_MODEL",
    "GRAFT_OPENROUTER_MODEL", "GRAFT_BASE_URL", "OPENROUTER_BASE_URL",
    "GRAFT_CLAUDE_BIN", "GRAFT_TIMEOUT_MS", "GRAFT_CLAUDE_TIMEOUT_MS",
    "GRAFT_MAX_RETRIES",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(over)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

// The most obvious setup in the world — an OpenAI key in GRAFT_API_KEY, nothing
// else — used to fail on 100% of calls: the default model carried OpenRouter's
// `vendor/slug` addressing, and api.openai.com answers that with a 404
// model_not_found. Combined with the concept-layer prune, a total failure like
// that also deleted graft/*.md.
test("the default model follows the endpoint: bare id for api.openai.com, vendor/slug for OpenRouter", () => {
  withEnv({ GRAFT_API_KEY: "sk-test" }, () => {
    const c = resolveConfig();
    assert.equal(c.baseUrl, undefined, "no baseUrl means the SDK talks to api.openai.com");
    assert.equal(c.model, "gpt-4o-mini");
    assert.doesNotMatch(c.model, /\//, "a vendor/slug id is a 404 on api.openai.com");
  });

  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_BASE_URL: "https://openrouter.ai/api/v1" }, () => {
    const c = resolveConfig();
    assert.equal(c.model, "openai/gpt-4o-mini", "OpenRouter addresses the same model by vendor/slug");
    assert.deepEqual(c.headers, { "X-Title": "graft" });
  });

  // The legacy key implies OpenRouter, so it must imply OpenRouter's id form too.
  withEnv({ OPENROUTER_API_KEY: "sk-legacy" }, () => {
    const c = resolveConfig();
    assert.equal(c.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(c.model, "openai/gpt-4o-mini");
  });
});

test("an explicit GRAFT_MODEL is never second-guessed, whatever the endpoint", () => {
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_MODEL: "openai/gpt-4o-mini" }, () => {
    assert.equal(resolveConfig().model, "openai/gpt-4o-mini");
  });
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_BASE_URL: "https://openrouter.ai/api/v1", GRAFT_MODEL: "qwen-3" }, () => {
    assert.equal(resolveConfig().model, "qwen-3");
  });
});

// A cast let a typo through the entire resolution: model became `undefined`
// (despite ResolvedConfig.model: string), the manifest recorded "gemini:undefined",
// and the only complaint came from the factory's exhaustiveness guard — which
// names neither the variable nor the legal values.
test("an unknown GRAFT_PROVIDER fails immediately, naming the variable and the way out", () => {
  withEnv({ GRAFT_PROVIDER: "gemini", GRAFT_API_KEY: "sk-test" }, () => {
    assert.throws(() => resolveConfig(), (err: Error) => {
      assert.match(err.message, /GRAFT_PROVIDER="gemini"/);
      assert.match(err.message, /openai/, "lists the values that do work");
      assert.match(err.message, /GRAFT_BASE_URL/, "and points at the actual fix for Gemini/Groq/local servers");
      return true;
    });
  });
  // `GRAFT_PROVIDER=` in a .env is "unset", not a typo.
  withEnv({ GRAFT_PROVIDER: "", GRAFT_API_KEY: "sk-test" }, () => {
    assert.equal(resolveConfig().provider, "openai");
  });
  // Every legal value still resolves, and each gets its own default model.
  for (const provider of ["openai", "anthropic", "claude-cli"] as const) {
    withEnv({ GRAFT_PROVIDER: provider, GRAFT_API_KEY: "sk-test" }, () => {
      assert.equal(resolveConfig().provider, provider);
      assert.equal(resolveConfig().model, DEFAULT_MODELS[provider]);
    });
  }
});

test("GRAFT_TIMEOUT_MS applies to every provider, with the claude-specific name still winning", () => {
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_TIMEOUT_MS: "30000" }, () => {
    assert.equal(resolveConfig().timeoutMs, 30_000);
  });
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_TIMEOUT_MS: "30000", GRAFT_CLAUDE_TIMEOUT_MS: "600000" }, () => {
    assert.equal(resolveConfig().timeoutMs, 600_000, "a setup that already tuned the specific knob keeps its value");
  });
});

test("GRAFT_MAX_RETRIES is honoured, and 0 means zero rather than 'unset'", () => {
  // The right number is a property of the endpoint: a rate-limited key wants more
  // (each retry waits out the Retry-After), a local server that isn't running wants
  // none. Neither was expressible — the SDK default was the only value there was.
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_MAX_RETRIES: "6" }, () => {
    assert.equal(resolveConfig().maxRetries, 6);
  });
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_MAX_RETRIES: "0" }, () => {
    // The trap this exists for: the shared `numeric` parser drops 0 as falsy, which
    // is right for a budget or a timeout and exactly wrong here.
    assert.equal(resolveConfig().maxRetries, 0, "0 retries is a setting, not an unset value");
  });
  // Junk and negatives fall back to the SDK default rather than becoming NaN.
  for (const bad of ["", "many", "-1", "1.5"]) {
    withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_MAX_RETRIES: bad }, () => {
      assert.equal(resolveConfig().maxRetries, undefined, bad);
    });
  }
  // An explicit config value still wins over the environment.
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_MAX_RETRIES: "6" }, () => {
    assert.equal(resolveConfig({ maxRetries: 1 }).maxRetries, 1);
  });
});

/** The SDK's own record of its constructor options — see llm-adapters.test.ts. */
function sdkOptions(model: unknown): Record<string, unknown> {
  return (model as { client: { _options: Record<string, unknown> } }).client._options;
}

test("createChatModel hands headers to the anthropic adapter too, not just openai", () => {
  const headers = { "X-Tenant": "graft" };
  const anthropic = createChatModel({
    provider: "anthropic", apiKey: "x", model: "claude-x",
    baseUrl: "https://gateway.internal/v1", headers, timeoutMs: 20_000,
  });
  assert.deepEqual(sdkOptions(anthropic).defaultHeaders, headers);
  assert.equal(sdkOptions(anthropic).timeout, 20_000);

  const openai = createChatModel({ provider: "openai", apiKey: "x", model: "gpt-x", headers, timeoutMs: 20_000 });
  assert.deepEqual(sdkOptions(openai).defaultHeaders, headers);
  assert.equal(sdkOptions(openai).timeout, 20_000);
});

test("createChatModel forwards maxRetries to both SDK adapters, 0 included", () => {
  for (const provider of ["openai", "anthropic"] as const) {
    const m = createChatModel({ provider, apiKey: "x", model: "m", maxRetries: 5 });
    assert.equal(sdkOptions(m).maxRetries, 5, provider);
    // 0 must reach the SDK as 0, not be swallowed as "nothing was configured" —
    // this is the value that says "don't retry a server that isn't there".
    const none = createChatModel({ provider, apiKey: "x", model: "m", maxRetries: 0 });
    assert.equal(sdkOptions(none).maxRetries, 0, provider);
    // Unset stays unset, so the SDK's own default keeps applying.
    const dflt = createChatModel({ provider, apiKey: "x", model: "m" });
    assert.equal(sdkOptions(dflt).maxRetries, undefined, provider);
  }
});
