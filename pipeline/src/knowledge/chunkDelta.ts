/**
 * APP-085 (SPEC-APP.md §8.8; issue #142): pure chunk-set diffing that
 * deltaPack.ts builds on. Field-by-field equality (not a raw
 * JSON.stringify comparison) so a change is caught regardless of source
 * object key order.
 */
import type { Chunk } from "../types.js";
import type { ChunkDelta } from "./types.js";

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function chunksEqual(a: Chunk, b: Chunk): boolean {
  return (
    a.text === b.text &&
    a.title === b.title &&
    a.source === b.source &&
    arraysEqual(a.tags, b.tags) &&
    arraysEqual(a.links, b.links)
  );
}

export function computeChunkDelta(previous: readonly Chunk[], current: readonly Chunk[]): ChunkDelta {
  const prevById = new Map(previous.map((c) => [c.chunk_id, c]));
  const currById = new Map(current.map((c) => [c.chunk_id, c]));

  const added: Chunk[] = [];
  const changed: Chunk[] = [];
  for (const [id, chunk] of currById) {
    const prevChunk = prevById.get(id);
    if (!prevChunk) {
      added.push(chunk);
    } else if (!chunksEqual(prevChunk, chunk)) {
      changed.push(chunk);
    }
  }

  const tombstonedChunkIds: string[] = [];
  for (const id of prevById.keys()) {
    if (!currById.has(id)) tombstonedChunkIds.push(id);
  }

  return { added, changed, tombstonedChunkIds };
}
