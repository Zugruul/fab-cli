// APP-029 (SPEC-APP.md §8.9, §7.10; issue #141): buildReleasePlan is the
// top-level dry-run orchestrator — it enforces the shipping-mode
// precondition FIRST (before any assembly is attempted), assembles
// whichever model-pack tiers have complete artifacts (partial-tier
// publishing is an intentional, documented boundary convention — a tier
// missing artifacts is reported, not fatal to the whole run), assembles
// the knowledge pack(s), cross-checks that a jointly-published model pack
// and knowledge pack were built against the SAME embedder versions (no
// single manifest schema enforces this on its own — checkModelKnowledge
// Compatibility in fab-app only checks it at load time, which is too
// late for a publish that already shipped a broken pair), and finally
// writes the complete flat bundle tree + checksums.txt + release-
// manifest.json to disk without ever touching the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validCorpusSnapshotManifest, invalidCorpusSnapshotManifestMissingShippingMode, validEvalScores } from "@fab/manifest-schema";
import { buildReleasePlan } from "../src/publish/releasePlan.js";
import { buildFullPack, loadSnapshotFromPackDir } from "../src/knowledge/build.js";
import { makeChunk } from "./dataset.helpers.js";
import { makeCalibration } from "./publish.helpers.js";
import type { AssembleModelPackInput } from "../src/publish/types.js";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function providedText(embedderVersion: string, chunkIds: string[]) {
  const records = new Map(chunkIds.map((id) => [id, { chunkId: id, vector: [0.1, 0.2, 0.3] }]));
  return { provided: true as const, embedderVersion, records, dim: 3 };
}
const ABSENT_IMAGE = { provided: false as const, embedderVersion: "unset", reason: "APP-028 not QA-gated yet" };

function providedImage(embedderVersion: string, printingIds: string[]) {
  const records = new Map(printingIds.map((id) => [id, { printingId: id, vector: [0.4, 0.5, 0.6] }]));
  return { provided: true as const, embedderVersion, records, dim: 3 };
}

