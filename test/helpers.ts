/**
 * Offline, deterministic test doubles so the pipeline runs with no keys, no
 * Ollama, and no network — the same "bring your own components" seam the engine
 * exposes via EngineConfig.summarizer / .synthesizer.
 */
import type { Summarizer, Synthesizer, SynthNode, SynthLink, FileSummary } from "../src/index.js";

/** Summarizer that passes the source through unchanged, so tests control the text. */
export class PassthroughSummarizer implements Summarizer {
  async summarize(code: string): Promise<string> {
    return code;
  }
}

/**
 * Synthesizer driven by simple markup so tests fully control the graph shape:
 *   - `[[Node Name]]` → a node grounded in the file it appears in
 *   - `[[A]] ==relation==> [[B]]` → an edge A→B
 * Nodes are merged by name across the provided files (union of source files).
 */
export class BracketSynthesizer implements Synthesizer {
  async synthesize(files: FileSummary[]): Promise<SynthNode[]> {
    const byName = new Map<string, { sources: Set<string>; links: Map<string, SynthLink> }>();
    const ensure = (name: string) => {
      let e = byName.get(name);
      if (!e) {
        e = { sources: new Set(), links: new Map() };
        byName.set(name, e);
      }
      return e;
    };
    for (const f of files) {
      for (const m of f.summary.matchAll(/\[\[([^\]]+)\]\]/g)) {
        ensure(m[1].trim()).sources.add(f.path);
      }
      for (const m of f.summary.matchAll(/\[\[([^\]]+)\]\]\s*==([a-z_]+)==>\s*\[\[([^\]]+)\]\]/g)) {
        const [, from, relation, to] = m;
        ensure(to.trim()).sources.add(f.path);
        ensure(from.trim()).links.set(`${to}|${relation}`, { to: to.trim(), relation });
      }
    }
    return [...byName].map(([name, e]) => ({
      name,
      type: "concept",
      summary: `${name} summary`,
      sources: [...e.sources],
      links: [...e.links.values()],
    }));
  }
}

export function fakeProviders() {
  return { summarizer: new PassthroughSummarizer(), synthesizer: new BracketSynthesizer() };
}
