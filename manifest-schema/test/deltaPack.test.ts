import { describe, it, expect } from "vitest";
import {
  validateDeltaPackManifest,
  validDeltaPackManifest,
  tombstonedDeltaPackManifest,
  invalidDeltaPackManifestMismatchedEmbedder,
} from "../src/index.js";

describe("DeltaPackManifest schema", () => {
  it("accepts the valid fixture", () => {
    const result = validateDeltaPackManifest(validDeltaPackManifest);
    expect(result.success).toBe(true);
  });

  it("requires schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validDeltaPackManifest;
    const result = validateDeltaPackManifest(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "schemaVersion")).toBe(true);
    }
  });

  it("accepts a delta with non-empty tombstones (the tombstoned-delta fixture)", () => {
    const result = validateDeltaPackManifest(tombstonedDeltaPackManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tombstones.chunkIds.length).toBeGreaterThan(0);
      expect(result.data.tombstones.printingIds.length).toBeGreaterThan(0);
    }
  });

  it("requires the tombstones field itself (may be empty arrays, but must be present)", () => {
    const { tombstones: _tombstones, ...rest } = validDeltaPackManifest;
    const result = validateDeltaPackManifest(rest);
    expect(result.success).toBe(false);
  });

  it("accepts a delta whose tombstones are both empty arrays", () => {
    const ok = { ...validDeltaPackManifest, tombstones: { chunkIds: [], printingIds: [] } };
    const result = validateDeltaPackManifest(ok);
    expect(result.success).toBe(true);
  });

  it("rejects a delta whose text embedder version differs between fromVersion and toVersion (§8.8)", () => {
    const result = validateDeltaPackManifest(invalidDeltaPackManifestMismatchedEmbedder);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "toTextEmbedderVersion")).toBe(true);
    }
  });

  it("rejects a delta whose vision embedder version differs between fromVersion and toVersion (§8.8)", () => {
    const bad = { ...validDeltaPackManifest, toVisionEmbedderVersion: "vision-embed-v2" };
    const result = validateDeltaPackManifest(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "toVisionEmbedderVersion")).toBe(true);
    }
  });
});
