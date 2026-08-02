import { validModelPackManifest } from "@fab/manifest-schema";
import type { KnowledgePackManifest } from "@fab/manifest-schema";
import { deriveArtifactSizes, deriveKnowledgePackSizeBytes, deriveModelPackSizeBytes, formatBytes } from "../sizes";

// BUG-202: knowledge-pack manifest now carries per-file sizeBytes directly
// (mirrors ModelPackArtifactSchema.sizeBytes) instead of the caller
// supplying an out-of-band size — a local fixture keeps this test
// independent of manifest-schema's shared fixtures.ts.
const knowledgePackManifestFixture: KnowledgePackManifest = {
  schemaVersion: "0.1.0",
  version: "1.0.0",
  corpusSnapshotHash: "d".repeat(64),
  textEmbedderVersion: "text-embed-v1",
  visionEmbedderVersion: "vision-embed-v1",
  printingRegistryVersion: "1.0.0",
  retrievalFloor: 0.42,
  oodThreshold: 0.2,
  chunkCount: 6410,
  indexFiles: [
    { name: "chunks.sqlite", sha256: "e".repeat(64), sizeBytes: 100 },
    { name: "vectors.bin", sha256: "f".repeat(64), sizeBytes: 250 },
    { name: "manifest.json", sha256: "1".repeat(64), sizeBytes: 7 },
  ],
};

describe("deriveModelPackSizeBytes (§9.9 sizes shown, from the model pack manifest)", () => {
  it("sums every artifact's sizeBytes from the manifest fixture", () => {
    expect(deriveModelPackSizeBytes(validModelPackManifest)).toBe(1_700_000_000);
  });

  it("sums across multiple artifacts", () => {
    const twoArtifactManifest = {
      ...validModelPackManifest,
      artifacts: [
        validModelPackManifest.artifacts[0],
        { ...validModelPackManifest.artifacts[0], name: "fab-slm-1.7b-extra", sizeBytes: 300_000_000 },
      ],
    };
    expect(deriveModelPackSizeBytes(twoArtifactManifest)).toBe(2_000_000_000);
  });
});

describe("deriveKnowledgePackSizeBytes (§9.9 sizes shown, from the knowledge-pack manifest, BUG-202)", () => {
  it("sums every indexFiles entry's sizeBytes from the manifest exactly", () => {
    expect(deriveKnowledgePackSizeBytes(knowledgePackManifestFixture)).toBe(357);
  });

  it("returns 0 for an empty indexFiles array", () => {
    expect(deriveKnowledgePackSizeBytes({ ...knowledgePackManifestFixture, indexFiles: [] })).toBe(0);
  });
});

describe("deriveArtifactSizes (§9.9 sizes shown, from the manifests: model pack per tier + knowledge pack, BUG-202)", () => {
  it("combines the model pack manifest's summed size with the knowledge pack manifest's summed size", () => {
    const sizes = deriveArtifactSizes(validModelPackManifest, knowledgePackManifestFixture);
    expect(sizes).toEqual({
      modelPackBytes: 1_700_000_000,
      knowledgePackBytes: 357,
      totalBytes: 1_700_000_357,
    });
  });
});

describe("formatBytes", () => {
  it("renders sub-KB byte counts as whole bytes", () => {
    expect(formatBytes(999)).toBe("999 B");
  });

  it("renders GB-scale sizes with one decimal place", () => {
    expect(formatBytes(1_700_000_000)).toBe("1.7 GB");
  });

  it("renders MB-scale sizes with no decimal place once the value is >= 10", () => {
    expect(formatBytes(300_000_000)).toBe("300 MB");
  });

  it("treats zero (and negative) as the empty '0 B' case", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});
