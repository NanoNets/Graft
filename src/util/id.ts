import { randomUUID, createHash } from "node:crypto";

/** Generate a random unique id with a short type prefix, e.g. "node_ab12…". */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Stable content hash (sha256, hex) used for document dedup. */
export function contentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Normalize a name/alias for case- and whitespace-insensitive matching. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
