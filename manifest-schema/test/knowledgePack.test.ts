import { describe, it, expect } from "vitest";
import {
  validateKnowledgePackManifest,
  validKnowledgePackManifest,
  invalidKnowledgePackManifestMissingRetrievalFloor,
  invalidKnowledgePackManifestMissingOodThreshold,
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

  it("rejects an indexFiles entry with a malformed sha256", () => {
    const bad = {
      ...validKnowledgePackManifest,
      indexFiles: [{ name: "chunks.sqlite", sha256: "zz" }],
    };
    const result = validateKnowledgePackManifest(bad);
    expect(result.success).toBe(false);
  });
});
