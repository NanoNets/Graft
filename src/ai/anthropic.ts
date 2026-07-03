import Anthropic from "@anthropic-ai/sdk";
import type { Extractor } from "./providers.js";
import type { Extraction } from "../graph/types.js";

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_graph",
  description:
    "Record the entities and relationships extracted from the text as a knowledge graph.",
  input_schema: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        description: "Distinct real-world entities or concepts mentioned in the text.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Canonical, specific name of the entity." },
            type: {
              type: "string",
              description:
                "Coarse category, lowercase, e.g. concept, system, service, api, person, org, policy, tool, event, metric.",
            },
            summary: {
              type: "string",
              description:
                "One or two sentences describing the entity, grounded in the text.",
            },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Alternate names/abbreviations used for this entity.",
            },
          },
          required: ["name", "type", "summary"],
        },
      },
      relations: {
        type: "array",
        description: "Directed relationships between the extracted entities.",
        items: {
          type: "object",
          properties: {
            source: { type: "string", description: "Name of the source entity." },
            target: { type: "string", description: "Name of the target entity." },
            relation: {
              type: "string",
              description:
                "Predicate in snake_case, e.g. depends_on, part_of, authenticates_with, produces, owns, replaces.",
            },
            description: {
              type: "string",
              description: "Short explanation of the relationship.",
            },
          },
          required: ["source", "target", "relation"],
        },
      },
    },
    required: ["entities", "relations"],
  },
};

const SYSTEM_PROMPT = `You are a knowledge-graph extraction engine. Given a passage of text, identify the salient entities/concepts and the relationships between them.

Rules:
- Prefer specific, canonical entity names over pronouns or vague phrases.
- Only include relationships where BOTH endpoints are in your entities list.
- Deduplicate: merge obvious surface-form variants into one entity with aliases.
- Do not invent facts that are not supported by the text.
- Keep summaries concise and factual.
Always respond by calling the record_graph tool.`;

/** Entity/relationship extractor backed by Claude (Anthropic). */
export class AnthropicExtractor implements Extractor {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async extract(text: string, opts?: { hint?: string }): Promise<Extraction> {
    const userContent = opts?.hint
      ? `Context hint: ${opts.hint}\n\nText:\n${text}`
      : `Text:\n${text}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "record_graph" },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) return { entities: [], relations: [] };

    const input = toolUse.input as Partial<Extraction>;
    return {
      entities: (input.entities ?? []).filter((e) => e && e.name && e.type),
      relations: (input.relations ?? []).filter(
        (r) => r && r.source && r.target && r.relation,
      ),
    };
  }
}
