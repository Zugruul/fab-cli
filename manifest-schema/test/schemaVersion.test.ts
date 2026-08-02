import { describe, it, expect } from "vitest";
import {
  validateCorpusSnapshotManifest,
  validateModelPackManifest,
  validateKnowledgePackManifest,
  validateDeltaPackManifest,
  validateRevocationList,
  validCorpusSnapshotManifest,
  validModelPackManifest,
  validKnowledgePackManifest,
  validDeltaPackManifest,
  validRevocationList,
} from "../src/index.js";

// Cross-cutting check (in addition to the per-schema "requires schemaVersion"
// tests): every one of the five root manifest types shares the same
// versioning discipline (APP-016 AC — "schemaVersion required everywhere").
describe("schemaVersion is required on every root manifest type", () => {
  const cases: [string, (input: unknown) => { success: boolean }, Record<string, unknown>][] = [
    ["CorpusSnapshotManifest", validateCorpusSnapshotManifest, validCorpusSnapshotManifest],
    ["ModelPackManifest", validateModelPackManifest, validModelPackManifest],
    ["KnowledgePackManifest", validateKnowledgePackManifest, validKnowledgePackManifest],
    ["DeltaPackManifest", validateDeltaPackManifest, validDeltaPackManifest],
    ["RevocationList", validateRevocationList, validRevocationList],
  ];

  for (const [name, validateFn, validFixture] of cases) {
    it(`${name} rejects input with schemaVersion stripped`, () => {
      const { schemaVersion: _schemaVersion, ...rest } = validFixture;
      expect(validateFn(rest).success).toBe(false);
    });

    it(`${name} rejects an empty-string schemaVersion`, () => {
      expect(validateFn({ ...validFixture, schemaVersion: "" }).success).toBe(false);
    });
  }
});
