/**
 * APP-085 (SPEC-APP.md §8.8; issue #142): delta packs between two
 * knowledge-pack snapshots — additions, changes, and tombstones (removed
 * chunk_ids AND printing ids). Per §8.8: "IF the version of EITHER
 * embedder (text embedder or image/recognition embedder) changes between
 * snapshots THEN delta packs SHALL be refused by the builder and a full
 * pack forced" — checked here independently for each embedder before any
 * diffing happens.
 *
 * Boundary convention: a delta is a generic diff between any two given
 * snapshots' chunk/printing sets — nothing here assumes `from`/`to` are
 * adjacent versions. Skipping an intermediate snapshot (e.g. diffing v1
 * directly against v3) is valid and the equivalence property below still
 * holds; it's the caller's choice which two snapshots to diff.
 */
import { validateDeltaPackManifest, type DeltaPackManifest } from "@fab/manifest-schema";
import { computeChunkDelta } from "./chunkDelta.js";
import type { Chunk, ChunkDelta } from "./types.js";

const SCHEMA_VERSION = "0.1.0";

export interface SnapshotForDelta {
  version: string;
  chunks: Chunk[];
  printingIds: string[];
  textEmbedderVersion: string;
  visionEmbedderVersion: string;
}

export type DeltaBuildResult =
  | { refused: false; manifest: DeltaPackManifest; chunkDelta: ChunkDelta; tombstonedPrintingIds: string[] }
  | { refused: true; reason: string; changedEmbedders: ("text" | "vision")[] };

export function buildDeltaPack(from: SnapshotForDelta, to: SnapshotForDelta): DeltaBuildResult {
  const changedEmbedders: ("text" | "vision")[] = [];
  if (from.textEmbedderVersion !== to.textEmbedderVersion) changedEmbedders.push("text");
  if (from.visionEmbedderVersion !== to.visionEmbedderVersion) changedEmbedders.push("vision");

  if (changedEmbedders.length > 0) {
    return {
      refused: true,
      changedEmbedders,
      reason:
        `delta refused: ${changedEmbedders.join(" and ")} embedder version changed between ${from.version} and ` +
        `${to.version} (SPEC-APP.md §8.8: either embedder changing forces a full pack) — build a full pack instead`,
    };
  }

  const chunkDelta = computeChunkDelta(from.chunks, to.chunks);
  const toPrintingSet = new Set(to.printingIds);
  const tombstonedPrintingIds = from.printingIds.filter((id) => !toPrintingSet.has(id));

  const manifest: DeltaPackManifest = {
    schemaVersion: SCHEMA_VERSION,
    fromVersion: from.version,
    toVersion: to.version,
    addedCount: chunkDelta.added.length,
    changedCount: chunkDelta.changed.length,
    tombstones: { chunkIds: chunkDelta.tombstonedChunkIds, printingIds: tombstonedPrintingIds },
    fromTextEmbedderVersion: from.textEmbedderVersion,
    toTextEmbedderVersion: to.textEmbedderVersion,
    fromVisionEmbedderVersion: from.visionEmbedderVersion,
    toVisionEmbedderVersion: to.visionEmbedderVersion,
  };

  const validation = validateDeltaPackManifest(manifest);
  if (!validation.success) {
    throw new Error(`buildDeltaPack: assembled manifest failed schema validation: ${JSON.stringify(validation.errors)}`);
  }

  return { refused: false, manifest: validation.data, chunkDelta, tombstonedPrintingIds };
}

/**
 * Reconstructs the "to" chunk set by applying a delta to the "from" chunk
 * set. This exists ONLY to prove the APP-085 AC's equivalence property in
 * tests ("delta-over-previous == full-build equivalence including a
 * deletion fixture") — it is not part of the on-device consumption path
 * (the app applies deltas to its op-sqlite store directly, per §9.5).
 */
export function applyChunkDelta(previous: readonly Chunk[], delta: ChunkDelta): Chunk[] {
  const removed = new Set(delta.tombstonedChunkIds);
  const changedIds = new Set(delta.changed.map((c) => c.chunk_id));
  const kept = previous.filter((c) => !removed.has(c.chunk_id) && !changedIds.has(c.chunk_id));
  return [...kept, ...delta.changed, ...delta.added];
}
