import { describe, it, expect } from "vitest";
import {
  validateCorpusSnapshotManifest,
  validCorpusSnapshotManifest,
  invalidCorpusSnapshotManifestMissingShippingMode,
} from "../src/index.js";

describe("CorpusSnapshotManifest schema", () => {
  it("accepts the valid fixture", () => {
    const result = validateCorpusSnapshotManifest(validCorpusSnapshotManifest);
    expect(result.success).toBe(true);
  });

  it("requires schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validCorpusSnapshotManifest;
    const result = validateCorpusSnapshotManifest(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "schemaVersion")).toBe(true);
    }
  });

  it("rejects a source entry missing shippingMode, with a precise error path", () => {
    const result = validateCorpusSnapshotManifest(invalidCorpusSnapshotManifestMissingShippingMode);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "sources.0.shippingMode")).toBe(true);
    }
  });

  it("rejects an unknown shippingMode value", () => {
    const bad = {
      ...validCorpusSnapshotManifest,
      sources: [{ name: "x", count: 1, shippingMode: "translated", skipped: 0 }],
    };
    const result = validateCorpusSnapshotManifest(bad);
    expect(result.success).toBe(false);
  });

  it("skipped defaults to required (not optional) — a source omitting it is rejected", () => {
    const bad = {
      ...validCorpusSnapshotManifest,
      sources: [{ name: "x", count: 1, shippingMode: "verbatim" }],
    };
    const result = validateCorpusSnapshotManifest(bad);
    expect(result.success).toBe(false);
  });

  it("note is optional — a source omitting it is still valid", () => {
    const ok = {
      ...validCorpusSnapshotManifest,
      sources: [{ name: "x", count: 1, shippingMode: "verbatim", skipped: 0 }],
    };
    const result = validateCorpusSnapshotManifest(ok);
    expect(result.success).toBe(true);
  });
});