describe("buildReleasePlan", () => {
  let assetsDir: string;
  let outDir: string;

  beforeEach(() => {
    assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-plan-assets-"));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-plan-out-"));
    fs.writeFileSync(path.join(assetsDir, "merged.gguf"), "merged-llm-bytes");
    fs.writeFileSync(path.join(assetsDir, "text-embedder.gguf"), "text-embedder-bytes");
    fs.writeFileSync(path.join(assetsDir, "detector.tflite"), "detector-bytes");
    fs.writeFileSync(path.join(assetsDir, "vision-embedder.tflite"), "vision-embedder-bytes");
  });
  afterEach(() => {
    fs.rmSync(assetsDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  function completeModelPackInput(overrides: Partial<AssembleModelPackInput> = {}): Omit<AssembleModelPackInput, "outDir" | "tier"> {
    return {
      artifacts: {
        mergedGguf: { path: path.join(assetsDir, "merged.gguf"), licenseId: "Apache-2.0", version: "export-1" },
        textEmbedderGguf: { path: path.join(assetsDir, "text-embedder.gguf"), licenseId: "MIT", version: "text-embed-v1" },
        detectorTflite: { path: path.join(assetsDir, "detector.tflite"), licenseId: "Apache-2.0", version: "detector-v1" },
        visionEmbedderTflite: { path: path.join(assetsDir, "vision-embedder.tflite"), licenseId: "Apache-2.0", version: "vision-embed-v1" },
      },
      baseModelHash: "c".repeat(64),
      textEmbedderVersion: "text-embed-v1",
      visionEmbedderVersion: "vision-embed-v1",
      detectorVersion: "detector-v1",
      compatibleKnowledgePacks: "^1.0.0",
      appMinVersion: "1.0.0",
      corpusSnapshotHash: "d".repeat(64),
      evalScores: validEvalScores,
      ...overrides,
    } as Omit<AssembleModelPackInput, "outDir" | "tier">;
  }

  it("aborts the WHOLE plan before any assembly when the shipping-mode precondition fails", () => {
    const result = buildReleasePlan({
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: invalidCorpusSnapshotManifestMissingShippingMode,
      modelPacks: [{ tier: "0.6B", input: completeModelPackInput() }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/shippingMode/);
    expect(result.modelPackResults).toBeUndefined();
    expect(fs.readdirSync(outDir)).toEqual([]); // nothing written on a precondition failure
  });

  it("assembles a single-tier + knowledge-full release and writes the complete flat bundle tree", () => {
    const result = buildReleasePlan({
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
      modelPacks: [{ tier: "0.6B", input: completeModelPackInput() }],
      knowledgeFull: {
        input: {
          version: "1.0.0",
          corpusSnapshotHash: "d".repeat(64),
          chunks: [makeChunk({ chunk_id: "a" })],
          printingIds: ["p1"],
          previousRegistry: null,
          registryVersion: "1.0.0",
          textEmbeddings: providedText("text-embed-v1", ["a"]),
          imageEmbeddings: ABSENT_IMAGE,
          calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`unreachable: ${result.reason}`);
    expect(result.modelPackResults).toEqual([{ tier: "0.6B", status: "ok" }]);
    expect(result.plan.tag).toBe("pack-1.0.0");
    expect(result.plan.assets.some((a) => a.assetName === "model-0.6B-merged.gguf")).toBe(true);
    expect(result.plan.assets.some((a) => a.assetName.startsWith("knowledge-full-1.0.0-"))).toBe(true);

    // Every planned asset is a REAL file on disk at outDir/<assetName>, hash-verified.
    for (const asset of result.plan.assets) {
      const onDisk = path.join(outDir, asset.assetName);
      expect(fs.existsSync(onDisk)).toBe(true);
      expect(sha256(fs.readFileSync(onDisk))).toBe(asset.sha256);
    }
    expect(fs.existsSync(path.join(outDir, "checksums.txt"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "release-manifest.json"))).toBe(true);
  });

  it("BOUNDARY: partial-tier publishing — a tier missing artifacts is reported as failed, not fatal to the whole plan", () => {
    const result = buildReleasePlan({
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
      modelPacks: [
        { tier: "0.6B", input: completeModelPackInput() },
        { tier: "1.7B", input: completeModelPackInput({ artifacts: { ...completeModelPackInput().artifacts, detectorTflite: null } }) },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`unreachable: ${result.reason}`);
    expect(result.modelPackResults).toEqual([
      { tier: "0.6B", status: "ok" },
      { tier: "1.7B", status: "failed", error: expect.stringMatching(/detectorTflite/) },
    ]);
    // Only the successful tier's assets made it into the plan/bundle tree.
    expect(result.plan.assets.some((a) => a.assetName.startsWith("model-0.6B-"))).toBe(true);
    expect(result.plan.assets.some((a) => a.assetName.startsWith("model-1.7B-"))).toBe(false);
  });

  it("surfaces a refused knowledge delta without failing the whole plan", () => {
    const fromDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-plan-from-"));
    const toDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-plan-to-"));
    try {
      buildFullPack({
        version: "1.0.0",
        corpusSnapshotHash: "d".repeat(64),
        chunks: [makeChunk({ chunk_id: "a" })],
        printingIds: ["p1"],
        previousRegistry: null,
        registryVersion: "1.0.0",
        textEmbeddings: providedText("text-embed-v1", ["a"]),
        imageEmbeddings: ABSENT_IMAGE,
        calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
        outDir: fromDir,
      });
      buildFullPack({
        version: "1.1.0",
        corpusSnapshotHash: "e".repeat(64),
        chunks: [makeChunk({ chunk_id: "a" })],
        printingIds: ["p1"],
        previousRegistry: null,
        registryVersion: "1.1.0",
        textEmbeddings: providedText("text-embed-v2", ["a"]), // changed
        imageEmbeddings: ABSENT_IMAGE,
        calibration: makeCalibration({ embedderVersion: "text-embed-v2" }),
        outDir: toDir,
      });

      const result = buildReleasePlan({
        releaseVersion: "1.1.0",
        outDir,
        corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
        modelPacks: [],
        knowledgeDelta: { from: loadSnapshotFromPackDir(fromDir), to: loadSnapshotFromPackDir(toDir) },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`unreachable: ${result.reason}`);
      expect(result.knowledgeDeltaResult).toEqual({ status: "refused", reason: expect.stringMatching(/text/i) });
      expect(result.plan.assets.some((a) => a.assetName.startsWith("knowledge-delta-"))).toBe(false);
    } finally {
      fs.rmSync(fromDir, { recursive: true, force: true });
      fs.rmSync(toDir, { recursive: true, force: true });
    }
  });

  it("cross-check: refuses the WHOLE plan (writes nothing) when a model pack and knowledge pack disagree on text embedder version", () => {
    const result = buildReleasePlan({
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
      modelPacks: [{ tier: "0.6B", input: completeModelPackInput({ textEmbedderVersion: "text-embed-v1" }) }],
      knowledgeFull: {
        input: {
          version: "1.0.0",
          corpusSnapshotHash: "d".repeat(64),
          chunks: [makeChunk({ chunk_id: "a" })],
          printingIds: ["p1"],
          previousRegistry: null,
          registryVersion: "1.0.0",
          textEmbeddings: providedText("text-embed-v2", ["a"]), // mismatched vs model pack's v1
          imageEmbeddings: ABSENT_IMAGE,
          calibration: makeCalibration({ embedderVersion: "text-embed-v2" }),
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/text-embed-v1/);
    expect(result.reason).toMatch(/text-embed-v2/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  // MUTATION-KILL COVERAGE (reviewer flag: deleting releasePlan.ts's vision
  // branch left every existing test green because every fixture used
  // ABSENT_IMAGE, which short-circuits via NO_VISION_EMBEDDER_VERSION
  // before ever comparing versions). These three use REAL, non-absent
  // image embeddings on both sides so the vision comparison actually runs.
  it("cross-check: refuses the WHOLE plan when a model pack and knowledge pack disagree on VISION embedder version (both real, non-absent)", () => {
    const result = buildReleasePlan({
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
      modelPacks: [{ tier: "0.6B", input: completeModelPackInput({ visionEmbedderVersion: "vision-embed-v1" }) }],
      knowledgeFull: {
        input: {
          version: "1.0.0",
          corpusSnapshotHash: "d".repeat(64),
          chunks: [makeChunk({ chunk_id: "a" })],
          printingIds: ["p1"],
          previousRegistry: null,
          registryVersion: "1.0.0",
          textEmbeddings: providedText("text-embed-v1", ["a"]),
          imageEmbeddings: providedImage("vision-embed-v2", ["p1"]), // mismatched vs model pack's v1
          calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/vision-embed-v1/);
    expect(result.reason).toMatch(/vision-embed-v2/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it("cross-check: a MATCHING vision embedder does not mask a text embedder mismatch (branches are independent)", () => {
    const result = buildReleasePlan({
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
      modelPacks: [
        { tier: "0.6B", input: completeModelPackInput({ textEmbedderVersion: "text-embed-v1", visionEmbedderVersion: "vision-embed-v1" }) },
      ],
      knowledgeFull: {
        input: {
          version: "1.0.0",
          corpusSnapshotHash: "d".repeat(64),
          chunks: [makeChunk({ chunk_id: "a" })],
          printingIds: ["p1"],
          previousRegistry: null,
          registryVersion: "1.0.0",
          textEmbeddings: providedText("text-embed-v2", ["a"]), // mismatched
          imageEmbeddings: providedImage("vision-embed-v1", ["p1"]), // MATCHES
          calibration: makeCalibration({ embedderVersion: "text-embed-v2" }),
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/text-embed-v1/);
    expect(result.reason).toMatch(/text-embed-v2/);
  });

  it("cross-check: both embedder versions matching (real, non-absent) succeeds and includes the image-vectors asset", () => {
    const result = buildReleasePlan({
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
      modelPacks: [
        { tier: "0.6B", input: completeModelPackInput({ textEmbedderVersion: "text-embed-v1", visionEmbedderVersion: "vision-embed-v1" }) },
      ],
      knowledgeFull: {
        input: {
          version: "1.0.0",
          corpusSnapshotHash: "d".repeat(64),
          chunks: [makeChunk({ chunk_id: "a" })],
          printingIds: ["p1"],
          previousRegistry: null,
          registryVersion: "1.0.0",
          textEmbeddings: providedText("text-embed-v1", ["a"]),
          imageEmbeddings: providedImage("vision-embed-v1", ["p1"]),
          calibration: makeCalibration({ embedderVersion: "text-embed-v1" }),
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`unreachable: ${result.reason}`);
    expect(result.plan.assets.some((a) => a.assetName === "knowledge-full-1.0.0-image-vectors.jsonl")).toBe(true);
  });

  it("refuses to reuse an outDir that already has a prior plan's output, unless force is passed", () => {
    const input = {
      releaseVersion: "1.0.0",
      outDir,
      corpusSnapshotManifestRaw: validCorpusSnapshotManifest,
      modelPacks: [{ tier: "0.6B" as const, input: completeModelPackInput() }],
    };
    const first = buildReleasePlan(input);
    expect(first.ok).toBe(true);

    const second = buildReleasePlan(input);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.reason).toMatch(/already contains a release bundle|force/i);

    const third = buildReleasePlan({ ...input, force: true });
    expect(third.ok).toBe(true);
  });
});
