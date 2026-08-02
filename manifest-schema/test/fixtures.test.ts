import { describe, it, expect } from "vitest";
import { validKnowledgePackManifest, validCorpusSnapshotManifest } from "../src/index.js";

// BUG-195: the valid fixture chain (model pack -> knowledge pack -> corpus
// snapshot) should cross-link end-to-end, so consumer tests can exercise the
// real §9.4 corpusSnapshotHash linkage against the shared fixtures directly
// instead of hand-rolling a locally aligned copy.
describe("valid fixture chain cross-links (BUG-195)", () => {
  it("validKnowledgePackManifest.corpusSnapshotHash matches validCorpusSnapshotManifest.contentHash", () => {
    expect(validKnowledgePackManifest.corpusSnapshotHash).toBe(
      validCorpusSnapshotManifest.contentHash,
    );
  });
});
