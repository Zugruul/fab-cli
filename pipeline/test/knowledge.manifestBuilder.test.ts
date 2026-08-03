// APP-085 (SPEC-APP.md §8.8, §9.7; issue #142): assembles a real
// KnowledgePackManifest that validates against @fab/manifest-schema,
// writes real index files (sha256/size computed over the ACTUAL written
// bytes, never fabricated), and threads retrievalFloor/oodThreshold
// straight from APP-022's real calibration-artifact shape
// (pipeline/src/eval/calibration.ts's CalibrationArtifact, written to
// pipeline/eval-runs/calibration/<embedderVersion>.json by `eval
// calibrate`) — never hardcoded or defaulted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateKnowledgePackManifest } from "@fab/manifest-schema";
import { buildKnowledgePackManifest } from "../src/knowledge/manifestBuilder.js";
import { buildPrintingRegistry } from "../src/knowledge/printingRegistry.js";
import { makeChunk } from "./dataset.helpers.js";
import type { CalibrationArtifact } from "../src/eval/calibration.js";
import type { TextEmbeddingsResult, ImageEmbeddingsResult } from "../src/knowledge/types.js";

function calibration(overrides: Partial<CalibrationArtifact> = {}): CalibrationArtifact {
  return {
    embedderVersion: "text-embed-v1",
    retrievalFloor: 0.42,
    oodThreshold: 0.2,
    computedAt: "2026-08-02T00:00:00.000Z",
    sampleSize: 100,
    method: "floorPercentile=0.1,oodMarginRatio=0.5",
    ...overrides,
  };
}

const ABSENT_TEXT: TextEmbeddingsResult = { provided: false, embedderVersion: "unembedded", reason: "no embedder yet" };
const ABSENT_IMAGE: ImageEmbeddingsResult = { provided: false, embedderVersion: "unset", reason: "APP-028 not QA-gated yet" };

describe("buildKnowledgePackManifest", () => {
  let outDir: string;
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-knowledge-manifest-test-"));
  });
  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("boundary: builds a valid manifest for an empty corpus (chunkCount 0), not an error", () => {
    const registry = buildPrintingRegistry([], null, "1.0.0");
    const result = buildKnowledgePackManifest({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      printingRegistry: registry,
      calibration: calibration({ embedderVersion: ABSENT_TEXT.embedderVersion }),
      outDir,
    });
    expect(result.manifest.chunkCount).toBe(0);
    expect(validateKnowledgePackManifest(result.manifest).success).toBe(true);
  });

  it("pins retrievalFloor/oodThreshold straight from the calibration artifact — never hardcoded", () => {
    const registry = buildPrintingRegistry([], null, "1.0.0");
    const cal = calibration({ embedderVersion: ABSENT_TEXT.embedderVersion, retrievalFloor: 0.77, oodThreshold: 0.11 });
    const result = buildKnowledgePackManifest({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      printingRegistry: registry,
      calibration: cal,
      outDir,
    });
    expect(result.manifest.retrievalFloor).toBe(0.77);
    expect(result.manifest.oodThreshold).toBe(0.11);
  });

  it("throws when the calibration artifact's embedderVersion doesn't match the text embeddings' version (floors must be calibrated for the exact embedder being packed)", () => {
    const registry = buildPrintingRegistry([], null, "1.0.0");
    expect(() =>
      buildKnowledgePackManifest({
        version: "1.0.0",
        corpusSnapshotHash: "d".repeat(64),
        chunks: [],
        textEmbeddings: { provided: true, embedderVersion: "text-embed-v1", records: new Map(), dim: 3 },
        imageEmbeddings: ABSENT_IMAGE,
        printingRegistry: registry,
        calibration: calibration({ embedderVersion: "text-embed-v2" }),
        outDir,
      }),
    ).toThrow(/calibrat/i);
  });

  it("throws when text embeddings are provided but don't cover every shipped chunk (silent semantic-search data loss)", () => {
    const registry = buildPrintingRegistry([], null, "1.0.0");
    const chunks = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })];
    const records = new Map([["a", { chunkId: "a", vector: [0.1, 0.2] }]]); // missing "b"
    expect(() =>
      buildKnowledgePackManifest({
        version: "1.0.0",
        corpusSnapshotHash: "d".repeat(64),
        chunks,
        textEmbeddings: { provided: true, embedderVersion: "text-embed-v1", records, dim: 2 },
        imageEmbeddings: ABSENT_IMAGE,
        printingRegistry: registry,
        calibration: calibration({ embedderVersion: "text-embed-v1" }),
        outDir,
      }),
    ).toThrow(/\bb\b/);
  });

  it("writes real index files and reports sha256/size computed over the ACTUAL written bytes", () => {
    const registry = buildPrintingRegistry(["p1"], null, "1.0.0");
    const chunks = [makeChunk({ chunk_id: "a" })];
    const result = buildKnowledgePackManifest({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks,
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      printingRegistry: registry,
      calibration: calibration({ embedderVersion: ABSENT_TEXT.embedderVersion }),
      outDir,
    });
    expect(result.manifest.indexFiles.length).toBeGreaterThan(0);
    for (const indexFile of result.manifest.indexFiles) {
      const writtenPath = path.join(outDir, indexFile.name);
      expect(fs.existsSync(writtenPath)).toBe(true);
      const bytes = fs.readFileSync(writtenPath);
      expect(indexFile.sizeBytes).toBe(bytes.length);
      expect(indexFile.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("includes an image-vectors index file only when image embeddings are actually provided", () => {
    const registry = buildPrintingRegistry(["p1"], null, "1.0.0");
    const withoutImages = buildKnowledgePackManifest({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      printingRegistry: registry,
      calibration: calibration({ embedderVersion: ABSENT_TEXT.embedderVersion }),
      outDir,
    });
    expect(withoutImages.manifest.indexFiles.some((f) => f.name.includes("image"))).toBe(false);

    const outDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-knowledge-manifest-test-2-"));
    try {
      const withImages = buildKnowledgePackManifest({
        version: "1.0.0",
        corpusSnapshotHash: "d".repeat(64),
        chunks: [],
        textEmbeddings: ABSENT_TEXT,
        imageEmbeddings: {
          provided: true,
          embedderVersion: "vision-embed-v1",
          records: new Map([["p1", { printingId: "p1", vector: [0.1, 0.2] }]]),
          dim: 2,
        },
        printingRegistry: registry,
        calibration: calibration({ embedderVersion: ABSENT_TEXT.embedderVersion }),
        outDir: outDir2,
      });
      expect(withImages.manifest.indexFiles.some((f) => f.name.includes("image"))).toBe(true);
      expect(withImages.manifest.visionEmbedderVersion).toBe("vision-embed-v1");
    } finally {
      fs.rmSync(outDir2, { recursive: true, force: true });
    }
  });

  it("pins textEmbedderVersion/visionEmbedderVersion to the sentinel values when neither is provided (never fabricated)", () => {
    const registry = buildPrintingRegistry([], null, "1.0.0");
    const result = buildKnowledgePackManifest({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      printingRegistry: registry,
      calibration: calibration({ embedderVersion: ABSENT_TEXT.embedderVersion }),
      outDir,
    });
    expect(result.manifest.textEmbedderVersion).toBe("unembedded");
    expect(result.manifest.visionEmbedderVersion).toBe("unset");
  });
});
