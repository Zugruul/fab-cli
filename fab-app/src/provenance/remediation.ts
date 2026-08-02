// §9.3: "SHALL refuse to load mismatched combinations with a user-visible
// remediation message." APP-031's artifacts/compatibility.ts and
// artifacts/revocation.ts already produce the typed refusal (a thrown
// ManifestCompatibilityError, or a computed RevocationAction) — this module
// is the missing UI-facing half: mapping each of those into a stable
// "which artifact to update and how" message the Knowledge screen (or any
// other surface) can render without re-deriving copy from raw reason codes.

import type { ManifestCompatibilityError, CompatibilityReason } from "../artifacts/errors";
import type { RevocationAction } from "../artifacts/types";

export type RemediationAction =
  | "update-knowledge-pack"
  | "update-app"
  | "redownload-artifact"
  | "wait-for-fix";

/** Which artifact the user needs to act on. For compatibility errors this
 * is always "knowledge-pack" or "app" (§9.3 never asks the user to update
 * the model pack directly — a knowledge-pack update or app update is what
 * resolves both compatibility halves). For revocation this is whichever
 * artifact's revoked-versions entry fired (§9.5), taken verbatim from the
 * RevocationAction. */
export type RemediationArtifact = "knowledge-pack" | "app" | string;

export interface RemediationMessage {
  artifact: RemediationArtifact;
  action: RemediationAction;
  title: string;
  message: string;
}

const COMPATIBILITY_REMEDIATION: Record<
  CompatibilityReason,
  (err: ManifestCompatibilityError) => RemediationMessage
> = {
  "text-embedder-mismatch": (err) => ({
    artifact: "knowledge-pack",
    action: "update-knowledge-pack",
    title: "Knowledge pack doesn't match your model",
    message:
      `Your installed model uses text embedder ${err.details.modelTextEmbedderVersion}, ` +
      `but the knowledge pack was built with ${err.details.knowledgeTextEmbedderVersion}. ` +
      "Update the knowledge pack to a version built for your model.",
  }),
  "vision-embedder-mismatch": (err) => ({
    artifact: "knowledge-pack",
    action: "update-knowledge-pack",
    title: "Knowledge pack doesn't match your model",
    message:
      `Your installed model uses vision embedder ${err.details.modelVisionEmbedderVersion}, ` +
      `but the knowledge pack was built with ${err.details.knowledgeVisionEmbedderVersion}. ` +
      "Update the knowledge pack to a version built for your model.",
  }),
  "knowledge-pack-version-out-of-range": (err) => ({
    artifact: "knowledge-pack",
    action: "update-knowledge-pack",
    title: "Knowledge pack version isn't supported",
    message:
      `Installed knowledge pack ${err.details.knowledgePackVersion} isn't compatible with ` +
      `your model (requires ${err.details.compatibleKnowledgePacks}). Update the knowledge pack.`,
  }),
  "app-below-min-version": (err) => ({
    artifact: "app",
    action: "update-app",
    title: "App update required",
    message:
      `This model pack requires app version ${err.details.requiredAppMinVersion} or later ` +
      `(you have ${err.details.appVersion}). Update fab-app to continue.`,
  }),
};

function getCompatibilityRemediation(error: ManifestCompatibilityError): RemediationMessage {
  return COMPATIBILITY_REMEDIATION[error.reason](error);
}

function getRevocationRemediation(action: RevocationAction): RemediationMessage {
  if (action.kind === "disable-and-redownload") {
    return {
      artifact: action.artifactName,
      action: "redownload-artifact",
      title: `${action.artifactName} version revoked`,
      message:
        `${action.artifactName} ${action.revokedVersion} was revoked (${action.reason}). ` +
        `Downloading version ${action.nextVersion.version} now.`,
    };
  }
  return {
    artifact: action.artifactName,
    action: "wait-for-fix",
    title: `${action.artifactName} version revoked`,
    message:
      `${action.artifactName} ${action.revokedVersion} was revoked (${action.reason}) and no ` +
      "replacement version is available yet. Try again later.",
  };
}

/** Single entry point: maps either half of §9.3's refusal gate (a thrown
 * ManifestCompatibilityError) or §9.5's revocation policy (a computed
 * RevocationAction) to the same RemediationMessage shape. */
export function getRemediationMessage(
  input: ManifestCompatibilityError | RevocationAction,
): RemediationMessage {
  if ("kind" in input) {
    return getRevocationRemediation(input);
  }
  return getCompatibilityRemediation(input);
}
