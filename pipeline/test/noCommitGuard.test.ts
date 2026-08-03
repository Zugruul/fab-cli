// APP-025 AC: "no-commit guard tested (covers benchmark photos too)". Both
// the printing-image cache and the real-photo benchmark set are training-
// host-only, artifact-storage content (SPEC-APP.md §8.7a/§7.7) — never
// committed to git. This asserts the actual git-ignore behavior (via `git
// check-ignore`) rather than just reading .gitignore text, so a future
// change that accidentally un-ignores either directory is caught here
// regardless of which .gitignore rule stops covering it.
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

/** True iff git would refuse to track this path (exit 0 from `check-ignore`
 * means ignored; exit 1 means not ignored; anything else is a real error,
 * e.g. running outside a git repo). Works on a path that doesn't exist on
 * disk — `check-ignore` matches the string against .gitignore patterns, it
 * doesn't require the file to be present. */
function isGitIgnored(relPath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", relPath], { cwd: repoRoot() });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false;
    throw err;
  }
}

describe("pipeline no-commit guard", () => {
  it("git-ignores the printing-image cache dir (pipeline/out/images/)", () => {
    expect(isGitIgnored("pipeline/out/images/q9B6nmKrdz8HnQnJMpQdc.png")).toBe(true);
  });

  it("git-ignores the real-photo benchmark dir (pipeline/out/benchmark-photos/)", () => {
    expect(isGitIgnored("pipeline/out/benchmark-photos/field/photo-001.jpg")).toBe(true);
  });

  it("git-ignores benchmark label files alongside the photos", () => {
    expect(isGitIgnored("pipeline/out/benchmark-photos/labels/photo-001.json")).toBe(true);
  });

  it("git-ignores the generated benchmark manifest output dir", () => {
    expect(isGitIgnored("pipeline/out/benchmark/manifest.json")).toBe(true);
  });

  // APP-026: synthetic composites (rendered PNGs + label JSON + manifest)
  // are generated training-host output, same as the printing-image cache
  // and benchmark photos above — never committed.
  it("git-ignores the synthetic-composite output dir (pipeline/out/composites/)", () => {
    expect(isGitIgnored("pipeline/out/composites/composite-0000.png")).toBe(true);
  });

  it("git-ignores synthetic-composite label files and the run manifest", () => {
    expect(isGitIgnored("pipeline/out/composites/composite-0000.json")).toBe(true);
    expect(isGitIgnored("pipeline/out/composites/manifest.json")).toBe(true);
  });

  it("git-ignores the composite sample-sheet HTML output", () => {
    expect(isGitIgnored("pipeline/out/composites/sample-sheet.html")).toBe(true);
  });

  // APP-027: the OBB detector's Python venv and any local (non-vision-runs)
  // train/export output are gitignored, same as every other generated/
  // dependency artifact this pipeline produces.
  it("git-ignores the train-vision Python venv", () => {
    expect(isGitIgnored("pipeline/train-vision/.venv/bin/python")).toBe(true);
  });

  it("git-ignores train-vision __pycache__ and egg-info build artifacts", () => {
    expect(isGitIgnored("pipeline/train-vision/src/train_vision/__pycache__/geometry.cpython-312.pyc")).toBe(true);
    expect(isGitIgnored("pipeline/train-vision/src/train_vision.egg-info/PKG-INFO")).toBe(true);
  });

  it("git-ignores ad hoc local train/export output under pipeline/out/ (checkpoints, tflite files)", () => {
    expect(isGitIgnored("pipeline/out/train-vision-smoke/checkpoint.pt")).toBe(true);
    expect(isGitIgnored("pipeline/out/train-vision-smoke/model.tflite")).toBe(true);
  });

  // vision-runs/ mirrors training-runs/'s and export-runs/'s discipline:
  // config.json/state.json/manifest.json ARE committed per run (SPEC-APP.md
  // §8.7c's "license ... recorded in manifest; mAP ... reported" AC); only
  // the pulled checkpoint/tflite output stays out of git.
  it("git-ignores vision-runs/<runId>/output/ (pulled checkpoint + tflite) but not the run's own manifest/state/config", () => {
    expect(isGitIgnored("pipeline/vision-runs/some-run/output/checkpoint.pt")).toBe(true);
    expect(isGitIgnored("pipeline/vision-runs/some-run/manifest.json")).toBe(false);
    expect(isGitIgnored("pipeline/vision-runs/some-run/state.json")).toBe(false);
    expect(isGitIgnored("pipeline/vision-runs/some-run/config.json")).toBe(false);
  });

  // APP-028: the recognition embedder is a SIBLING job in the SAME
  // pipeline/train-vision/ package and pipeline/vision-runs/ runs dir as
  // the detector (no new output directory was introduced) -- these prove
  // the existing guards already cover its artifact names too.
  it("git-ignores embedder checkpoints/tflite files under an embedder run's output/ dir", () => {
    expect(isGitIgnored("pipeline/vision-runs/some-embed-run/output/checkpoint.pt")).toBe(true);
    expect(isGitIgnored("pipeline/vision-runs/some-embed-run/output/embedder.tflite")).toBe(true);
    expect(isGitIgnored("pipeline/vision-runs/some-embed-run/manifest.json")).toBe(false);
  });

  it("git-ignores ad hoc local embedder train/export output under pipeline/out/", () => {
    expect(isGitIgnored("pipeline/out/embed-vision-smoke/checkpoint.pt")).toBe(true);
    expect(isGitIgnored("pipeline/out/embed-vision-smoke/embedder.tflite")).toBe(true);
  });
});
