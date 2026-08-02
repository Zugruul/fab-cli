import { describe, it, expect } from "vitest";
import {
  validateModelPackManifest,
  validModelPackManifest,
  invalidModelPackManifestMissingLicenseId,
} from "../src/index.js";

describe("ModelPackManifest schema", () => {
  it("accepts the valid fixture", () => {
    const result = validateModelPackManifest(validModelPackManifest);
    expect(result.success).toBe(true);
  });

  it("requires schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validModelPackManifest;
    const result = validateModelPackManifest(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "schemaVersion")).toBe(true);
    }
  });

  it("rejects an artifact missing licenseId (SPDX id), with a precise error path", () => {
    const result = validateModelPackManifest(invalidModelPackManifestMissingLicenseId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "artifacts.0.licenseId")).toBe(true);
    }
  });

  it("rejects an unknown tier value", () => {
    const bad = { ...validModelPackManifest, tier: "3B" };
    const result = validateModelPackManifest(bad);
    expect(result.success).toBe(false);
  });

  it("accepts both defined tiers", () => {
    expect(validateModelPackManifest({ ...validModelPackManifest, tier: "1.7B" }).success).toBe(true);
    expect(validateModelPackManifest({ ...validModelPackManifest, tier: "0.6B" }).success).toBe(true);
  });

  it("rejects a malformed sha256 (not 64 hex chars)", () => {
    const bad = {
      ...validModelPackManifest,
      artifacts: [{ ...validModelPackManifest.artifacts[0], sha256: "not-a-hash" }],
    };
    const result = validateModelPackManifest(bad);
    expect(result.success).toBe(false);
  });
});
