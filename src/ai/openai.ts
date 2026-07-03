import OpenAI from "openai";
import type { Embedder } from "./providers.js";

/** Known output dimensionality for OpenAI embedding models. */
const MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

/** Embedder backed by the OpenAI embeddings API. */
export class OpenAIEmbedder implements Embedder {
  readonly dimensions: number;
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = MODEL_DIMENSIONS[model] ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // The API accepts batches; empty strings are not allowed, so guard them.
    const inputs = texts.map((t) => (t.trim().length === 0 ? " " : t));
    const response = await this.client.embeddings.create({
      model: this.model,
      input: inputs,
    });
    // Responses are returned in input order, but sort by index to be safe.
    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding as number[]);
  }
}
