// Shared in-memory fakes for the retrieval-engine test suite (APP-033,
// SPEC-APP.md §9.7). No real op-sqlite/sqlite-vec call or real embedding
// model runs anywhere in here — everything is a deterministic, inspectable
// stand-in for the injectable interfaces in ../types.ts, mirroring
// fab-app/src/artifacts/__tests__/testDoubles.ts's role for that module.
//
// This file intentionally contains no fab-app runtime/production logic —
// it exists to make the *.test.ts files in this directory runnable.

import type { ChunkCorpus, ChunkRecord, Embedder, SqliteVecStore, VectorNeighbor } from "../types";

export class InMemoryChunkCorpus implements ChunkCorpus {
  private readonly byId = new Map<string, ChunkRecord>();

  constructor(chunks: ChunkRecord[]) {
    for (const record of chunks) this.byId.set(record.id, record);
  }

  getById(id: string): ChunkRecord | undefined {
    return this.byId.get(id);
  }

  all(): Iterable<ChunkRecord> {
    return this.byId.values();
  }
}

/** Returns a fixed neighbor list regardless of the query vector — full,
 * explicit control for unit tests that aren't exercising real similarity
 * math (see LinearScanVectorStore below for that, used only by the perf
 * fixture). */
export class StaticVectorStore implements SqliteVecStore {
  constructor(private readonly neighbors: VectorNeighbor[]) {}

  topKNeighbors(_queryVector: number[], k: number): VectorNeighbor[] {
    return this.neighbors.slice(0, k);
  }
}

export class StaticEmbedder implements Embedder {
  constructor(private readonly vector: number[] = [1]) {}

  embed(_text: string): number[] {
    return this.vector;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Real cosine-similarity KNN over an in-memory Map<chunkId, vector> — used
 * by the §9.7 perf fixture to give the "in-memory store" number real
 * computational cost (a linear scan), rather than an instant canned
 * answer. The op-sqlite/sqlite-vec on-device number is a separate, later
 * measurement (APP-024's device-benchmark protocol) — this only bounds
 * the JS-side algorithm's own cost. */
export class LinearScanVectorStore implements SqliteVecStore {
  constructor(private readonly vectors: Map<string, number[]>) {}

  topKNeighbors(queryVector: number[], k: number): VectorNeighbor[] {
    const scored: VectorNeighbor[] = [];
    for (const [chunkId, vector] of this.vectors) {
      scored.push({ chunkId, score: cosineSimilarity(queryVector, vector) });
    }
    scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    return scored.slice(0, k);
  }
}

function hashToken(token: string): number {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    // eslint-disable-next-line no-bitwise -- int32 overflow wrap, intrinsic to this hash
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic bag-of-words hashing embedder — the same text always
 * yields the same vector, and texts sharing words end up closer under
 * cosine similarity. Good enough to exercise the seeding/perf code paths
 * without a real model; not a quality claim about retrieval relevance. */
export class HashingBagOfWordsEmbedder implements Embedder {
  constructor(private readonly dims = 64) {}

  embed(text: string): number[] {
    const vector = new Array(this.dims).fill(0);
    for (const token of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      vector[hashToken(token) % this.dims] += 1;
    }
    return vector;
  }
}

export function chunk(overrides: Partial<ChunkRecord> & { id: string }): ChunkRecord {
  return {
    text: `text for ${overrides.id}`,
    tags: [],
    cardNames: [],
    links: [],
    source: { document: "test", url: `https://example.test/${overrides.id}` },
    ...overrides,
  };
}
