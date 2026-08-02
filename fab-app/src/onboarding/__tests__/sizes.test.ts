import { validModelPackManifest } from "@fab/manifest-schema";
import { deriveArtifactSizes, deriveModelPackSizeBytes, formatBytes } from "../sizes";

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

describe("deriveArtifactSizes (§9.9 sizes shown, from the manifests: model pack per tier + knowledge pack)", () => {
  it("combines the model pack manifest's summed size with the supplied knowledge pack size", () => {
    const sizes = deriveArtifactSizes(validModelPackManifest, {
      version: "1.0.0",
      sizeBytes: 300_000_000,
    });
    expect(sizes).toEqual({
      modelPackBytes: 1_700_000_000,
      knowledgePackBytes: 300_000_000,
      totalBytes: 2_000_000_000,
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
