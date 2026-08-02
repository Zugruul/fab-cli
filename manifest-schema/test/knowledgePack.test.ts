import { describe, it, expect } from "vitest";
import {
  validateKnowledgePackManifest,
  validKnowledgePackManifest,
  invalidKnowledgePackManifestMissingRetrievalFloor,
  invalidKnowledgePackManifestMissingOodThreshold,
  invalidKnowledgePackManifestOodThresholdEqualsFloor,
  invalidKnowledgePackManifestOodThresholdAboveFloor,
} from "../src/index.js";

describe("KnowledgePackManifest schema", () => {
  it("accepts the valid fixture", () => {
    const result = validateKnowledgePackManifest(validKnowledgePackManifest);
    expect(result.success).toBe(true);
  });

  it("requires schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validKnowledgePackManifest;
    const result = validateKnowledgePackManifest(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "schemaVersion")).toBe(true);
    }
  });

  it("rejects a manifest missing retrievalFloor (§9.7 calibrated abstention floor), precise error path", () => {
    const result = validateKnowledgePackManifest(invalidKnowledgePackManifestMissingRetrievalFloor);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "retrievalFloor")).toBe(true);
    }
  });

  it("rejects a manifest missing oodThreshold (§10.9 calibrated OOD threshold), precise error path", () => {
    const result = validateKnowledgePackManifest(invalidKnowledgePackManifestMissingOodThreshold);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "oodThreshold")).toBe(true);
    }
  });

  it("rejects a manifest whose oodThreshold equals retrievalFloor (§10.9 requires 'well below', not equal), precise error path", () => {
    const result = validateKnowledgePackManifest(invalidKnowledgePackManifestOodThresholdEqualsFloor);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "oodThreshold")).toBe(true);
    }
  });

  it("rejects a manifest whose oodThreshold exceeds retrievalFloor (§10.9 calibration invariant), precise error path", () => {
    const result = validateKnowledgePackManifest(invalidKnowledgePackManifestOodThresholdAboveFloor);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "oodThreshold")).toBe(true);
    }
  });

  it("accepts a manifest whose oodThreshold is strictly below retrievalFloor by a small margin", () => {
    const ok = { ...validKnowledgePackManifest, retrievalFloor: 0.3, oodThreshold: 0.299 };
    const result = validateKnowledgePackManifest(ok);
    expect(result.success).toBe(true);
  });

  it("rejects an indexFiles entry with a malformed sha256", () => {
    const bad = {
      ...validKnowledgePackManifest,
      indexFiles: [{ name: "chunks.sqlite", sha256: "zz" }],
    };
    const result = validateKnowledgePackManifest(bad);
    expect(result.success).toBe(false);
  });

  // --- BUG-202: per-file sizeBytes on indexFiles ---------------------------

  it("accepts an indexFiles entry with sizeBytes and preserves the exact value", () => {
    const manifest = {
      ...validKnowledgePackManifest,
      indexFiles: [{ name: "chunks.sqlite", sha256: "e".repeat(64), sizeBytes: 123_456 }],
    };
    const result = validateKnowledgePackManifest(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.indexFiles[0].sizeBytes).toBe(123_456);
    }
  });

  it("rejects an indexFiles entry missing sizeBytes (BUG-202: manifest must carry the size, not the caller), precise error path", () => {
    const manifest = {
      ...validKnowledgePackManifest,
      indexFiles: [{ name: "chunks.sqlite", sha256: "e".repeat(64) }],
    };
    const result = validateKnowledgePackManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "indexFiles.0.sizeBytes")).toBe(true);
    }
  });

  it("rejects a negative sizeBytes, precise error path", () => {
    const manifest = {
      ...validKnowledgePackManifest,
      indexFiles: [{ name: "chunks.sqlite", sha256: "e".repeat(64), sizeBytes: -1 }],
    };
    const result = validateKnowledgePackManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "indexFiles.0.sizeBytes")).toBe(true);
    }
  });

  it("rejects a non-integer sizeBytes, precise error path", () => {
    const manifest = {
      ...validKnowledgePackManifest,
      indexFiles: [{ name: "chunks.sqlite", sha256: "e".repeat(64), sizeBytes: 12.5 }],
    };
    const result = validateKnowledgePackManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "indexFiles.0.sizeBytes")).toBe(true);
    }
  });
});
