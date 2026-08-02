// §9.3: "SHALL refuse to load mismatched combinations with a user-visible
// remediation message." This suite covers the UI-facing half of §9.3 that
// APP-031 didn't build: mapping the typed errors/actions APP-031's
// compatibility.ts and revocation.ts already produce into a stable
// "which artifact to update and how" message the Knowledge screen can
// render. It deliberately reuses those real modules (not hand-rolled fakes)
// so the mapping is exercised against the actual thrown error/action shapes.

import { validKnowledgePackManifest, validModelPackManifest } from "@fab/manifest-schema";
import { checkAppMinVersion, checkModelKnowledgeCompatibility } from "../../artifacts/compatibility";
import { ManifestCompatibilityError } from "../../artifacts/errors";
import type { RevocationAction } from "../../artifacts/types";
import { getRemediationMessage } from "../remediation";

function catchCompatibilityError(fn: () => void): ManifestCompatibilityError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ManifestCompatibilityError) return err;
    throw err;
  }
  throw new Error("expected fn to throw a ManifestCompatibilityError");
}

describe("getRemediationMessage — embedder ↔ index mismatch (§9.3)", () => {
  it("points at the knowledge pack for a text-embedder mismatch", () => {
    const mismatched = { ...validKnowledgePackManifest, textEmbedderVersion: "text-embed-v2" };
    const err = catchCompatibilityError(() =>
      checkModelKnowledgeCompatibility(validModelPackManifest, mismatched),
    );

    const remediation = getRemediationMessage(err);

    expect(remediation.artifact).toBe("knowledge-pack");
    expect(remediation.action).toBe("update-knowledge-pack");
    expect(remediation.message).toContain("text-embed-v2");
    expect(remediation.message).toContain(validModelPackManifest.textEmbedderVersion);
  });

  it("points at the knowledge pack for a vision-embedder mismatch", () => {
    const mismatched = { ...validKnowledgePackManifest, visionEmbedderVersion: "vision-embed-v2" };
    const err = catchCompatibilityError(() =>
      checkModelKnowledgeCompatibility(validModelPackManifest, mismatched),
    );

    const remediation = getRemediationMessage(err);

    expect(remediation.artifact).toBe("knowledge-pack");
    expect(remediation.action).toBe("update-knowledge-pack");
    expect(remediation.message).toContain("vision-embed-v2");
  });

  it("points at the knowledge pack for an out-of-range knowledge pack version", () => {
    const outOfRange = { ...validKnowledgePackManifest, version: "2.0.0" };
    const err = catchCompatibilityError(() =>
      checkModelKnowledgeCompatibility(validModelPackManifest, outOfRange),
    );

    const remediation = getRemediationMessage(err);

    expect(remediation.artifact).toBe("knowledge-pack");
    expect(remediation.action).toBe("update-knowledge-pack");
    expect(remediation.message).toContain("2.0.0");
    expect(remediation.message).toContain(validModelPackManifest.compatibleKnowledgePacks);
  });
});

describe("getRemediationMessage — model ↔ app min-version mismatch (§9.3)", () => {
  it("points at the app for an app-below-min-version error", () => {
    const err = catchCompatibilityError(() => checkAppMinVersion(validModelPackManifest, "0.9.0"));

    const remediation = getRemediationMessage(err);

    expect(remediation.artifact).toBe("app");
    expect(remediation.action).toBe("update-app");
    expect(remediation.message).toContain("0.9.0");
    expect(remediation.message).toContain(validModelPackManifest.appMinVersion);
  });
});

describe("getRemediationMessage — revoked artifact (§9.5)", () => {
  it("tells the user a replacement is downloading when one is available", () => {
    const action: RevocationAction = {
      kind: "disable-and-redownload",
      artifactName: "knowledge-pack",
      revokedVersion: "1.0.0",
      reason: "corrupt sqlite-vec index shipped in initial release",
      nextVersion: {
        artifact: "knowledge-pack",
        version: "1.2.0",
        manifestUrl: "https://artifacts.example/knowledge-pack/1.2.0/manifest.json",
        downloadUrl: "https://artifacts.example/knowledge-pack/1.2.0/pack.tar",
      },
    };

    const remediation = getRemediationMessage(action);

    expect(remediation.artifact).toBe("knowledge-pack");
    expect(remediation.action).toBe("redownload-artifact");
    expect(remediation.message).toContain("1.0.0");
    expect(remediation.message).toContain("corrupt sqlite-vec index shipped in initial release");
    expect(remediation.message).toContain("1.2.0");
  });

  it("tells the user no replacement is available yet when there is none", () => {
    const action: RevocationAction = {
      kind: "disable-no-replacement",
      artifactName: "model-pack",
      revokedVersion: "1.0.0",
      reason: "bad quantization",
    };

    const remediation = getRemediationMessage(action);

    expect(remediation.artifact).toBe("model-pack");
    expect(remediation.action).toBe("wait-for-fix");
    expect(remediation.message).toContain("bad quantization");
    expect(remediation.message).not.toContain("undefined");
  });
});
