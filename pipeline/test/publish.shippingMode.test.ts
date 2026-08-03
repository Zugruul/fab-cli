// APP-029 (SPEC-APP.md §7.10, §8.9; issue #141): "publish dry-run FAILS
// without the shipping-mode schema field (APP-017's assessment as
// precondition)". CorpusSnapshotManifestSchema already REQUIRES
// shippingMode per source at the zod level (manifest-schema/src/
// corpusSnapshot.ts) — this module is the publish-time precondition gate
// that reads a raw corpus-snapshot-manifest JSON and turns that schema
// failure into a clear, human-actionable refusal citing APP-017/§7.10,
// tested in both directions per the AC's exact wording.
import { describe, it, expect } from "vitest";
import { validCorpusSnapshotManifest, invalidCorpusSnapshotManifestMissingShippingMode } from "@fab/manifest-schema";
import { checkShippingModePrecondition } from "../src/publish/shippingMode.js";

describe("checkShippingModePrecondition", () => {
  it("passes when every corpus source records a shipping mode", () => {
    const result = checkShippingModePrecondition(validCorpusSnapshotManifest);
    expect(result.ok).toBe(true);
  });

  it("fails with a clear message naming shippingMode + APP-017/§7.10 when a source omits it", () => {
    const result = checkShippingModePrecondition(invalidCorpusSnapshotManifestMissingShippingMode);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/shippingMode/);
    expect(result.reason).toMatch(/APP-017|§7\.10/);
  });

  it("fails on a completely malformed manifest, not just the shippingMode-specific omission", () => {
    const result = checkShippingModePrecondition({ not: "a manifest" });
    expect(result.ok).toBe(false);
  });

  it("fails on a raw JSON string that doesn't even parse to an object", () => {
    const result = checkShippingModePrecondition(null);
    expect(result.ok).toBe(false);
  });
});
