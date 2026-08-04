// Shared fixtures for the publish.*.test.ts suite (APP-029, issue #141).
// Not itself a test file — vitest's default include pattern only picks up
// *.test.ts. Fixtures below mirror the REAL producer manifest shapes
// (export/types.ts's ExportRunManifest, train-vision/types.ts's
// VisionRunManifest, train-vision/embedTypes.ts's EmbedRunManifest) field
// for field — dev-brain lesson "read producers' real bytes before
// fixtures" — rather than inventing a simplified shape of our own.
import type { ExportRunManifest } from "../src/export/types.js";
import type { VisionRunManifest } from "../src/train-vision/types.js";
import type { EmbedRunManifest } from "../src/train-vision/embedTypes.js";
import type { CalibrationArtifact } from "../src/eval/calibration.js";

export function makeExportRunManifest(overrides: Partial<ExportRunManifest> = {}): ExportRunManifest {
  return {
    schemaVersion: "0.1.0",
    runId: "export-smoke-1",
    tier: "1.7B",
    baseModel: "unsloth/Qwen3-1.7B",
    baseModelHash: "c".repeat(64),
    source: { trainingRunId: null, adaptersDir: null, adaptersSha256s: [] },
    quantizations: ["Q4_K_M", "Q8_0"],
    artifacts: {
      files: [
        { file: "fab-slm-1.7b-q4_k_m.gguf", quantization: "Q4_K_M", sizeBytes: 123, sha256: "a".repeat(64) },
        { file: "fab-slm-1.7b-q8_0.gguf", quantization: "Q8_0", sizeBytes: 456, sha256: "b".repeat(64) },
      ],
    },
    smoke: { schema: {}, perFile: [] },
    licenses: {
      baseModel: "Apache-2.0",
      adapters: "Apache-2.0 (LoRA delta trained via Unsloth over the Apache-2.0 Qwen3 base)",
      ggufs: "Derived artifact: base weights merged with the adapter and requantized via llama.cpp",
    },
    environment: { lockfileSha256: "d".repeat(64), torch: "2.1.0", cuda: "12.1", driver: "550.54", unsloth: "2024.1", gpu: "A100" },
    dispatch: { resource: "storm590x", jobId: "job-1", capabilityJob: "slm-training:export-gguf" },
    timestamps: { dispatchedAt: "2026-08-01T00:00:00.000Z", completedAt: "2026-08-01T01:00:00.000Z" },
    status: "completed",
    ...overrides,
  };
}

export function makeVisionRunManifest(overrides: Partial<VisionRunManifest> = {}): VisionRunManifest {
  return {
    schemaVersion: "0.1.0",
    runId: "vision-smoke-1",
    architecture: "obb-centernet-tiny",
    configHash: "e".repeat(64),
    dataset: { dir: "pipeline/out/composites-smoke", manifestHash: "f".repeat(64) },
    seed: 20260803,
    metrics: {
      syntheticVal: { mAP: 0.5, perThreshold: { "0.5": 0.6, "0.75": 0.3 } },
      realPhotoBenchmark: null,
      realPhotoBenchmarkReason: "QA-gated: APP-025's real-photo benchmark photo set has not been shot yet.",
    },
    licenses: {
      trainingCode: "MIT",
      torch: "BSD-3-Clause",
      torchvision: "BSD-3-Clause",
      litertTorch: "Apache-2.0",
      aiEdgeLitert: "Apache-2.0",
      litertConverter: "Apache-2.0",
    },
    environment: { torch: "2.12.1", cuda: null, driver: null, gpu: null },
    dispatch: { resource: "local", jobId: "vision-smoke-1", capabilityJob: "local-cpu-smoke" },
    artifacts: { checkpointFile: { name: "checkpoint.pt", sha256: "1".repeat(64) }, tfliteFiles: [{ name: "detector.tflite", sha256: "2".repeat(64) }] },
    timestamps: { dispatchedAt: null as unknown as string, completedAt: null },
    status: "completed",
    ...overrides,
  };
}

export function makeEmbedRunManifest(overrides: Partial<EmbedRunManifest> = {}): EmbedRunManifest {
  return {
    schemaVersion: "0.1.0",
    runId: "embed-smoke-1",
    architecture: "arcface-embedder-tiny",
    embedderVersion: "vision-embed-v1",
    embeddingDim: 128,
    configHash: "3".repeat(64),
    dataset: { dir: "pipeline/out/composites-smoke", manifestHash: "4".repeat(64) },
    seed: 20260803,
    metrics: {
      syntheticValRetrieval: { top1: 0.8, top5: 0.95, queryCount: 50 },
      syntheticValRetrievalReason: null,
      realPhotoBenchmarkTop1: null,
      realPhotoBenchmarkReason: "QA-gated: APP-025's real-photo benchmark photo set has not been shot yet.",
    },
    licenses: {
      trainingCode: "MIT",
      torch: "BSD-3-Clause",
      litertTorch: "Apache-2.0",
      aiEdgeLitert: "Apache-2.0",
      litertConverter: "Apache-2.0",
      aiEdgeQuantizer: "Apache-2.0",
    },
    environment: { torch: "2.12.1", cuda: null, driver: null, gpu: null },
    dispatch: { resource: "local", jobId: "embed-smoke-1", capabilityJob: "local-cpu-smoke" },
    artifacts: { checkpointFile: { name: "checkpoint.pt", sha256: "5".repeat(64) }, tfliteFiles: [{ name: "embedder.tflite", sha256: "6".repeat(64) }] },
    timestamps: { dispatchedAt: "2026-08-01T00:00:00.000Z", completedAt: "2026-08-01T01:00:00.000Z" },
    status: "completed",
    ...overrides,
  };
}

export function makeCalibration(overrides: Partial<CalibrationArtifact> = {}): CalibrationArtifact {
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
