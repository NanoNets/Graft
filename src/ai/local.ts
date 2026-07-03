/**
 * Local, key-free providers so the engine runs entirely on the user's machine.
 *
 *  - {@link LocalEmbedder} embeds text in-process with a small ONNX model via
 *    transformers.js — no server, no API key, models cached to disk on first use.
 *  - {@link OllamaExtractor} extracts entities/relationships from a locally
 *    running Ollama (https://ollama.com) using its structured-output support.
 *
 * These are what the engine falls back to when no cloud API keys are present,
 * making `curl | sh` → "just works" possible without any accounts.
 */
import type { Embedder, Extractor } from "./providers.js";
import type { Extraction } from "../graph/types.js";

/** Output dimensionality for known local embedding models. */
const LOCAL_MODEL_DIMENSIONS: Record<string, number> = {
  "Xenova/all-MiniLM-L6-v2": 384,
  "Xenova/all-MiniLM-L12-v2": 384,
  "Xenova/bge-small-en-v1.5": 384,
  "Xenova/bge-base-en-v1.5": 768,
  "Xenova/gte-small": 384,
};

// transformers.js is loaded lazily so importing the engine never pays the cost
// (or the native onnxruntime dependency) unless local embeddings are used.
type FeaturePipeline = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Embedder that runs a sentence-transformer model in-process via transformers.js.
 * The model is downloaded once and cached under the transformers.js cache dir.
 */
export class LocalEmbedder implements Embedder {
  readonly dimensions: number;
  private model: string;
  private pipe?: Promise<FeaturePipeline>;

  constructor(model = "Xenova/all-MiniLM-L6-v2") {
    this.model = model;
    this.dimensions = LOCAL_MODEL_DIMENSIONS[model] ?? 384;
  }

  private load(): Promise<FeaturePipeline> {
    if (!this.pipe) {
      this.pipe = import("@huggingface/transformers").then(({ pipeline, env }) => {
        // Keep console noise down; models still download+cache on first use.
        env.allowRemoteModels = true;
        return pipeline("feature-extraction", this.model) as unknown as Promise<FeaturePipeline>;
      });
    }
    return this.pipe;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const pipe = await this.load();
    // Empty strings produce degenerate vectors; substitute a space.
    const inputs = texts.map((t) => (t.trim().length === 0 ? " " : t));
    const out = await pipe(inputs, { pooling: "mean", normalize: true });
    return out.tolist();
  }
}

/** JSON schema describing the extraction output — shared shape with the cloud extractor. */
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          summary: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
        },
        required: ["name", "type", "summary"],
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          relation: { type: "string" },
          description: { type: "string" },
        },
        required: ["source", "target", "relation"],
      },
    },
  },
  required: ["entities", "relations"],
} as const;

const SYSTEM_PROMPT = `You are a knowledge-graph extraction engine. Given a passage of text, identify the salient entities/concepts and the relationships between them.

Rules:
- Prefer specific, canonical entity names over pronouns or vague phrases.
- Use coarse lowercase entity types, e.g. concept, system, service, api, person, org, policy, tool, event, metric.
- Use snake_case relation predicates, e.g. depends_on, part_of, authenticates_with, produces, owns, replaces.
- Only include relationships where BOTH endpoints are in your entities list.
- Deduplicate obvious surface-form variants into one entity with aliases.
- Do not invent facts unsupported by the text.
Respond ONLY with a JSON object matching the schema.`;

/**
 * Entity/relationship extractor backed by a locally running Ollama instance.
 * Uses Ollama's structured-output (`format`) support to get schema-valid JSON.
 */
export class OllamaExtractor implements Extractor {
  private baseUrl: string;
  private model: string;

  constructor(model = "llama3.2", baseUrl = "http://localhost:11434") {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async extract(text: string, opts?: { hint?: string }): Promise<Extraction> {
    const userContent = opts?.hint
      ? `Context hint: ${opts.hint}\n\nText:\n${text}`
      : `Text:\n${text}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: EXTRACTION_SCHEMA,
          options: { temperature: 0 },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        }),
      });
    } catch (err) {
      throw new Error(
        `Could not reach Ollama at ${this.baseUrl}. Start it (https://ollama.com) and pull a model ` +
          `(e.g. \`ollama pull ${this.model}\`), or set ANTHROPIC_API_KEY to use cloud extraction. ` +
          `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404) {
        throw new Error(
          `Ollama has no model "${this.model}". Run \`ollama pull ${this.model}\`, or set ` +
            `CONTEXT_GRAPH_OLLAMA_MODEL to a model you have.`,
        );
      }
      throw new Error(`Ollama returned ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content ?? "";
    let parsed: Partial<Extraction>;
    try {
      parsed = JSON.parse(content) as Partial<Extraction>;
    } catch {
      return { entities: [], relations: [] };
    }

    return {
      entities: (parsed.entities ?? []).filter((e) => e && e.name && e.type),
      relations: (parsed.relations ?? []).filter(
        (r) => r && r.source && r.target && r.relation,
      ),
    };
  }
}
