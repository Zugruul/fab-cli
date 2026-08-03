// APP-085 (issue #142; review round 1, PR #241): build.ts's own
// `report.json` deliverable — the richer, non-schema-constrained build
// record (embedder absence + reason, registry alive/dead counts) that
// doesn't fit KnowledgePackManifestSchema's fixed shape — had zero test
// coverage. This backfills it against real buildFullPack runs (not a
// TDD red-green cycle: the report-writing code already existed and these
// tests pass against it unmodified — this is coverage-only).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildFullPack } from "../src/knowledge/build.js";
import { makeChunk } from "./dataset.helpers.js";
import type { CalibrationArtifact } from "../src/eval/calibration.js";
import type { KnowledgePackBuildReport } from "../src/knowledge/build.js";

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

function readReport(outDir: string): KnowledgePackBuildReport {
  return JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")) as KnowledgePackBuildReport;
}

describe("buildFullPack's report.json", () => {
  let outDir: string;
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-knowledge-report-test-"));
  });
  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("is written alongside manifest.json on every buildFullPack call", () => {
    buildFullPack({
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
    expect(fs.existsSync(path.join(outDir, "report.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
  });

  it("records the pack version and honest absence reasons when neither embedder is provided", () => {
    buildFullPack({
      version: "1.2.3",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      printingIds: [],
      previousRegistry: null,
      registryVersion: "1.2.3",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir,
    });
    const report = readReport(outDir);
    expect(report.version).toBe("1.2.3");
    expect(report.textEmbeddings).toEqual({
      provided: false,
      embedderVersion: ABSENT_TEXT.embedderVersion,
      reason: ABSENT_TEXT.reason,
      chunkCount: null,
    });
    expect(report.imageEmbeddings).toEqual({
      provided: false,
      embedderVersion: ABSENT_IMAGE.embedderVersion,
      reason: ABSENT_IMAGE.reason,
      printingCount: null,
    });
  });

  it("records reason: null and real coverage counts when embeddings ARE provided", () => {
    const chunks = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })];
    const textEmbeddings = {
      provided: true as const,
      embedderVersion: "text-embed-v1",
      records: new Map([
        ["a", { chunkId: "a", vector: [0.1] }],
        ["b", { chunkId: "b", vector: [0.2] }],
      ]),
      dim: 1,
    };
    const imageEmbeddings = {
      provided: true as const,
      embedderVersion: "vision-embed-v1",
      records: new Map([["p1", { printingId: "p1", vector: [0.3] }]]),
      dim: 1,
    };
    buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks,
      printingIds: ["p1"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings,
      imageEmbeddings,
      calibration: calibration({ embedderVersion: "text-embed-v1" }),
      outDir,
    });
    const report = readReport(outDir);
    expect(report.textEmbeddings).toEqual({ provided: true, embedderVersion: "text-embed-v1", reason: null, chunkCount: 2 });
    expect(report.imageEmbeddings).toEqual({ provided: true, embedderVersion: "vision-embed-v1", reason: null, printingCount: 1 });
  });

  it("reports accurate registry alive/dead counts across two real generations", () => {
    const gen1 = buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [],
      printingIds: ["p1", "p2", "p3"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir: path.join(outDir, "gen1"),
    });
    const gen1Report = readReport(path.join(outDir, "gen1"));
    expect(gen1Report.registry).toEqual({ total: 3, alive: 3, dead: 0 });

    buildFullPack({
      version: "1.1.0",
      corpusSnapshotHash: "e".repeat(64),
      chunks: [],
      printingIds: ["p1", "p3"], // p2 dropped
      previousRegistry: gen1.registry,
      registryVersion: "1.1.0",
      textEmbeddings: ABSENT_TEXT,
      imageEmbeddings: ABSENT_IMAGE,
      calibration: calibration(),
      outDir: path.join(outDir, "gen2"),
    });
    const gen2Report = readReport(path.join(outDir, "gen2"));
    expect(gen2Report.registry).toEqual({ total: 3, alive: 2, dead: 1 });
  });
});
