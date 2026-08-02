import { ChecksumMismatchError } from "../../artifacts/errors";
import {
  ONBOARDING_ARTIFACT_IDS,
  classifyDownloadError,
  initialProgressState,
  progressReducer,
} from "../progressReducer";
import type { ProgressState } from "../types";

describe("initialProgressState", () => {
  it("starts every onboarding artifact queued with zero bytes and no known total", () => {
    const state = initialProgressState();
    for (const id of ONBOARDING_ARTIFACT_IDS) {
      expect(state[id]).toEqual({ status: "queued", bytesDownloaded: 0, totalBytes: null });
    }
  });

  it("covers exactly the model pack and knowledge pack", () => {
    expect(ONBOARDING_ARTIFACT_IDS.slice().sort()).toEqual(["knowledge-pack", "model-pack"]);
  });
});

describe("progressReducer (§9.9 progress with pause/resume/retry)", () => {
  let state: ProgressState;

  beforeEach(() => {
    state = initialProgressState();
  });

  it("walks the full happy path: downloading -> paused -> resumed -> verifying -> installed", () => {
    state = progressReducer(state, { type: "START", artifact: "model-pack", totalBytes: 1000 });
    expect(state["model-pack"]).toEqual({ status: "downloading", bytesDownloaded: 0, totalBytes: 1000 });

    state = progressReducer(state, {
      type: "PROGRESS",
      artifact: "model-pack",
      bytesDownloaded: 400,
      totalBytes: 1000,
    });
    expect(state["model-pack"].status).toBe("downloading");
    expect(state["model-pack"].bytesDownloaded).toBe(400);

    state = progressReducer(state, { type: "PAUSE", artifact: "model-pack" });
    expect(state["model-pack"].status).toBe("paused");
    expect(state["model-pack"].bytesDownloaded).toBe(400); // paused keeps the byte count

    state = progressReducer(state, { type: "RESUME", artifact: "model-pack" });
    expect(state["model-pack"].status).toBe("downloading");
    expect(state["model-pack"].bytesDownloaded).toBe(400); // resume continues from where it paused

    state = progressReducer(state, {
      type: "PROGRESS",
      artifact: "model-pack",
      bytesDownloaded: 1000,
      totalBytes: 1000,
    });
    state = progressReducer(state, { type: "VERIFY", artifact: "model-pack" });
    expect(state["model-pack"].status).toBe("verifying");
    expect(state["model-pack"].bytesDownloaded).toBe(1000); // verifying doesn't lose the byte count

    state = progressReducer(state, { type: "INSTALLED", artifact: "model-pack" });
    expect(state["model-pack"]).toEqual({ status: "installed", bytesDownloaded: 1000, totalBytes: 1000 });
  });

  it("failure -> retry with resetBytes restarts the byte count from zero (checksum-mismatch path)", () => {
    state = progressReducer(state, { type: "START", artifact: "knowledge-pack", totalBytes: 500 });
    state = progressReducer(state, {
      type: "PROGRESS",
      artifact: "knowledge-pack",
      bytesDownloaded: 500,
      totalBytes: 500,
    });
    state = progressReducer(state, {
      type: "FAIL",
      artifact: "knowledge-pack",
      errorKind: "checksum-mismatch",
      errorMessage: "checksum mismatch",
    });
    expect(state["knowledge-pack"].status).toBe("failed");
    expect(state["knowledge-pack"].errorKind).toBe("checksum-mismatch");
    expect(state["knowledge-pack"].errorMessage).toBe("checksum mismatch");

    state = progressReducer(state, { type: "RETRY", artifact: "knowledge-pack", resetBytes: true });
    expect(state["knowledge-pack"]).toEqual({
      status: "downloading",
      bytesDownloaded: 0,
      totalBytes: 500,
    });
  });

  it("failure -> retry without resetBytes resumes from the last known byte count (transient network path)", () => {
    state = progressReducer(state, { type: "START", artifact: "knowledge-pack", totalBytes: 500 });
    state = progressReducer(state, {
      type: "PROGRESS",
      artifact: "knowledge-pack",
      bytesDownloaded: 200,
      totalBytes: 500,
    });
    state = progressReducer(state, {
      type: "FAIL",
      artifact: "knowledge-pack",
      errorKind: "other",
      errorMessage: "connection dropped",
    });

    state = progressReducer(state, { type: "RETRY", artifact: "knowledge-pack", resetBytes: false });
    expect(state["knowledge-pack"]).toEqual({
      status: "downloading",
      bytesDownloaded: 200,
      totalBytes: 500,
    });
  });

  it("RETRY clears any prior error fields", () => {
    state = progressReducer(state, {
      type: "FAIL",
      artifact: "model-pack",
      errorKind: "other",
      errorMessage: "boom",
    });
    state = progressReducer(state, { type: "RETRY", artifact: "model-pack", resetBytes: false });
    expect(state["model-pack"].errorKind).toBeUndefined();
    expect(state["model-pack"].errorMessage).toBeUndefined();
  });

  it("only touches the targeted artifact, leaving the other one untouched", () => {
    state = progressReducer(state, { type: "START", artifact: "model-pack", totalBytes: 1000 });
    expect(state["knowledge-pack"]).toEqual({ status: "queued", bytesDownloaded: 0, totalBytes: null });
  });

  it("is pure: it never mutates the state object it was given", () => {
    const before = JSON.stringify(state);
    progressReducer(state, { type: "START", artifact: "model-pack", totalBytes: 1000 });
    expect(JSON.stringify(state)).toEqual(before);
  });
});

describe("classifyDownloadError (§9.9 mapping downloader errors to retry policy)", () => {
  it("a ChecksumMismatchError classifies as checksum-mismatch and resets bytes on retry", () => {
    const err = new ChecksumMismatchError("model-pack/file.gguf", "a".repeat(64), "b".repeat(64));
    const result = classifyDownloadError(err);
    expect(result.errorKind).toBe("checksum-mismatch");
    expect(result.resetBytesOnRetry).toBe(true);
    expect(result.errorMessage).toContain("checksum mismatch");
  });

  it("any other error classifies as other and resumes (does not reset bytes) on retry", () => {
    const result = classifyDownloadError(new Error("network unreachable"));
    expect(result.errorKind).toBe("other");
    expect(result.resetBytesOnRetry).toBe(false);
    expect(result.errorMessage).toBe("network unreachable");
  });

  it("handles a thrown non-Error value without crashing", () => {
    const result = classifyDownloadError("some string failure");
    expect(result.errorKind).toBe("other");
    expect(result.errorMessage).toBe("some string failure");
  });
});
