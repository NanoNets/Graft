/**
 * Offline, deterministic test doubles so the whole pipeline runs with no keys,
 * no Ollama, and no network — the same "bring your own components" seam the
 * engine exposes for production (see README → "Bring your own components").
 */
import type { Embedder, Extractor } from "../src/index.js";
import type { Extraction } from "../src/index.js";

/** Deterministic embedder: hashes tokens into a fixed-width, normalized vector. */
export class FakeEmbedder implements Embedder {
  readonly dimensions: number;
  constructor(dimensions = 16) {
    this.dimensions = dimensions;
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vec(t));
  }
  private vec(text: string): number[] {
    const v = new Array(this.dimensions).fill(0);
    for (const tok of text.toLowerCase().split(/\s+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
      v[Math.abs(h) % this.dimensions] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

/**
 * Extractor driven by simple markup so tests fully control the graph shape:
 *   - `[[Entity Name]]` → an entity
 *   - `[[A]] ==relation==> [[B]]` → a relationship
 */
export class BracketExtractor implements Extractor {
  async extract(text: string): Promise<Extraction> {
    const names = new Set<string>();
    for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) names.add(m[1].trim());
    const entities = [...names].map((name) => ({
      name,
      type: "concept",
      summary: `${name} summary`,
    }));
    const relations = [...text.matchAll(/\[\[([^\]]+)\]\]\s*==([a-z_]+)==>\s*\[\[([^\]]+)\]\]/g)].map(
      (m) => ({ source: m[1].trim(), relation: m[2], target: m[3].trim() }),
    );
    return { entities, relations };
  }
}

export function fakeProviders() {
  return { embedder: new FakeEmbedder(), extractor: new BracketExtractor() };
}
