// APP-085 (SPEC-APP.md §8.8; issue #142): pure chunk-set diffing that
// deltaPack.ts builds on. Field-by-field comparison (not a raw
// JSON.stringify diff) so a change to any of text/title/source/tags/links
// is caught even if key order in the source object literal differs.
import { describe, it, expect } from "vitest";
import { computeChunkDelta } from "../src/knowledge/chunkDelta.js";
import { makeChunk } from "./dataset.helpers.js";

describe("computeChunkDelta", () => {
  it("boundary: empty corpus on both sides yields an empty (not an error) delta", () => {
    const delta = computeChunkDelta([], []);
    expect(delta).toEqual({ added: [], changed: [], tombstonedChunkIds: [] });
  });

  it("boundary: empty delta when nothing changed between two identical chunk sets", () => {
    const chunks = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })];
    const delta = computeChunkDelta(chunks, chunks);
    expect(delta).toEqual({ added: [], changed: [], tombstonedChunkIds: [] });
  });

  it("detects an added chunk", () => {
    const prev = [makeChunk({ chunk_id: "a" })];
    const curr = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })];
    const delta = computeChunkDelta(prev, curr);
    expect(delta.added.map((c) => c.chunk_id)).toEqual(["b"]);
    expect(delta.changed).toEqual([]);
    expect(delta.tombstonedChunkIds).toEqual([]);
  });

  it("detects a tombstoned (removed) chunk", () => {
    const prev = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })];
    const curr = [makeChunk({ chunk_id: "a" })];
    const delta = computeChunkDelta(prev, curr);
    expect(delta.tombstonedChunkIds).toEqual(["b"]);
    expect(delta.added).toEqual([]);
    expect(delta.changed).toEqual([]);
  });

  it("detects a changed chunk when text differs", () => {
    const prev = [makeChunk({ chunk_id: "a", text: "old text" })];
    const curr = [makeChunk({ chunk_id: "a", text: "new text" })];
    const delta = computeChunkDelta(prev, curr);
    expect(delta.changed.map((c) => c.chunk_id)).toEqual(["a"]);
  });

  it("detects a changed chunk when only tags or links differ (not just text)", () => {
    const prevTags = [makeChunk({ chunk_id: "a", tags: ["cr"] })];
    const currTags = [makeChunk({ chunk_id: "a", tags: ["cr", "adjudication"] })];
    expect(computeChunkDelta(prevTags, currTags).changed.map((c) => c.chunk_id)).toEqual(["a"]);

    const prevLinks = [makeChunk({ chunk_id: "a", links: ["b"] })];
    const currLinks = [makeChunk({ chunk_id: "a", links: ["b", "c"] })];
    expect(computeChunkDelta(prevLinks, currLinks).changed.map((c) => c.chunk_id)).toEqual(["a"]);
  });

  it("a chunk with identical content is neither added, changed, nor tombstoned", () => {
    const chunk = makeChunk({ chunk_id: "a" });
    const delta = computeChunkDelta([chunk], [{ ...chunk }]);
    expect(delta.added).toEqual([]);
    expect(delta.changed).toEqual([]);
    expect(delta.tombstonedChunkIds).toEqual([]);
  });

  it("handles a mixed batch: one added, one changed, one removed, one untouched", () => {
    const untouched = makeChunk({ chunk_id: "untouched" });
    const toChange = makeChunk({ chunk_id: "toChange", text: "before" });
    const toRemove = makeChunk({ chunk_id: "toRemove" });
    const prev = [untouched, toChange, toRemove];
    const curr = [untouched, { ...toChange, text: "after" }, makeChunk({ chunk_id: "added" })];
    const delta = computeChunkDelta(prev, curr);
    expect(delta.added.map((c) => c.chunk_id)).toEqual(["added"]);
    expect(delta.changed.map((c) => c.chunk_id)).toEqual(["toChange"]);
    expect(delta.tombstonedChunkIds).toEqual(["toRemove"]);
  });
});
