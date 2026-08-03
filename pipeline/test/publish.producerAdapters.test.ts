// APP-029 (SPEC-APP.md §8.9, issue #141): the publish assembler consumes
// REAL producer manifests (APP-021's export chain, APP-027/028's
// train-vision chains) rather than a bespoke fixture shape. These adapters
// resolve a manifest's recorded file entry into a real local path — they
// never fabricate a path for a file that doesn't exist, and never silently
// guess when a manifest is ambiguous (more than one tflite candidate).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveMergedGgufPath, resolveDetectorTflitePath, resolveVisionEmbedderTflitePath } from "../src/publish/producerAdapters.js";
import { makeExportRunManifest, makeVisionRunManifest, makeEmbedRunManifest } from "./publish.helpers.js";

describe("resolveMergedGgufPath (APP-021's export-runs/<runId>/gguf/ layout)", () => {
  let runDir: string;
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-export-"));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("resolves the real gguf file path for the requested quantization", () => {
    const ggufDir = path.join(runDir, "gguf");
    fs.mkdirSync(ggufDir, { recursive: true });
    fs.writeFileSync(path.join(ggufDir, "fab-slm-1.7b-q4_k_m.gguf"), "fake-gguf-bytes");

    const manifest = makeExportRunManifest();
    const resolved = resolveMergedGgufPath(manifest, runDir, "Q4_K_M");
    expect(resolved).toBe(path.join(ggufDir, "fab-slm-1.7b-q4_k_m.gguf"));
  });

  it("throws listing the quantizations that DO exist when the requested one isn't in the manifest", () => {
    const manifest = makeExportRunManifest();
    expect(() => resolveMergedGgufPath(manifest, runDir, "Q5_K_M")).toThrow(/Q5_K_M/);
    expect(() => resolveMergedGgufPath(manifest, runDir, "Q5_K_M")).toThrow(/Q4_K_M, Q8_0/);
  });

  it("throws when the manifest's file entry has no corresponding file on disk (dangling reference, never fabricated)", () => {
    const manifest = makeExportRunManifest();
    // Deliberately do NOT create pipeline/out/.../gguf/fab-slm-1.7b-q4_k_m.gguf.
    expect(() => resolveMergedGgufPath(manifest, runDir, "Q4_K_M")).toThrow(/does not exist/);
  });

  it("boundary: an export run that produced zero quantizations reports 'none' rather than an empty list", () => {
    const manifest = makeExportRunManifest({ artifacts: { files: [] } });
    expect(() => resolveMergedGgufPath(manifest, runDir, "Q4_K_M")).toThrow(/none produced/);
  });

  it("accepts an absolute file path recorded in the manifest as-is, without re-rooting it under gguf/", () => {
    const absoluteFile = path.join(runDir, "elsewhere", "custom.gguf");
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
    fs.writeFileSync(absoluteFile, "fake-bytes");
    const manifest = makeExportRunManifest({
      artifacts: { files: [{ file: absoluteFile, quantization: "Q4_K_M", sizeBytes: 11, sha256: "a".repeat(64) }] },
    });
    expect(resolveMergedGgufPath(manifest, runDir, "Q4_K_M")).toBe(absoluteFile);
  });
});

describe("resolveDetectorTflitePath (APP-027's vision-runs/<runId>/output/ layout)", () => {
  let runDir: string;
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-vision-"));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("resolves the single real tflite file under output/", () => {
    const outputDir = path.join(runDir, "output");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "detector.tflite"), "fake-tflite-bytes");

    const manifest = makeVisionRunManifest({
      artifacts: { checkpointFile: null, tfliteFiles: [{ name: "detector.tflite", sha256: "x".repeat(64) }] },
    });
    expect(resolveDetectorTflitePath(manifest, runDir)).toBe(path.join(outputDir, "detector.tflite"));
  });

  it("throws a QA-gated-style message when the run produced zero tflite files yet", () => {
    const manifest = makeVisionRunManifest({ artifacts: { checkpointFile: null, tfliteFiles: [] } });
    expect(() => resolveDetectorTflitePath(manifest, runDir)).toThrow(/no tflite/i);
  });

  it("throws an ambiguous-selection error (never silently picks one) when a run produced more than one tflite file", () => {
    const manifest = makeVisionRunManifest({
      artifacts: {
        checkpointFile: null,
        tfliteFiles: [
          { name: "a.tflite", sha256: "x".repeat(64) },
          { name: "b.tflite", sha256: "y".repeat(64) },
        ],
      },
    });
    expect(() => resolveDetectorTflitePath(manifest, runDir)).toThrow(/ambiguous/i);
    expect(() => resolveDetectorTflitePath(manifest, runDir)).toThrow(/a\.tflite, b\.tflite/);
  });

  it("throws when the sole tflite entry has no file on disk (dangling reference, never fabricated)", () => {
    const manifest = makeVisionRunManifest({
      artifacts: { checkpointFile: null, tfliteFiles: [{ name: "detector.tflite", sha256: "x".repeat(64) }] },
    });
    expect(() => resolveDetectorTflitePath(manifest, runDir)).toThrow(/does not exist/);
  });
});

describe("resolveVisionEmbedderTflitePath (APP-028's vision-runs/<runId>/output/ layout)", () => {
  let runDir: string;
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-embed-"));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("resolves the real embedder tflite file the same way as the detector, under its own run dir", () => {
    const outputDir = path.join(runDir, "output");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "embedder.tflite"), "fake-embedder-bytes");

    const manifest = makeEmbedRunManifest({
      artifacts: { checkpointFile: null, tfliteFiles: [{ name: "embedder.tflite", sha256: "z".repeat(64) }] },
    });
    expect(resolveVisionEmbedderTflitePath(manifest, runDir)).toBe(path.join(outputDir, "embedder.tflite"));
  });

  it("throws a QA-gated-style message when the run produced zero tflite files yet", () => {
    const manifest = makeEmbedRunManifest({ artifacts: { checkpointFile: null, tfliteFiles: [] } });
    expect(() => resolveVisionEmbedderTflitePath(manifest, runDir)).toThrow(/no tflite/i);
  });
});
