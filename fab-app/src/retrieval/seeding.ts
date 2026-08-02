import type { ActivatedChunk, ChunkCorpus, Embedder, RetrievalConfig, SqliteVecStore } from "./types";
import type { LexicalIndex } from "./lexicalIndex";

export interface SeedResult {
  activation: Map<string, ActivatedChunk>;
  /** §10.9 OOD conjunct input: true iff a lexical hit came from an exact
   * card-name match. */
  cardNameMatched: boolean;
  /** §10.9 OOD conjunct input: count of lexical/tag hits (before the
   * corpus-membership filter below). */
  lexicalHitCount: number;
}

/**
 * Hybrid seeding (§9.7): lexical exact/tag match ∪ top-K sqlite-vec
 * neighbors. When a chunk is hit by both, the HIGHER activation wins (and
 * its stage attribution follows the winner) — mirrors the identity-brain
 * recall algorithm's `if act > activation.get(slug, 0)` max-per-note rule.
 * Lexical hits are fixed at activation 1.0 (an exact match is maximally
 * confident, no embedding involved), so in practice lexical wins any
 * overlap with a semantic neighbor whose similarity score is < 1.0.
 */
export async function hybridSeed(
  query: string,
  lexicalIndex: LexicalIndex,
  vectorStore: SqliteVecStore,
  embedder: Embedder,
  corpus: ChunkCorpus,
  config: RetrievalConfig,
): Promise<SeedResult> {
  const activation = new Map<string, ActivatedChunk>();

  const setIfHigher = (chunkId: string, candidateActivation: number, stage: "lexical" | "semantic") => {
    const existing = activation.get(chunkId);
    if (!existing || candidateActivation > existing.activation) {
      activation.set(chunkId, { chunkId, activation: candidateActivation, stage });
    }
  };

  const lexicalResult = lexicalIndex.search(query);
  for (const chunkId of lexicalResult.chunkIds) {
    if (!corpus.getById(chunkId)) continue;
    setIfHigher(chunkId, 1.0, "lexical");
  }

  const queryVector = await embedder.embed(query);
  const neighbors = await vectorStore.topKNeighbors(queryVector, config.semanticK);
  for (const { chunkId, score } of neighbors) {
    if (!corpus.getById(chunkId)) continue;
    setIfHigher(chunkId, score, "semantic");
  }

  return {
    activation,
    cardNameMatched: lexicalResult.cardNameMatched,
    lexicalHitCount: lexicalResult.chunkIds.length,
  };
}
