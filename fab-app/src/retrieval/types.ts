// On-device retrieval engine (SPEC-APP.md §9.7): hybrid seeding (lexical ∪
// semantic) → bounded-hop link expansion → activation-ranked selection
// within the token budget. Mirrors the identity-brain recall architecture
// (the spec-workflow plugin's brain.py: seed → hop-expand along typed
// links with decay, keeping the max activation per note → rank + greedily
// fill a budget).
//
// Every dependency below is an injectable interface so retrieval logic is
// fully unit-testable with in-memory fakes (see __tests__/testDoubles.ts).
// The op-sqlite-backed SqliteVecStore and a real on-device Embedder are
// thin adapters that land with device wiring — out of scope here, per
// §9.7: "the op-sqlite-backed implementation is a thin adapter
// (integration-testable later on device)".

export type SeedStage = "lexical" | "semantic";
export type ChunkStage = SeedStage | "link";

export interface ChunkLink {
  targetId: string;
  /** Multiplies the decayed activation on top of `hopDecay` (§9.7's
   * "activation decay per hop"). */
  weight: number;
}

export interface ChunkRecord {
  id: string;
  text: string;
  /** Lowercase tags for exact tag matching (§9.7 "lexical exact/tag
   * match"). */
  tags: string[];
  /** Lowercase card names this chunk is about — exact-name lexical
   * matching, and (later, §10.8) pinning a resolved card's chunk(s) into
   * the retrieved set. */
  cardNames: string[];
  links: ChunkLink[];
  source: { document: string; section?: string; url: string };
}

/** The knowledge-pack-backed chunk corpus. `all()` is used once, at load
 * time, to build the lexical index; `getById()` is the hot path used
 * throughout seeding/expansion/ranking. */
export interface ChunkCorpus {
  getById(id: string): ChunkRecord | undefined;
  all(): Iterable<ChunkRecord>;
}

export interface VectorNeighbor {
  chunkId: string;
  /** Similarity score, higher is closer. No fixed range is assumed by the
   * retrieval logic itself — only the manifest-calibrated floors compare
   * against it directly. */
  score: number;
}

export interface Embedder {
  embed(text: string): number[] | Promise<number[]>;
}

/** sqlite-vec-backed nearest-neighbor lookup, abstracted per §9.7. */
export interface SqliteVecStore {
  topKNeighbors(queryVector: number[], k: number): VectorNeighbor[] | Promise<VectorNeighbor[]>;
}

export interface RetrievalConfig {
  /** Top-K embedding neighbors unioned into the seed set. */
  semanticK: number;
  /** Bounded-hop link expansion depth (§9.7). */
  maxHops: number;
  /** Multiplicative activation decay applied per hop, on top of each
   * link's own weight. */
  hopDecay: number;
  /** §14 default retrieval token budget: 1,024 tokens of retrieved
   * context (config-tunable). */
  tokenBudget: number;
  /** chars/4 token-estimation heuristic (§14; exact tokenizer later). */
  charsPerToken: number;
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  semanticK: 8,
  maxHops: 2,
  hopDecay: 0.5,
  tokenBudget: 1024,
  charsPerToken: 4,
};

/** One chunk's activation after seeding and/or link expansion, keyed by
 * chunk id, before ranking/budget clipping. */
export interface ActivatedChunk {
  chunkId: string;
  activation: number;
  stage: ChunkStage;
}

export interface RankedChunk {
  chunk: ChunkRecord;
  activation: number;
  /** Which stage seeded this chunk (lexical/semantic/link) — surfaced for
   * the two-stage UI per §9.7/§10.1. */
  stage: ChunkStage;
  estimatedTokens: number;
}

export interface LexicalSeedResult {
  chunkIds: string[];
  /** True iff at least one hit came from an exact card-name match (as
   * opposed to only a tag match) — feeds the §10.9 OOD "no card-name
   * match" conjunct. */
  cardNameMatched: boolean;
}

export interface RetrievalFloors {
  /** §9.7/§10.4 calibrated abstention floor, read from the active
   * knowledge-pack manifest — never hardcoded. */
  retrievalFloor: number;
  /** §10.9 calibrated OOD fast-path threshold, "well below the abstention
   * floor" — also read from the manifest. */
  oodThreshold: number;
}

export interface RetrievalResult {
  chunks: RankedChunk[];
  usedTokens: number;
  /** §10.4: top-ranked activation fell below the calibrated retrieval
   * floor — "not clearly settled" + judge-escalation path. */
  belowFloor: boolean;
  /** §10.9: the strict three-conjunct OOD fast-refusal trigger fired. */
  oodFastRefusal: boolean;
}
