// APP-029 (SPEC-APP.md §8.8 [tier packs], §8.9, issue #141): the model-pack
// assembler takes an artifact-map input (one real file per named slot) and
// produces a schema-valid ModelPackManifest plus the flat asset list a
// publish step would upload. Missing slots fail loudly and list exactly
// what's absent — the assembler never fabricates a stand-in file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateModelPackManifest, validEvalScores } from "@fab/manifest-schema";
import { assembleModelPack, MissingArtifactsError } from "../src/publish/modelPackAssembler.js";
import type { AssembleModelPackInput } from "../src/publish/types.js";

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

describe("assembleModelPack", () => {
  let tmpDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-model-assets-"));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-model-out-"));
    fs.writeFileSync(path.join(tmpDir, "fab-slm-1.7b-q4_k_m.gguf"), "merged-llm-bytes");
    fs.writeFileSync(path.join(tmpDir, "bge-small-en-v1.5.gguf"), "text-embedder-bytes");
    fs.writeFileSync(path.join(tmpDir, "detector.tflite"), "detector-bytes");
    fs.writeFileSync(path.join(tmpDir, "embedder.tflite"), "vision-embedder-bytes");
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  function baseInput(overrides: Partial<AssembleModelPackInput> = {}): AssembleModelPackInput {
    return {
      tier: "1.7B",
      outDir,
      artifacts: {
        mergedGguf: { path: path.join(tmpDir, "fab-slm-1.7b-q4_k_m.gguf"), licenseId: "Apache-2.0", version: "export-smoke-1" },
        textEmbedderGguf: { path: path.join(tmpDir, "bge-small-en-v1.5.gguf"), licenseId: "MIT", version: "text-embed-v1" },
        detectorTflite: { path: path.join(tmpDir, "detector.tflite"), licenseId: "Apache-2.0", version: "detector-v1" },
        visionEmbedderTflite: { path: path.join(tmpDir, "embedder.tflite"), licenseId: "Apache-2.0", version: "vision-embed-v1" },
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
    };
  }

  it("assembles a schema-valid manifest from four real on-disk artifacts", () => {
    const { manifest } = assembleModelPack(baseInput());
    const validation = validateModelPackManifest(manifest);
    expect(validation.success).toBe(true);
    expect(manifest.tier).toBe("1.7B");
    expect(manifest.artifacts).toHaveLength(4);
  });

  it("computes each artifact's sha256/sizeBytes from the REAL file bytes, not the caller-supplied metadata", () => {
    const { manifest } = assembleModelPack(baseInput());
    const merged = manifest.artifacts.find((a) => a.file === "fab-slm-1.7b-q4_k_m.gguf")!;
    expect(merged.sha256).toBe(sha256("merged-llm-bytes"));
    expect(merged.sizeBytes).toBe(Buffer.byteLength("merged-llm-bytes"));

    const textEmbedder = manifest.artifacts.find((a) => a.file === "bge-small-en-v1.5.gguf")!;
    expect(textEmbedder.sha256).toBe(sha256("text-embedder-bytes"));
  });

  it("writes manifest.json to outDir, byte-identical to the returned manifest", () => {
    const { manifest } = assembleModelPack(baseInput());
    const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(onDisk).toEqual(manifest);
  });

  it("the returned bundle lists 5 assets (4 artifact files + manifest.json), each pointing at a real local path", () => {
    const { bundle } = assembleModelPack(baseInput());
    expect(bundle.kind).toBe("model-pack");
    expect(bundle.assets).toHaveLength(5);
    for (const asset of bundle.assets) {
      expect(fs.existsSync(asset.localPath)).toBe(true);
      expect(asset.sha256).toBe(sha256(fs.readFileSync(asset.localPath)));
    }
  });

  it("MissingArtifactsError lists EVERY missing slot, not just the first one found", () => {
    const input = baseInput({
      artifacts: {
        mergedGguf: { path: path.join(tmpDir, "fab-slm-1.7b-q4_k_m.gguf"), licenseId: "Apache-2.0", version: "export-smoke-1" },
        textEmbedderGguf: null,
        detectorTflite: null,
        visionEmbedderTflite: { path: path.join(tmpDir, "embedder.tflite"), licenseId: "Apache-2.0", version: "vision-embed-v1" },
      },
    });
    try {
      assembleModelPack(input);
      throw new Error("expected assembleModelPack to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingArtifactsError);
      const missingErr = err as MissingArtifactsError;
      expect(missingErr.missing).toEqual(["textEmbedderGguf", "detectorTflite"]);
      expect(missingErr.message).toMatch(/textEmbedderGguf/);
      expect(missingErr.message).toMatch(/detectorTflite/);
      expect(missingErr.message).not.toMatch(/never fabricates a stand-in file for mergedGguf/);
    }
    // A refused assembly must never partially write output.
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(false);
  });

  it("throws (never fabricates a hash) when a slot's path points at a file that doesn't exist on disk", () => {
    const input = baseInput({
      artifacts: {
        ...baseInput().artifacts,
        detectorTflite: { path: path.join(tmpDir, "does-not-exist.tflite"), licenseId: "Apache-2.0", version: "detector-v1" },
      },
    });
    expect(() => assembleModelPack(input)).toThrow(/does not exist/);
  });

  it("propagates the manifest-schema's placeholder-licenseId guard rather than bypassing it", () => {
    const input = baseInput({
      artifacts: {
        ...baseInput().artifacts,
        detectorTflite: { path: path.join(tmpDir, "detector.tflite"), licenseId: "TODO", version: "detector-v1" },
      },
    });
    expect(() => assembleModelPack(input)).toThrow(/schema validation/);
  });

  it("boundary: the 0.6B tier assembles identically (tier is not hardcoded to 1.7B anywhere)", () => {
    const { manifest } = assembleModelPack(baseInput({ tier: "0.6B", outDir: path.join(outDir, "06b") }));
    expect(manifest.tier).toBe("0.6B");
    expect(validateModelPackManifest(manifest).success).toBe(true);
  });
});
