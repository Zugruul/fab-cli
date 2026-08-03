// APP-085 (SPEC-APP.md §8.8; issue #142): delta packs between consecutive
// corpus snapshots carry additions/changes/tombstones, and are REFUSED
// outright when either embedder's version changed (text or vision,
// independently tested per the dev brain's test-knob-intersections
// lesson). Also proves the AC's core equivalence property: applying a
// delta to the "from" snapshot reproduces the "to" snapshot exactly,
// including a deletion fixture.
import { describe, it, expect } from "vitest";
import { buildDeltaPack, applyChunkDelta, type SnapshotForDelta } from "../src/knowledge/deltaPack.js";
import { validateDeltaPackManifest } from "@fab/manifest-schema";
import { makeChunk } from "./dataset.helpers.js";
import type { Chunk } from "../src/types.js";

function snapshot(overrides: Partial<SnapshotForDelta>): SnapshotForDelta {
  return {
    version: "1.0.0",
    chunks: [],
    printingIds: [],
    textEmbedderVersion: "text-embed-v1",
    visionEmbedderVersion: "vision-embed-v1",
    ...overrides,
  };
}

function sortByChunkId(chunks: readonly Chunk[]): Chunk[] {
  return [...chunks].sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));
}

describe("buildDeltaPack", () => {
  it("boundary: identical snapshots produce an empty (not refused) delta", () => {
    const chunks = [makeChunk({ chunk_id: "a" })];
    const from = snapshot({ version: "1.0.0", chunks, printingIds: ["p1"] });
    const to = snapshot({ version: "1.1.0", chunks, printingIds: ["p1"] });
    const result = buildDeltaPack(from, to);
    expect(result.refused).toBe(false);
    if (result.refused) throw new Error("unreachable");
    expect(result.manifest.addedCount).toBe(0);
    expect(result.manifest.changedCount).toBe(0);
    expect(result.manifest.tombstones).toEqual({ chunkIds: [], printingIds: [] });
  });

  it("produces a manifest that validates against @fab/manifest-schema's DeltaPackManifestSchema", () => {
    const from = snapshot({ version: "1.0.0", chunks: [makeChunk({ chunk_id: "a" })], printingIds: ["p1"] });
    const to = snapshot({
      version: "1.1.0",
      chunks: [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })],
      printingIds: ["p1", "p2"],
    });
    const result = buildDeltaPack(from, to);
    if (result.refused) throw new Error("unreachable");
    const validation = validateDeltaPackManifest(result.manifest);
    expect(validation.success).toBe(true);
  });

  it("REFUSED when the text embedder version changes (vision unchanged) — SPEC-APP.md §8.8", () => {
    const from = snapshot({ textEmbedderVersion: "text-embed-v1" });
    const to = snapshot({ textEmbedderVersion: "text-embed-v2" });
    const result = buildDeltaPack(from, to);
    expect(result.refused).toBe(true);
    if (!result.refused) throw new Error("unreachable");
    expect(result.changedEmbedders).toEqual(["text"]);
    expect(result.reason).toMatch(/text/);
  });

  it("REFUSED when the vision embedder version changes (text unchanged) — SPEC-APP.md §8.8", () => {
    const from = snapshot({ visionEmbedderVersion: "vision-embed-v1" });
    const to = snapshot({ visionEmbedderVersion: "vision-embed-v2" });
    const result = buildDeltaPack(from, to);
    expect(result.refused).toBe(true);
    if (!result.refused) throw new Error("unreachable");
    expect(result.changedEmbedders).toEqual(["vision"]);
    expect(result.reason).toMatch(/vision/);
  });

  it("REFUSED when BOTH embedder versions change", () => {
    const from = snapshot({ textEmbedderVersion: "text-embed-v1", visionEmbedderVersion: "vision-embed-v1" });
    const to = snapshot({ textEmbedderVersion: "text-embed-v2", visionEmbedderVersion: "vision-embed-v2" });
    const result = buildDeltaPack(from, to);
    expect(result.refused).toBe(true);
    if (!result.refused) throw new Error("unreachable");
    expect(result.changedEmbedders.sort()).toEqual(["text", "vision"]);
  });

  it("carries tombstones for both removed chunk_ids and removed printing ids", () => {
    const from = snapshot({
      chunks: [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })],
      printingIds: ["p1", "p2"],
    });
    const to = snapshot({ chunks: [makeChunk({ chunk_id: "a" })], printingIds: ["p1"] });
    const result = buildDeltaPack(from, to);
    if (result.refused) throw new Error("unreachable");
    expect(result.manifest.tombstones.chunkIds).toEqual(["b"]);
    expect(result.manifest.tombstones.printingIds).toEqual(["p2"]);
  });

  // --- THE equivalence property (APP-085 AC) ------------------------------
  it("EQUIVALENCE: applying the delta to `from` reproduces `to` exactly, INCLUDING a deletion fixture", () => {
    const fromChunks = [
      makeChunk({ chunk_id: "untouched" }),
      makeChunk({ chunk_id: "toChange", text: "before" }),
      makeChunk({ chunk_id: "toDelete" }), // the deletion fixture
    ];
    const toChunks = [
      makeChunk({ chunk_id: "untouched" }),
      makeChunk({ chunk_id: "toChange", text: "after" }),
      makeChunk({ chunk_id: "brandNew" }),
    ];
    const from = snapshot({ version: "1.0.0", chunks: fromChunks, printingIds: ["p1", "p2"] });
    const to = snapshot({ version: "1.1.0", chunks: toChunks, printingIds: ["p1"] });

    const result = buildDeltaPack(from, to);
    if (result.refused) throw new Error("unreachable");

    const reconstructed = applyChunkDelta(fromChunks, result.chunkDelta);
    expect(sortByChunkId(reconstructed)).toEqual(sortByChunkId(toChunks));

    // and the deletion fixture is really gone from the reconstruction
    expect(reconstructed.find((c) => c.chunk_id === "toDelete")).toBeUndefined();
    expect(result.manifest.tombstones.chunkIds).toContain("toDelete");
  });

  it("EQUIVALENCE holds even for a delta spanning more than one snapshot gap (from v1 directly to v3, skipping v2)", () => {
    const v1 = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })];
    // v2 (never diffed directly) adds c
    const v3 = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "c" })]; // b removed, c added vs v1

    const from = snapshot({ version: "1.0.0", chunks: v1, printingIds: [] });
    const to = snapshot({ version: "3.0.0", chunks: v3, printingIds: [] });
    const result = buildDeltaPack(from, to);
    if (result.refused) throw new Error("unreachable");

    const reconstructed = applyChunkDelta(v1, result.chunkDelta);
    expect(sortByChunkId(reconstructed)).toEqual(sortByChunkId(v3));
  });
});
