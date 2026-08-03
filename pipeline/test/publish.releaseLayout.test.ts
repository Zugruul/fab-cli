// APP-029 (SPEC-APP.md §8.9, issue #141): the documented versioned release
// layout — asset naming convention and the checksums file format the
// app-side artifact manager (fab-app/src/artifacts) consumes. Naming is a
// pure function so it's independently unit-tested from the assemblers.
import { describe, it, expect } from "vitest";
import {
  modelAssetName,
  modelManifestAssetName,
  knowledgeFullAssetName,
  knowledgeDeltaAssetName,
  releaseTag,
  formatChecksumsFile,
} from "../src/publish/releaseLayout.js";

describe("asset naming", () => {
  it("prefixes model-pack asset names with the tier, keeping the real file name intact", () => {
    expect(modelAssetName("1.7B", "fab-slm-1.7b-q4_k_m.gguf")).toBe("model-1.7B-fab-slm-1.7b-q4_k_m.gguf");
  });

  it("ADVERSARIAL: two tiers sharing an identical underlying file basename never collide in asset name", () => {
    const a = modelAssetName("1.7B", "detector.tflite");
    const b = modelAssetName("0.6B", "detector.tflite");
    expect(a).not.toBe(b);
  });

  it("model asset naming takes no release-version argument — stable across releases by construction", () => {
    expect(modelAssetName.length).toBe(2);
    expect(modelManifestAssetName.length).toBe(1);
  });

  it("knowledge full vs delta asset names never collide for the same version pair", () => {
    const full = knowledgeFullAssetName("1.0.0", "chunks-index.jsonl");
    const delta = knowledgeDeltaAssetName("1.0.0", "1.1.0", "chunks-index.jsonl");
    expect(full).not.toBe(delta);
  });

  it("ADVERSARIAL: a delta whose fromVersion equals another delta's toVersion still produces distinct names", () => {
    const deltaA = knowledgeDeltaAssetName("1.0.0", "1.1.0", "chunks-index.jsonl");
    const deltaB = knowledgeDeltaAssetName("1.1.0", "1.2.0", "chunks-index.jsonl");
    expect(deltaA).not.toBe(deltaB);
  });

  it("release tag is derived deterministically from the release version", () => {
    expect(releaseTag("1.0.0")).toBe("pack-1.0.0");
  });
});

describe("formatChecksumsFile", () => {
  it("emits one sorted 'sha256  name' line per asset (SHA256SUMS convention)", () => {
    const out = formatChecksumsFile([
      { assetName: "model-1.7B-b.gguf", sha256: "b".repeat(64) },
      { assetName: "model-1.7B-a.gguf", sha256: "a".repeat(64) },
    ]);
    expect(out).toBe(`${"a".repeat(64)}  model-1.7B-a.gguf\n${"b".repeat(64)}  model-1.7B-b.gguf\n`);
  });

  it("boundary: zero assets produces an empty (not malformed) file", () => {
    expect(formatChecksumsFile([])).toBe("");
  });

  it("sort order is by asset name, independent of input order (deterministic across re-runs)", () => {
    const assetsA = [
      { assetName: "z-last", sha256: "1".repeat(64) },
      { assetName: "a-first", sha256: "2".repeat(64) },
    ];
    const assetsB = [...assetsA].reverse();
    expect(formatChecksumsFile(assetsA)).toBe(formatChecksumsFile(assetsB));
  });
});
