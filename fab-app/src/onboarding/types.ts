// SPEC-APP.md §9.9: first-run onboarding — types shared across the consent
// gate, download-progress reducer, and degraded-mode readiness derivation.
// All pure data shapes; no RN import so every derivation in this directory
// is unit-testable without a renderer (mirrors src/smokeScreen and
// src/provenance's split between pure logic and presentational screens).

import type { ModelPackTier } from "@fab/manifest-schema";

export type { ModelPackTier };

// --- Network / consent gate (§9.9 "Wi-Fi-preferred gating") ---------------

export type NetworkState = "wifi" | "cellular" | "offline";

/** Injectable boundary for real network-state wiring (e.g.
 * @react-native-community/netinfo) — mirrors artifacts/types.ts's
 * DownloadTransport/FileSystem pattern: production code implements this,
 * tests supply an in-memory fake, and every derivation in this directory
 * only ever consumes the already-resolved NetworkState value it returns. */
export interface NetworkStateSource {
  getNetworkState(): Promise<NetworkState>;
}

export type ConsentGateState = { kind: "ready" } | { kind: "cellular-warning" } | { kind: "waiting-for-network" };

// --- Artifact sizes (§9.9 "sizes shown") -----------------------------------

export interface ArtifactSizes {
  modelPackBytes: number;
  knowledgePackBytes: number;
  totalBytes: number;
}

/** The knowledge-pack manifest (unlike the model pack's per-artifact
 * ModelPackArtifactSchema.sizeBytes) does not carry a byte size, and
 * manifest-schema is out of scope for this task — so the caller supplies
 * the resolved size (e.g. from the artifact host's Content-Length)
 * alongside the version it applies to. */
export interface KnowledgePackSizeInfo {
  version: string;
  sizeBytes: number;
}

// --- Per-artifact download progress (§9.9 progress with pause/resume/retry)

export type OnboardingArtifactId = "model-pack" | "knowledge-pack";

export type ArtifactProgressStatus = "queued" | "downloading" | "paused" | "verifying" | "installed" | "failed";

export type ProgressErrorKind = "checksum-mismatch" | "other";

export interface ArtifactProgress {
  status: ArtifactProgressStatus;
  bytesDownloaded: number;
  totalBytes: number | null;
  errorKind?: ProgressErrorKind;
  errorMessage?: string;
}

export type ProgressState = Record<OnboardingArtifactId, ArtifactProgress>;

export type ProgressAction =
  | { type: "START"; artifact: OnboardingArtifactId; totalBytes: number | null }
  | { type: "PROGRESS"; artifact: OnboardingArtifactId; bytesDownloaded: number; totalBytes: number | null }
  | { type: "PAUSE"; artifact: OnboardingArtifactId }
  | { type: "RESUME"; artifact: OnboardingArtifactId }
  | { type: "VERIFY"; artifact: OnboardingArtifactId }
  | { type: "INSTALLED"; artifact: OnboardingArtifactId }
  | { type: "FAIL"; artifact: OnboardingArtifactId; errorKind: ProgressErrorKind; errorMessage: string }
  | { type: "RETRY"; artifact: OnboardingArtifactId; resetBytes: boolean };

// --- Degraded-mode readiness (§9.9 "graceful degradation") -----------------

export type ArtifactInstallStatus = "not-installed" | "installed";

export interface AppReadinessInput {
  modelPack: ArtifactInstallStatus;
  knowledgePack: ArtifactInstallStatus;
  tier: ModelPackTier | null;
}

export interface FeatureAvailability {
  available: boolean;
  /** Present exactly when unavailable — an honest, specific reason (never a
   * generic error), per §9.9 "show their downloading/not ready states
   * rather than errors". */
  reason?: string;
}

export interface AppReadiness {
  catalog: FeatureAvailability;
  qa: FeatureAvailability;
  scanning: FeatureAvailability;
}
