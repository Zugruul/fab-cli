// §9.4: "THE SYSTEM SHALL surface knowledge provenance in the UI: 'knowledge
// up to: <latest set>, CR <version>, legality as of <date>' derived from the
// active manifests." This is the pure derivation step: given the active
// knowledge-pack manifest plus the corpus-snapshot manifest it links to via
// corpusSnapshotHash, produce the three display fields (or the honest
// "nothing installed" / "chain doesn't verify" states) for the Knowledge
// screen to render — kept free of React so it's testable without a renderer.

import type { CorpusSnapshotManifest, KnowledgePackManifest } from "@fab/manifest-schema";

export interface InstalledKnowledgeArtifacts {
  knowledgePack: KnowledgePackManifest;
  /** Resolved by corpusSnapshotHash — that lookup (artifact host / cache)
   * is out of scope here; this function only consumes the already-resolved
   * pair, mirroring how ArtifactManager (APP-031) stays decoupled from real
   * transport/storage. */
  corpusSnapshot: CorpusSnapshotManifest;
}

export type ProvenanceState =
  | {
      status: "ready";
      latestSet: string;
      crVersion: string;
      legalityAsOf: string;
    }
  | {
      status: "not-installed";
      message: string;
    }
  | {
      /** The knowledge pack's corpusSnapshotHash doesn't match the
       * resolved corpus snapshot's own contentHash — the two manifests
       * don't actually form the chain the caller claimed. */
      status: "unverified";
      message: string;
    };

export function deriveProvenance(installed: InstalledKnowledgeArtifacts | null): ProvenanceState {
  if (!installed) {
    return { status: "not-installed", message: "no knowledge pack installed yet" };
  }

  const { knowledgePack, corpusSnapshot } = installed;
  if (knowledgePack.corpusSnapshotHash !== corpusSnapshot.contentHash) {
    return {
      status: "unverified",
      message:
        `knowledge pack's corpusSnapshotHash (${knowledgePack.corpusSnapshotHash}) does not ` +
        `match the linked corpus snapshot's contentHash (${corpusSnapshot.contentHash})`,
    };
  }

  return {
    status: "ready",
    latestSet: corpusSnapshot.latestSetCode,
    crVersion: corpusSnapshot.crVersion,
    legalityAsOf: corpusSnapshot.legalityPolicyFetchedAt,
  };
}
