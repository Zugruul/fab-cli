import { ChecksumMismatchError } from "../artifacts/errors";
import type { ArtifactProgress, OnboardingArtifactId, ProgressAction, ProgressErrorKind, ProgressState } from "./types";

export const ONBOARDING_ARTIFACT_IDS: OnboardingArtifactId[] = ["model-pack", "knowledge-pack"];

function queuedProgress(): ArtifactProgress {
  return { status: "queued", bytesDownloaded: 0, totalBytes: null };
}

export function initialProgressState(): ProgressState {
  const state = {} as ProgressState;
  for (const id of ONBOARDING_ARTIFACT_IDS) {
    state[id] = queuedProgress();
  }
  return state;
}

/**
 * Pure per-artifact download-progress state machine (§9.9 "progress with
 * pause/resume/retry"). This models UI status transitions only — the
 * actual pause/resume/retry OPERATIONS are the caller re-invoking
 * ArtifactManager/ResumableDownloader (APP-031) with an AbortController it
 * owns per artifact: aborting it "pauses" (ResumableDownloader's persisted
 * partial-download state survives an abort — its own resolveResumePoint
 * logic picks up from bytesDownloaded on the next call), and calling
 * download() again "resumes" from that same byte offset.
 *
 * RETRY's `resetBytes` flag mirrors the downloader's own two failure modes
 * explicitly: a ChecksumMismatchError clears all resumable state on the
 * downloader side (bytes really do restart at 0 — see downloader.ts's
 * discardPartial + stateStore.delete on mismatch), while any other failure
 * leaves the partial download and its state-store record intact (retry
 * actually resumes in place). classifyDownloadError below is how a caller
 * derives which one applies from a caught error.
 */
export function progressReducer(state: ProgressState, action: ProgressAction): ProgressState {
  switch (action.type) {
    case "START":
      return {
        ...state,
        [action.artifact]: { status: "downloading", bytesDownloaded: 0, totalBytes: action.totalBytes },
      };
    case "PROGRESS":
      return {
        ...state,
        [action.artifact]: {
          ...state[action.artifact],
          status: "downloading",
          bytesDownloaded: action.bytesDownloaded,
          totalBytes: action.totalBytes,
        },
      };
    case "PAUSE":
      return {
        ...state,
        [action.artifact]: { ...state[action.artifact], status: "paused" },
      };
    case "RESUME":
      return {
        ...state,
        [action.artifact]: { ...state[action.artifact], status: "downloading" },
      };
    case "VERIFY":
      return {
        ...state,
        [action.artifact]: { ...state[action.artifact], status: "verifying" },
      };
    case "INSTALLED":
      return {
        ...state,
        [action.artifact]: {
          ...state[action.artifact],
          status: "installed",
          errorKind: undefined,
          errorMessage: undefined,
        },
      };
    case "FAIL":
      return {
        ...state,
        [action.artifact]: {
          ...state[action.artifact],
          status: "failed",
          errorKind: action.errorKind,
          errorMessage: action.errorMessage,
        },
      };
    case "RETRY":
      return {
        ...state,
        [action.artifact]: {
          ...state[action.artifact],
          status: "downloading",
          bytesDownloaded: action.resetBytes ? 0 : state[action.artifact].bytesDownloaded,
          errorKind: undefined,
          errorMessage: undefined,
        },
      };
    default:
      return state;
  }
}

export interface DownloadErrorClassification {
  errorKind: ProgressErrorKind;
  errorMessage: string;
  /** What a subsequent RETRY action's `resetBytes` should be set to. */
  resetBytesOnRetry: boolean;
}

/** Maps a caught download error to the ProgressErrorKind + RETRY policy a
 * caller should use — kept here (not in artifacts/) since it's onboarding
 * UI policy, not an artifact-manager concern: artifacts/errors.ts only
 * defines the error identity (ChecksumMismatchError), this module decides
 * what that identity means for the progress UI's retry behavior. */
export function classifyDownloadError(error: unknown): DownloadErrorClassification {
  if (error instanceof ChecksumMismatchError) {
    return { errorKind: "checksum-mismatch", errorMessage: error.message, resetBytesOnRetry: true };
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  return { errorKind: "other", errorMessage, resetBytesOnRetry: false };
}
