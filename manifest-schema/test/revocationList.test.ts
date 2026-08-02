import { describe, it, expect } from "vitest";
import { validateRevocationList, validRevocationList, emptyRevocationList } from "../src/index.js";

describe("RevocationList schema", () => {
  it("accepts the valid fixture (a revoked-version sample)", () => {
    const result = validateRevocationList(validRevocationList);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.revokedVersions.length).toBeGreaterThan(0);
    }
  });

  it("accepts an empty revocation list", () => {
    const result = validateRevocationList(emptyRevocationList);
    expect(result.success).toBe(true);
  });

  it("requires schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validRevocationList;
    const result = validateRevocationList(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "schemaVersion")).toBe(true);
    }
  });

  it("rejects a revoked-version entry missing reason, with a precise error path", () => {
    const bad = {
      schemaVersion: "0.1.0",
      revokedVersions: [{ artifact: "knowledge-pack", version: "1.0.0" }],
    };
    const result = validateRevocationList(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "revokedVersions.0.reason")).toBe(true);
    }
  });
});
