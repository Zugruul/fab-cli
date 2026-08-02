// §9.4: "THE SYSTEM SHALL surface knowledge provenance in the UI: 'knowledge
// up to: <latest set>, CR <version>, legality as of <date>' derived from the
// active manifests." deriveProvenance is the pure derivation step the
// Knowledge screen renders from — kept separate from ProvenanceScreen.tsx so
// the field-mapping logic is unit-testable without react-test-renderer.

import { validCorpusSnapshotManifest, validKnowledgePackManifest } from "@fab/manifest-schema";
import { deriveProvenance } from "../deriveProvenance";

// manifest-schema's fixtures.ts documents one valid fixture per manifest
// type independently — they aren't cross-linked (validKnowledgePackManifest
// .corpusSnapshotHash is "d".repeat(64), validCorpusSnapshotManifest
// .contentHash is "a".repeat(64)). Align them here to exercise the real
// corpusSnapshotHash linkage §9.4 asks for, rather than editing the shared
// fixtures (out of this task's scope: manifest-schema/ source is no-touch).
const linkedCorpusSnapshot = {
  ...validCorpusSnapshotManifest,
  contentHash: validKnowledgePackManifest.corpusSnapshotHash,
};

describe("deriveProvenance (§9.4 knowledge provenance)", () => {
  it("renders all three provenance fields from a valid, hash-linked fixture manifest chain", () => {
    const result = deriveProvenance({
      knowledgePack: validKnowledgePackManifest,
      corpusSnapshot: linkedCorpusSnapshot,
    });

    expect(result).toEqual({
      status: "ready",
      latestSet: linkedCorpusSnapshot.latestSetCode,
      crVersion: linkedCorpusSnapshot.crVersion,
      legalityAsOf: linkedCorpusSnapshot.legalityPolicyFetchedAt,
    });
  });

  it("returns the honest empty state when no knowledge pack is installed", () => {
    expect(deriveProvenance(null)).toEqual({
      status: "not-installed",
      message: "no knowledge pack installed yet",
    });
  });

  it("flags the chain as unverified when corpusSnapshotHash does not match the linked snapshot's contentHash", () => {
    const result = deriveProvenance({
      knowledgePack: validKnowledgePackManifest,
      corpusSnapshot: validCorpusSnapshotManifest,
    });

    expect(result.status).toBe("unverified");
    if (result.status === "unverified") {
      expect(result.message).toContain(validKnowledgePackManifest.corpusSnapshotHash);
      expect(result.message).toContain(validCorpusSnapshotManifest.contentHash);
    }
  });
});
