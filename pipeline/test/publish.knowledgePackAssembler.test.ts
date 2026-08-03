// APP-029 (SPEC-APP.md §8.8/§8.9, issue #141): the knowledge-pack assembly
// layer WRAPS APP-085's builder (pipeline/src/knowledge/build.ts +
// deltaPack.ts) rather than reimplementing it. Its only jobs are: (1) turn
// a builder's real output directory into a flat publish bundle (asset
// list + manifest.json), and (2) surface the builder's delta-refusal
// decision honestly rather than swallowing it into a generic failure.
// The delta-equivalence-with-deletion and embedder-refusal properties
// THEMSELVES are already covered by knowledge.build.test.ts /
// knowledge.deltaPack.test.ts — not re-tested here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateKnowledgePackManifest, validateDeltaPackManifest } from "@fab/manifest-schema";
import { buildFullPack, loadSnapshotFromPackDir } from "../src/knowledge/build.js";
import { assembleKnowledgeFullPack, assembleKnowledgeDeltaPack } from "../src/publish/knowledgePackAssembler.js";
import { makeChunk } from "./dataset.helpers.js";
import { makeCalibration } from "./publish.helpers.js";

const ABSENT_IMAGE = { provided: false as const, embedderVersion: "unset", reason: "APP-028 not QA-gated yet" };

function providedText(embedderVersion: string, chunkIds: string[]) {
  const records = new Map(chunkIds.map((id) => [id, { chunkId: id, vector: [0.1, 0.2, 0.3] }]));
  return { provided: true as const, embedderVersion, records, dim: 3 };
}

function providedImage(embedderVersion: string, printingIds: string[]) {
  const records = new Map(printingIds.map((id) => [id, { printingId: id, vector: [0.4, 0.5, 0.6] }]));
  return { provided: true as const, embedderVersion, records, dim: 3 };
}

describe("assembleKnowledgeFullPack", () => {
  let buildDir: string;
  beforeEach(() => {
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-knowledge-full-"));
  });
  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true });
  });

  it("wraps a real buildFullPack call into a publish bundle covering every written index file plus manifest.json", () => {
    const chunks = [makeChunk({ chunk_id: "a" }), makeChunk({ chunk_id: "b" })];
    const result = assembleKnowledgeFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks,
      printingIds: ["p1", "p2"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: providedText("text-embed-v1", ["a", "b"]),
      imageEmbeddings: ABSENT_IMAGE,
      calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
      outDir: buildDir,
    });

    expect(validateKnowledgePackManifest(result.manifest).success).toBe(true);
    expect(result.bundle.kind).toBe("knowledge-full");
    const assetNames = result.bundle.assets.map((a) => a.assetName.split("/").pop());
    expect(result.bundle.assets.some((a) => a.localPath.endsWith("manifest.json"))).toBe(true);
    expect(result.bundle.assets.some((a) => a.localPath.endsWith("chunks-index.jsonl"))).toBe(true);
    expect(result.bundle.assets.some((a) => a.localPath.endsWith("printing-registry.json"))).toBe(true);
    for (const asset of result.bundle.assets) {
      expect(fs.existsSync(asset.localPath)).toBe(true);
    }
    expect(new Set(assetNames).size).toBe(assetNames.length); // no duplicate names within the bundle
  });

  it("propagates (never swallows) a real builder-level refusal, e.g. calibration/embedder mismatch", () => {
    expect(() =>
      assembleKnowledgeFullPack({
        version: "1.0.0",
        corpusSnapshotHash: "d".repeat(64),
        chunks: [makeChunk({ chunk_id: "a" })],
        printingIds: [],
        previousRegistry: null,
        registryVersion: "1.0.0",
        textEmbeddings: providedText("text-embed-v2", ["a"]),
        imageEmbeddings: ABSENT_IMAGE,
        calibration: makeCalibration({ embedderVersion: "text-embed-v1" }), // mismatched on purpose
        outDir: buildDir,
      }),
    ).toThrow(/calibrated for embedder/);
  });
});

