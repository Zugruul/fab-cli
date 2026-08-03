/**
 * APP-085 (SPEC-APP.md §8.8, §4 Glossary "Knowledge pack" / "Printing-id
 * registry" / "Delta pack"; issue #142): shared types for the
 * knowledge-pack builder.
 */
import type { Chunk } from "../types.js";
export type { Chunk };

/** One text-chunk's embedding vector, keyed by the chunk_id it was
 * computed for. The vector itself is opaque to this pipeline — produced
 * out-of-repo by whatever process ran the embedder (see
 * textEmbeddingsInput.ts's doc comment: no local text embedder is
 * runnable in this repo today). */
export interface TextEmbeddingRecord {
  chunkId: string;
  vector: number[];
}

/** A real, loaded text-embeddings input file — every record shares the
 * SAME `embedderVersion` and vector `dim` (mixed files are refused at
 * load time, see textEmbeddingsInput.ts). */
export interface TextEmbeddingsProvided {
  provided: true;
  embedderVersion: string;
  records: Map<string, TextEmbeddingRecord>;
  dim: number;
}

/** The honest, first-class "no embeddings yet" state — never a fabricated
 * vector, never a silently-defaulted version string. */
export interface TextEmbeddingsAbsent {
  provided: false;
  embedderVersion: string;
  reason: string;
}

export type TextEmbeddingsResult = TextEmbeddingsProvided | TextEmbeddingsAbsent;

/** One printing's image/recognition embedding vector, keyed by printingId
 * (the-fab-cube's `unique_id` — see pipeline/src/images/catalog.ts's doc
 * comment for why that identifier, not the human-readable print code, is
 * the safe per-image key). */
export interface ImageEmbeddingRecord {
  printingId: string;
  vector: number[];
}

export interface ImageEmbeddingsProvided {
  provided: true;
  embedderVersion: string;
  records: Map<string, ImageEmbeddingRecord>;
  dim: number;
}

export interface ImageEmbeddingsAbsent {
  provided: false;
  embedderVersion: string;
  reason: string;
}

export type ImageEmbeddingsResult = ImageEmbeddingsProvided | ImageEmbeddingsAbsent;

/** One printing's entry in the append-only registry (SPEC-APP.md §4
 * Glossary "Printing-id registry"): `registryId` is NEVER reassigned once
 * minted, even when the printing is later tombstoned (`dead: true`) or
 * revived (`dead: false` again, same id). */
export interface PrintingRegistryEntry {
  printingId: string;
  registryId: number;
  dead: boolean;
}

export interface PrintingRegistry {
  version: string;
  entries: PrintingRegistryEntry[];
}

/** Pure chunk-set diff between two corpus snapshots (see chunkDelta.ts). */
export interface ChunkDelta {
  added: Chunk[];
  changed: Chunk[];
  tombstonedChunkIds: string[];
}
