// §9.3: "WHEN loading artifacts THE SYSTEM SHALL verify manifest
// compatibility (embedder version ↔ index version, model ↔ app
// min-version) using the shared schema package (§7.11) and SHALL refuse to
// load mismatched combinations with a user-visible remediation message."
//
// These functions are the refusal gate: they throw a typed
// ManifestCompatibilityError (never return a mismatched pair silently) so
// the caller has a stable `.reason` to key its remediation message off of.

import type { KnowledgePackManifest, ModelPackManifest } from "@fab/manifest-schema";
import { ManifestCompatibilityError } from "./errors";
import { compareVersions, satisfiesRange } from "./semver";

/** Embedder-version ↔ index-version half of §9.3: the model pack and
 * knowledge pack must have been built from the same text/vision embedder,
 * and the knowledge pack's own version must fall inside the model pack's
 * declared `compatibleKnowledgePacks` range. */
export function checkModelKnowledgeCompatibility(
  modelPack: ModelPackManifest,
  knowledgePack: KnowledgePackManifest,
): void {
  if (modelPack.textEmbedderVersion !== knowledgePack.textEmbedderVersion) {
    throw new ManifestCompatibilityError("text-embedder-mismatch", {
      modelTextEmbedderVersion: modelPack.textEmbedderVersion,
      knowledgeTextEmbedderVersion: knowledgePack.textEmbedderVersion,
    });
  }
  if (modelPack.visionEmbedderVersion !== knowledgePack.visionEmbedderVersion) {
    throw new ManifestCompatibilityError("vision-embedder-mismatch", {
      modelVisionEmbedderVersion: modelPack.visionEmbedderVersion,
      knowledgeVisionEmbedderVersion: knowledgePack.visionEmbedderVersion,
    });
  }
  if (!satisfiesRange(knowledgePack.version, modelPack.compatibleKnowledgePacks)) {
    throw new ManifestCompatibilityError("knowledge-pack-version-out-of-range", {
      knowledgePackVersion: knowledgePack.version,
      compatibleKnowledgePacks: modelPack.compatibleKnowledgePacks,
    });
  }
}

/** Model ↔ app-min-version half of §9.3. */
export function checkAppMinVersion(modelPack: ModelPackManifest, appVersion: string): void {
  if (compareVersions(appVersion, modelPack.appMinVersion) < 0) {
    throw new ManifestCompatibilityError("app-below-min-version", {
      appVersion,
      requiredAppMinVersion: modelPack.appMinVersion,
    });
  }
}
