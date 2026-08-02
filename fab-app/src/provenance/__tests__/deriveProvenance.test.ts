// §9.4: "THE SYSTEM SHALL surface knowledge provenance in the UI: 'knowledge
// up to: <latest set>, CR <version>, legality as of <date>' derived from the
// active manifests." deriveProvenance is the pure derivation step the
// Knowledge screen renders from — kept separate from ProvenanceScreen.tsx so
// the field-mapping logic is unit-testable without react-test-renderer.

import { validCorpusSnapshotManifest, validKnowledgePackManifest } from "@fab/manifest-schema";
import { deriveProvenance } from "../deriveProvenance";

// BUG-195: manifest-schema's fixtures.ts now cross-links the valid fixture
// chain (validKnowledgePackManifest.corpusSnapshotHash ===
// validCorpusSnapshotManifest.contentHash, both "d".repeat(64)), so the
// "ready" case below exercises the real §9.4 linkage directly against the
// shared fixtures instead of a locally aligned copy.

describe("deriveProvenance (§9.4 knowledge provenance)", () => {
  it("renders all three provenance fields from a valid, hash-linked fixture manifest chain", () => {
    const result = deriveProvenance({
      knowledgePack: validKnowledgePackManifest,
      corpusSnapshot: validCorpusSnapshotManifest,
    });

    expect(result).toEqual({
      status: "ready",
      latestSet: validCorpusSnapshotManifest.latestSetCode,
      crVersion: validCorpusSnapshotManifest.crVersion,
      legalityAsOf: validCorpusSnapshotManifest.legalityPolicyFetchedAt,
    });
  });

  it("returns the honest empty state when no knowledge pack is installed", () => {
    expect(deriveProvenance(null)).toEqual({
      status: "not-installed",
      message: "no knowledge pack installed yet",
    });
  });

  it("flags the chain as unverified when corpusSnapshotHash does not match the linked snapshot's contentHash", () => {
    // Deliberately mismatched (the shared fixtures are cross-linked now, so
    // this override is what actually breaks the chain for this case).
    const mismatchedSnapshot = { ...validCorpusSnapshotManifest, contentHash: "f".repeat(64) };
    const result = deriveProvenance({
      knowledgePack: validKnowledgePackManifest,
      corpusSnapshot: mismatchedSnapshot,
    });

    expect(result.status).toBe("unverified");
    if (result.status === "unverified") {
      expect(result.message).toContain(validKnowledgePackManifest.corpusSnapshotHash);
      expect(result.message).toContain(mismatchedSnapshot.contentHash);
    }
  });
});