describe("assembleKnowledgeDeltaPack", () => {
  let fromDir: string;
  let toDir: string;
  let outDir: string;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-knowledge-delta-"));
    fromDir = path.join(root, "from");
    toDir = path.join(root, "to");
    outDir = path.join(root, "out");
  });
  afterEach(() => {
    fs.rmSync(path.dirname(fromDir), { recursive: true, force: true });
  });

  it("surfaces the builder's refusal (not a generic failure) when either embedder's version changed between snapshots", () => {
    buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" })],
      printingIds: ["p1"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: providedText("text-embed-v1", ["keep"]),
      imageEmbeddings: ABSENT_IMAGE,
      calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
      outDir: fromDir,
    });
    buildFullPack({
      version: "1.1.0",
      corpusSnapshotHash: "e".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" })],
      printingIds: ["p1"],
      previousRegistry: null,
      registryVersion: "1.1.0",
      textEmbeddings: providedText("text-embed-v2", ["keep"]), // embedder version changed
      imageEmbeddings: ABSENT_IMAGE,
      calibration: makeCalibration({ embedderVersion: "text-embed-v2" }),
      outDir: toDir,
    });

    const from = loadSnapshotFromPackDir(fromDir);
    const to = loadSnapshotFromPackDir(toDir);
    const result = assembleKnowledgeDeltaPack(from, to, outDir);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.reason).toMatch(/text/i);
    expect(result.changedEmbedders).toEqual(["text"]);
    // A refused delta must never write a manifest to outDir.
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(false);
  });

  it("surfaces the builder's refusal when only the VISION embedder's version changed (text unchanged)", () => {
    buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" })],
      printingIds: ["p1"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: providedText("text-embed-v1", ["keep"]),
      imageEmbeddings: providedImage("vision-embed-v1", ["p1"]),
      calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
      outDir: fromDir,
    });
    buildFullPack({
      version: "1.1.0",
      corpusSnapshotHash: "e".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" })],
      printingIds: ["p1"],
      previousRegistry: null,
      registryVersion: "1.1.0",
      textEmbeddings: providedText("text-embed-v1", ["keep"]), // unchanged
      imageEmbeddings: providedImage("vision-embed-v2", ["p1"]), // changed
      calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
      outDir: toDir,
    });

    const from = loadSnapshotFromPackDir(fromDir);
    const to = loadSnapshotFromPackDir(toDir);
    const result = assembleKnowledgeDeltaPack(from, to, outDir);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.reason).toMatch(/vision/i);
    expect(result.changedEmbedders).toEqual(["vision"]);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(false);
  });

  it("surfaces the builder's refusal when BOTH embedders' versions changed", () => {
    buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" })],
      printingIds: ["p1"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: providedText("text-embed-v1", ["keep"]),
      imageEmbeddings: providedImage("vision-embed-v1", ["p1"]),
      calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
      outDir: fromDir,
    });
    buildFullPack({
      version: "1.1.0",
      corpusSnapshotHash: "e".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" })],
      printingIds: ["p1"],
      previousRegistry: null,
      registryVersion: "1.1.0",
      textEmbeddings: providedText("text-embed-v2", ["keep"]), // changed
      imageEmbeddings: providedImage("vision-embed-v2", ["p1"]), // changed
      calibration: makeCalibration({ embedderVersion: "text-embed-v2" }),
      outDir: toDir,
    });

    const from = loadSnapshotFromPackDir(fromDir);
    const to = loadSnapshotFromPackDir(toDir);
    const result = assembleKnowledgeDeltaPack(from, to, outDir);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.changedEmbedders).toEqual(["text", "vision"]);
  });

  it("assembles a real delta bundle (including a deletion tombstone) when embedder versions match", () => {
    buildFullPack({
      version: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" }), makeChunk({ chunk_id: "drop" })],
      printingIds: ["p1", "p2"],
      previousRegistry: null,
      registryVersion: "1.0.0",
      textEmbeddings: providedText("text-embed-v1", ["keep", "drop"]),
      imageEmbeddings: ABSENT_IMAGE,
      calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
      outDir: fromDir,
    });
    const first = loadSnapshotFromPackDir(fromDir);
    buildFullPack({
      version: "1.1.0",
      corpusSnapshotHash: "e".repeat(64),
      chunks: [makeChunk({ chunk_id: "keep" })],
      printingIds: ["p1"], // p2 dropped
      previousRegistry: JSON.parse(fs.readFileSync(path.join(fromDir, "printing-registry.json"), "utf8")),
      registryVersion: "1.1.0",
      textEmbeddings: providedText("text-embed-v1", ["keep"]),
      imageEmbeddings: ABSENT_IMAGE,
      calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
      outDir: toDir,
    });

    const from = loadSnapshotFromPackDir(fromDir);
    const to = loadSnapshotFromPackDir(toDir);
    const result = assembleKnowledgeDeltaPack(from, to, outDir);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(validateDeltaPackManifest(result.manifest).success).toBe(true);
    expect(result.manifest.tombstones.chunkIds).toEqual(["drop"]);
    expect(result.manifest.tombstones.printingIds).toEqual(["p2"]);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
    expect(result.bundle.kind).toBe("knowledge-delta");
    expect(first.chunks.map((c) => c.chunk_id)).toContain("drop"); // sanity: fixture really had a deletion
  });
});
