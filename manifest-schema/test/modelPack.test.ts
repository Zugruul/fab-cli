import { describe, it, expect } from "vitest";
import {
  validateModelPackManifest,
  validModelPackManifest,
  invalidModelPackManifestMissingLicenseId,
  invalidModelPackManifestBadLicenseId,
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

  it("rejects a placeholder licenseId ('TODO'), with a precise error path", () => {
    const bad = {
      ...validModelPackManifest,
      artifacts: [{ ...validModelPackManifest.artifacts[0], licenseId: "TODO" }],
    };
    const result = validateModelPackManifest(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "artifacts.0.licenseId")).toBe(true);
    }
  });

  it("rejects a prose licenseId ('see LICENSE file'), with a precise error path", () => {
    const bad = {
      ...validModelPackManifest,
      artifacts: [{ ...validModelPackManifest.artifacts[0], licenseId: "see LICENSE file" }],
    };
    const result = validateModelPackManifest(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "artifacts.0.licenseId")).toBe(true);
    }
  });

  it("accepts real SPDX license identifiers (MIT, Apache-2.0, GPL-3.0-only)", () => {
    for (const licenseId of ["MIT", "Apache-2.0", "GPL-3.0-only"]) {
      const ok = {
        ...validModelPackManifest,
        artifacts: [{ ...validModelPackManifest.artifacts[0], licenseId }],
      };
      expect(validateModelPackManifest(ok).success, licenseId).toBe(true);
    }
  });

  it("rejects the exported invalid-licenseId fixture, with a precise error path", () => {
    const result = validateModelPackManifest(invalidModelPackManifestBadLicenseId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "artifacts.0.licenseId")).toBe(true);
    }
  });

  // --- APP-022 (#134): evalScores is required (§13 invariant 8) ---------

  it("rejects a manifest with no evalScores field at all", () => {
    const { evalScores: _evalScores, ...rest } = validModelPackManifest as typeof validModelPackManifest;
    const result = validateModelPackManifest(rest);
    expect(result.success).toBe(false);
  });
});
