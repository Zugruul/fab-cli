/**
 * Fixtures published from the package for consumer tests (pipeline/,
 * fab-app) — one valid fixture per manifest type plus the invalid fixtures
 * called out in APP-016's AC: mismatched-embedder delta, missing
 * shippingMode, missing licenseId, a revoked-version sample, and a
 * tombstoned delta.
 */
import type { CorpusSnapshotManifest } from "./corpusSnapshot.js";
import type { ModelPackManifest } from "./modelPack.js";
import type { KnowledgePackManifest } from "./knowledgePack.js";
import type { DeltaPackManifest } from "./deltaPack.js";
import type { RevocationList } from "./revocationList.js";

// --- Corpus snapshot manifest ---------------------------------------------

export const validCorpusSnapshotManifest: CorpusSnapshotManifest = {
  schemaVersion: "0.1.0",
  exportDate: "2026-08-01T00:00:00.000Z",
  contentHash: "a".repeat(64),
  chunkCount: 2,
  crVersion: "Wed, 10 Jun 2026 19:43:38 GMT",
  documentVersions: [
    { document: "cr", file: "en-fab-cr.txt", lastModified: "Wed, 10 Jun 2026 19:43:38 GMT", lines: 2392 },
  ],
  latestSetCode: "OTA",
  loreCommit: "92f74367e25b553b922b1fc0cf6ef61570523058",
  sources: [
    {
      name: "judge-brain",
      count: 1,
      shippingMode: "verbatim",
      skipped: 0,
      note: "pending §7.10 redistribution-rights assessment (APP-017)",
    },
  ],
};

/** Invalid: a source entry with shippingMode omitted entirely. */
export const invalidCorpusSnapshotManifestMissingShippingMode: unknown = {
  ...validCorpusSnapshotManifest,
  sources: [{ name: "judge-brain", count: 1, skipped: 0 }],
};

// --- Model pack manifest ----------------------------------------------------

export const validModelPackManifest: ModelPackManifest = {
  schemaVersion: "0.1.0",
  tier: "1.7B",
  artifacts: [
    {
      name: "fab-slm-1.7b-q4",
      file: "fab-slm-1.7b-q4_k_m.gguf",
      sha256: "b".repeat(64),
      sizeBytes: 1_700_000_000,
      licenseId: "Apache-2.0",
      version: "1.0.0",
    },
  ],
  baseModelHash: "c".repeat(64),
  textEmbedderVersion: "text-embed-v1",
  visionEmbedderVersion: "vision-embed-v1",
  detectorVersion: "detector-v1",
  compatibleKnowledgePacks: "^1.0.0",
  appMinVersion: "1.0.0",
  corpusSnapshotHash: "d".repeat(64),
};

/** Invalid: an artifact entry with licenseId (SPDX id) omitted entirely. */
export const invalidModelPackManifestMissingLicenseId: unknown = {
  ...validModelPackManifest,
  artifacts: [
    {
      name: "fab-slm-1.7b-q4",
      file: "fab-slm-1.7b-q4_k_m.gguf",
      sha256: "b".repeat(64),
      sizeBytes: 1_700_000_000,
      version: "1.0.0",
    },
  ],
};

/** Invalid: an artifact entry with a placeholder licenseId ("TODO") instead of a real SPDX id. */
export const invalidModelPackManifestBadLicenseId: unknown = {
  ...validModelPackManifest,
  artifacts: [{ ...validModelPackManifest.artifacts[0], licenseId: "TODO" }],
};

// --- Knowledge pack manifest -------------------------------------------------

export const validKnowledgePackManifest: KnowledgePackManifest = {
  schemaVersion: "0.1.0",
  version: "1.0.0",
  corpusSnapshotHash: "d".repeat(64),
  textEmbedderVersion: "text-embed-v1",
  visionEmbedderVersion: "vision-embed-v1",
  printingRegistryVersion: "1.0.0",
  retrievalFloor: 0.42,
  oodThreshold: 0.2,
  chunkCount: 6410,
  indexFiles: [{ name: "chunks.sqlite", sha256: "e".repeat(64) }],
};

/** Invalid: retrievalFloor omitted entirely (§9.7 calibrated abstention floor). */
export const invalidKnowledgePackManifestMissingRetrievalFloor: unknown = {
  schemaVersion: "0.1.0",
  version: "1.0.0",
  corpusSnapshotHash: "d".repeat(64),
  textEmbedderVersion: "text-embed-v1",
  visionEmbedderVersion: "vision-embed-v1",
  printingRegistryVersion: "1.0.0",
  oodThreshold: 0.2,
  chunkCount: 6410,
  indexFiles: [{ name: "chunks.sqlite", sha256: "e".repeat(64) }],
};

/** Invalid: oodThreshold omitted entirely (§10.9 calibrated OOD threshold). */
export const invalidKnowledgePackManifestMissingOodThreshold: unknown = {
  schemaVersion: "0.1.0",
  version: "1.0.0",
  corpusSnapshotHash: "d".repeat(64),
  textEmbedderVersion: "text-embed-v1",
  visionEmbedderVersion: "vision-embed-v1",
  printingRegistryVersion: "1.0.0",
  retrievalFloor: 0.42,
  chunkCount: 6410,
  indexFiles: [{ name: "chunks.sqlite", sha256: "e".repeat(64) }],
};

// --- Delta pack manifest ------------------------------------------------------

export const validDeltaPackManifest: DeltaPackManifest = {
  schemaVersion: "0.1.0",
  fromVersion: "1.0.0",
  toVersion: "1.1.0",
  addedCount: 12,
  changedCount: 4,
  tombstones: { chunkIds: [], printingIds: [] },
  fromTextEmbedderVersion: "text-embed-v1",
  toTextEmbedderVersion: "text-embed-v1",
  fromVisionEmbedderVersion: "vision-embed-v1",
  toVisionEmbedderVersion: "vision-embed-v1",
};

/** A delta pack whose tombstones carry real removed chunk/printing ids. */
export const tombstonedDeltaPackManifest: DeltaPackManifest = {
  ...validDeltaPackManifest,
  fromVersion: "1.1.0",
  toVersion: "1.2.0",
  tombstones: { chunkIds: ["judge/kw-dominate"], printingIds: ["OTA-042-R"] },
};

/**
 * Invalid: text embedder version changed between fromVersion and
 * toVersion — §8.8 requires this delta to be refused and a full pack
 * built instead.
 */
export const invalidDeltaPackManifestMismatchedEmbedder: unknown = {
  ...validDeltaPackManifest,
  toTextEmbedderVersion: "text-embed-v2",
};

// --- Revocation list ------------------------------------------------------------

export const validRevocationList: RevocationList = {
  schemaVersion: "0.1.0",
  revokedVersions: [
    {
      artifact: "knowledge-pack",
      version: "1.0.0",
      reason: "corrupt sqlite-vec index shipped in initial release",
    },
  ],
};

export const emptyRevocationList: RevocationList = {
  schemaVersion: "0.1.0",
  revokedVersions: [],
};
