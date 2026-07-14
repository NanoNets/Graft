/**
 * The synthesis step: turn per-file prose summaries into a CURATED set of graph
 * nodes. This is where granularity is decided — the model groups related files
 * into subsystem nodes, keeps a notable file as its own node when it deserves
 * one, and adds cross-cutting concept nodes, instead of emitting one entity per
 * incidental identifier. Each node is attributed to the source files it is
 * grounded in, so provenance (and staleness) stays exact.
 */
import OpenAI from "openai";

/** A directed edge to another node, by node name (resolved to a slug later). */
export interface SynthLink {
  to: string;
  relation: string;
  description?: string;
}

/** A node as proposed by the synthesizer, before it is written to disk. */
export interface SynthNode {
  name: string;
  /** system | api | file | concept */
  type: string;
  summary: string;
  /** Source file paths (from the provided set) this node is grounded in. */
  sources: string[];
  links: SynthLink[];
}

/** One labeled file summary fed into synthesis. */
export interface FileSummary {
  path: string;
  summary: string;
}

export interface Synthesizer {
  synthesize(files: FileSummary[]): Promise<SynthNode[]>;
}

const SYSTEM_PROMPT = `You build an ARCHITECTURE graph of a codebase from per-file summaries. The reader is an AI agent that will read this graph before working on the code, so it must describe the system at the level a senior engineer would explain it — not file by file.

Produce a CURATED set of nodes of mixed granularity:
- "system" nodes: GROUP files that collaborate as one component (usually a directory or a cohesive set) into a SINGLE node. This should be the most common node type. Prefer one system node over several file nodes.
- "file" nodes: only for a substantial, standalone module that genuinely deserves its own node apart from its system.
- "concept" nodes: cross-cutting ideas, design decisions, or invariants that span multiple files (e.g. "local-first provider fallback", "staleness checking", "content-hash provenance"). Include several — they are the most valuable nodes for an agent.

Rules:
- Strongly prefer FEWER, larger, meaningful nodes. For a repo of N files, aim for well under N nodes. Do NOT emit one node per file, and never a node per incidental identifier (a local interface, helper, or third-party symbol).
- Merge duplicates and surface-form variants into one node.
- For each node give: a canonical human-readable name; a type ("system" | "file" | "concept"); a 1-3 sentence summary of its ROLE in the system; "sources" = the exact file paths (from the input) it is grounded in (a system lists all its files; a concept lists the files that motivate it); and "links" to other nodes you define, each with a snake_case relation (depends_on, part_of, uses, implements, produces) and a short description.
- Only link to nodes you actually define in this response.
Respond only via the record_graph tool / JSON schema.`;

const NODES_SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          summary: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
          links: {
            type: "array",
            items: {
              type: "object",
              properties: {
                to: { type: "string" },
                relation: { type: "string" },
                description: { type: "string" },
              },
              required: ["to", "relation"],
            },
          },
        },
        required: ["name", "type", "summary", "sources"],
      },
    },
  },
  required: ["nodes"],
} as const;

/** Cap the total summary text sent in one call so it never blows the context. */
const MAX_INPUT_CHARS = 60_000;

function userContent(files: FileSummary[]): string {
  const body = files.map((f) => `## ${f.path}\n\n${f.summary}`).join("\n\n");
  return body.length > MAX_INPUT_CHARS
    ? `${body.slice(0, MAX_INPUT_CHARS)}\n… (truncated)`
    : body;
}

/** Normalize a raw model response into clean {@link SynthNode}s. */
function clean(nodes: unknown): SynthNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: SynthNode[] = [];
  for (const n of nodes as Array<Record<string, unknown>>) {
    if (!n || typeof n.name !== "string" || typeof n.type !== "string") continue;
    out.push({
      name: n.name,
      type: n.type,
      summary: typeof n.summary === "string" ? n.summary : "",
      sources: Array.isArray(n.sources) ? (n.sources as unknown[]).filter((s): s is string => typeof s === "string") : [],
      links: Array.isArray(n.links)
        ? (n.links as Array<Record<string, unknown>>)
            .filter((l) => l && typeof l.to === "string" && typeof l.relation === "string")
            .map((l) => ({
              to: l.to as string,
              relation: l.relation as string,
              description: typeof l.description === "string" ? l.description : undefined,
            }))
        : [],
    });
  }
  return out;
}

const RECORD_TOOL = {
  type: "function" as const,
  function: {
    name: "record_graph",
    description: "Record the curated architecture-graph nodes and their links.",
    parameters: NODES_SCHEMA,
  },
};

/** Synthesizer backed by OpenRouter's OpenAI-compatible chat API (tool calling). */
export class OpenRouterSynthesizer implements Synthesizer {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl = "https://openrouter.ai/api/v1") {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl, defaultHeaders: { "X-Title": "Context Graph Engine" } });
    this.model = model;
  }

  async synthesize(files: FileSummary[]): Promise<SynthNode[]> {
    if (files.length === 0) return [];
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      tools: [RECORD_TOOL],
      tool_choice: { type: "function", function: { name: "record_graph" } },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent(files) },
      ],
    });
    const call = response.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== "function") return [];
    try {
      return clean((JSON.parse(call.function.arguments) as { nodes?: unknown }).nodes);
    } catch {
      return [];
    }
  }
}

