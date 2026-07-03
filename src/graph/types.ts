/**
 * Core data model for the context graph.
 *
 * The graph has three primary record kinds:
 *  - {@link GraphNode}  — an entity or concept ("what things are")
 *  - {@link GraphEdge}  — a typed relationship between two nodes ("how things relate")
 *  - {@link Chunk}      — a passage of source text that grounds nodes/edges in evidence
 *
 * Nodes and edges carry a `confidence` and `observations` count. Every time an
 * agent re-observes the same fact, `observations` is incremented and confidence
 * is reinforced — this is what lets the graph "get smarter over time".
 */

/** A source document that was ingested into the graph. */
export interface GraphDocument {
  id: string;
  /** Human-readable title. */
  title: string;
  /** Where this came from: a file path, URL, or free-form label. */
  source: string;
  /** Content hash, used to skip re-ingesting identical documents. */
  hash: string;
  createdAt: string;
}

/** An entity or concept in the graph. */
export interface GraphNode {
  id: string;
  /** Canonical display name, e.g. "OAuth 2.0". */
  name: string;
  /** Coarse category, e.g. "concept", "system", "person", "api", "policy". */
  type: string;
  /** A short natural-language description of the node, synthesized from evidence. */
  summary: string;
  /** Alternate names / surface forms that map to this node. */
  aliases: string[];
  /** 0..1 confidence that this node is real and correctly described. */
  confidence: number;
  /** How many times this entity has been observed across ingests/contributions. */
  observations: number;
  /** Vector embedding of `name + summary`, used for semantic matching & dedup. */
  embedding?: number[];
  /** Where this knowledge came from (document ids, agent ids). */
  provenance: string[];
  createdAt: string;
  updatedAt: string;
}

/** A directed, typed relationship between two nodes. */
export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** The predicate, e.g. "depends_on", "authenticates_with", "part_of". */
  relation: string;
  /** Optional natural-language description of the relationship. */
  description: string;
  confidence: number;
  observations: number;
  provenance: string[];
  createdAt: string;
  updatedAt: string;
}

/** A passage of source text, used as retrieval evidence. */
export interface Chunk {
  id: string;
  documentId: string;
  /** Ordinal position within the document. */
  ordinal: number;
  text: string;
  embedding?: number[];
  createdAt: string;
}

/** A single extracted entity, before it is merged into the graph. */
export interface ExtractedEntity {
  name: string;
  type: string;
  summary: string;
  aliases?: string[];
}

/** A single extracted relationship, before it is merged into the graph. */
export interface ExtractedRelation {
  source: string;
  target: string;
  relation: string;
  description?: string;
}

/** The result of running extraction over a piece of text. */
export interface Extraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

/** A node returned from retrieval, annotated with why it was surfaced. */
export interface RetrievedNode extends GraphNode {
  /** Relevance score in 0..1 (semantic similarity or traversal-derived). */
  score: number;
  /** How this node entered the result: direct semantic hit, or graph expansion. */
  via: "semantic" | "expanded";
}

/** A chunk returned from retrieval. */
export interface RetrievedChunk extends Chunk {
  score: number;
  documentTitle: string;
}

/** The structured context bundle an agent reads before doing work. */
export interface ContextBundle {
  query: string;
  /** Entities relevant to the query, most-relevant first. */
  nodes: RetrievedNode[];
  /** Relationships connecting the surfaced nodes. */
  edges: GraphEdge[];
  /** Supporting source passages. */
  chunks: RetrievedChunk[];
  /** A ready-to-inject, human/LLM-readable rendering of the above. */
  prompt: string;
}

/** Summary counts describing the current graph. */
export interface GraphStats {
  documents: number;
  nodes: number;
  edges: number;
  chunks: number;
}
