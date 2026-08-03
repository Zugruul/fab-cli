// APP-085 (SPEC-APP.md §8.8; issue #142): top-level orchestration wiring
// buildPrintingRegistry + buildKnowledgePackManifest together for a "full
// pack" build — the entry point the CLI (and APP-029's pack assembly)
// calls. Kept as pure, file-I/O-light functions (paths passed in, no
// process/env reads) so it's fully unit-testable, matching the rest of
// this pipeline's assemble.ts-style modules.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateKnowledgePackManifest } from "@fab/manifest-schema";
import { buildFullPack, loadSnapshotFromPackDir } from "../src/knowledge/build.js";
import { buildDeltaPack, applyChunkDelta } from "../src/knowledge/deltaPack.js";
import { makeChunk } from "./dataset.helpers.js";
import type { CalibrationArtifact } from "../src/eval/calibration.js";

const ABSENT_TEXT = { provided: false as const, embedderVersion: "unembedded", reason: "no embedder yet" };
const ABSENT_IMAGE = { provided: false as const, embedderVersion: "unset", reason: "APP-028 not QA-gated yet" };

function calibration(overrides: Partial<CalibrationArtifact> = {}): CalibrationArtifact {
  return {
    embedderVersion: "unembedded",
    retrievalFloor: 0.42,
    oodThreshold: 0.2,
    computedAt: "2026-08-02T00:00:00.000Z",
    sampleSize: 100,
    method: "floorPercentile=0.1,oodMarginRatio=0.5",
    ...overrides,
  };
}

describe("buildFullPack", () => {
  let outDir: string;
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-knowledge-build-test-"));
  });
  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("builds a fresh full pack (no previous registry) and produces a schema-valid manifest", () => {
    const result = buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })],
      printingIds: ["p1", "p2"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir,
    });
    expect(validateKnowledgePackManifest(result.manifest).success).toBe(true);
    expect(result.manifest.chunkCount).toBe(2);
    expect(result.registry.entries).toHaveLength(2);
  });

  it("boundary: an empty corpus snapshot still produces a valid, buildable pack", () => {
    const result = buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      printingIds: [],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir,
    });
    expect(validateKnowledgePackManifest(result.manifest).success).toBe(true);
    expect(result.manifest.chunkCount).toBe(0);
    expect(result.registry.entries).toEqual([]);
  });

  it("re-running with an additional printing carries forward the previous registry's ids unchanged (append-only across a real build call)", () => {
    const first = buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      printingIds: ["p1", "p2"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir: path.join(outDir, "gen1"),
    });

    const second = buildFullPack({
      version: "1.1.0",
      corpusSnapshotHash: "e".repeat(64),
      chunks: [],
      printingIds: ["p1", "p2", "p3"],
      previousRegistry: first.registry,
      registryVersion: "1.1.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir: path.join(outDir, "gen2"),
    });

    const p1First = first.registry.entries.find((e) => e.printingId === "p1")!;
    const p1Second = second.registry.entries.find((e) => e.printingId === "p1")!;
    expect(p1Second.registryId).toBe(p1First.registryId);
  });

  // --- Full-pack -> delta-pack round trip (ties the whole builder together) ---
  it("ROUND TRIP: loadSnapshotFromPackDir + buildDeltaPack over two real full-pack builds reproduces the second build's chunk set exactly", () => {
    const fromChunks = [makeChunk({ chunk_id: "keep" }), makeChunk({ chunk_id: "drop" })];
    const toChunks = [makeChunk({ chunk_id: "keep" }), makeChunk({ chunk_id: "new" })];

    const fromDir = path.join(outDir, "from");
    const toDir = path.join(outDir, "to");
    const first = buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: fromChunks,
      printingIds: ["p1", "p2"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir: fromDir,
    });

    const second = buildFullPack({
      version: "1.1.0",
      corpusSnapshotHash: "e".repeat(64),
      chunks: toChunks,
      printingIds: ["p1"], // p2 dropped
      previousRegistry: first.registry,
      registryVersion: "1.1.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir: toDir,
    });
    expect(second.manifest.chunkCount).toBe(toChunks.length);

    const fromSnapshot = loadSnapshotFromPackDir(fromDir);
    const toSnapshot = loadSnapshotFromPackDir(toDir);
    const delta = buildDeltaPack(fromSnapshot, toSnapshot);
    if (delta.refused) throw new Error("unreachable");

    expect(delta.manifest.tombstones.chunkIds).toEqual(["drop"]);
    expect(delta.manifest.tombstones.printingIds).toEqual(["p2"]);

    const reconstructed = applyChunkDelta(fromSnapshot.chunks, delta.chunkDelta);
    expect(reconstructed.slice().sort((a, b) => a.chunk_id.localeCompare(b.chunk_id))).toEqual(
      toChunks.slice().sort((a, b) => a.chunk_id.localeCompare(b.chunk_id)),
    );
  });
});
