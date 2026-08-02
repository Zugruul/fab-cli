import { validKnowledgePackManifest, validModelPackManifest } from "@fab/manifest-schema";
import { checkAppMinVersion, checkModelKnowledgeCompatibility } from "../compatibility";
import { ManifestCompatibilityError } from "../errors";

describe("checkModelKnowledgeCompatibility (§9.3 embedder version ↔ index version)", () => {
  it("passes for a matching model pack + knowledge pack pair", () => {
    expect(() => checkModelKnowledgeCompatibility(validModelPackManifest, validKnowledgePackManifest)).not.toThrow();
  });

  it("throws a typed ManifestCompatibilityError with reason text-embedder-mismatch when text embedders differ", () => {
    const mismatched = { ...validKnowledgePackManifest, textEmbedderVersion: "text-embed-v2" };
    try {
      checkModelKnowledgeCompatibility(validModelPackManifest, mismatched);
      throw new Error("expected checkModelKnowledgeCompatibility to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestCompatibilityError);
      const typed = err as ManifestCompatibilityError;
      expect(typed.code).toBe("MANIFEST_INCOMPATIBLE");
      expect(typed.reason).toBe("text-embedder-mismatch");
      expect(typed.details).toEqual({
        modelTextEmbedderVersion: validModelPackManifest.textEmbedderVersion,
        knowledgeTextEmbedderVersion: "text-embed-v2",
      });
    }
  });

  it("throws with reason vision-embedder-mismatch when vision embedders differ", () => {
    const mismatched = { ...validKnowledgePackManifest, visionEmbedderVersion: "vision-embed-v2" };
    expect(() => checkModelKnowledgeCompatibility(validModelPackManifest, mismatched)).toThrow(
      ManifestCompatibilityError,
    );
    try {
      checkModelKnowledgeCompatibility(validModelPackManifest, mismatched);
    } catch (err) {
      expect((err as ManifestCompatibilityError).reason).toBe("vision-embedder-mismatch");
    }
  });

  it("throws with reason knowledge-pack-version-out-of-range when the knowledge pack version falls outside compatibleKnowledgePacks", () => {
    // validModelPackManifest.compatibleKnowledgePacks is "^1.0.0"
    const outOfRange = { ...validKnowledgePackManifest, version: "2.0.0" };
    try {
      checkModelKnowledgeCompatibility(validModelPackManifest, outOfRange);
      throw new Error("expected checkModelKnowledgeCompatibility to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestCompatibilityError);
      expect((err as ManifestCompatibilityError).reason).toBe("knowledge-pack-version-out-of-range");
    }
  });

  it("accepts a knowledge pack version within the caret range", () => {
    const withinRange = { ...validKnowledgePackManifest, version: "1.4.2" };
    expect(() => checkModelKnowledgeCompatibility(validModelPackManifest, withinRange)).not.toThrow();
  });
});

describe("checkAppMinVersion (§9.3 model ↔ app min-version)", () => {
  it("passes when the app version is at least the model pack's appMinVersion", () => {
    // validModelPackManifest.appMinVersion is "1.0.0"
    expect(() => checkAppMinVersion(validModelPackManifest, "1.0.0")).not.toThrow();
    expect(() => checkAppMinVersion(validModelPackManifest, "1.2.0")).not.toThrow();
  });

  it("throws a typed ManifestCompatibilityError with reason app-below-min-version when the app is older", () => {
    try {
      checkAppMinVersion(validModelPackManifest, "0.9.0");
      throw new Error("expected checkAppMinVersion to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestCompatibilityError);
      const typed = err as ManifestCompatibilityError;
      expect(typed.reason).toBe("app-below-min-version");
      expect(typed.details).toEqual({ appVersion: "0.9.0", requiredAppMinVersion: "1.0.0" });
    }
  });
});
