import type { Chunk } from "../types.js";

/**
 * SPEC-APP.md §7.9: "IF a chunk's source is the live legality policy or
 * ban list THEN THE SYSTEM SHALL exclude it from SFT fact-training data
 * entirely ... and include it only in retrieval-robustness examples marked
 * as time-sensitive." `sources/rules.ts` exports the live Card Legality
 * Policy chunk with chunk_id `rules/legality/<section>` and tag
 * `"legality"` — both are checked so this stays correct even if the tag
 * were ever dropped or the id scheme changed upstream.
 */
export function isLegalityChunk(chunk: Chunk): boolean {
  return chunk.chunk_id.startsWith("rules/legality/") || chunk.tags.includes("legality");
}
