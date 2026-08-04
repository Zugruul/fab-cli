import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listPhotos, getLabel, putLabel } from "../src/benchmark-label/routes.js";

let tmpDir: string;
let photosDir: string;
let labelsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-benchmark-label-routes-test-"));
  photosDir = path.join(tmpDir, "photos");
  labelsDir = path.join(tmpDir, "photos", "labels");
  fs.mkdirSync(path.join(photosDir, "single"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function validLabel(overrides: Record<string, unknown> = {}) {
  return {
    photoId: "photo-001",
    fileName: "single/photo-001.jpg",
    sceneType: "single",
    orientation: "portrait",
    quads: [
      {
        printingId: "pr1",
        corners: [
          { x: 10, y: 10 },
          { x: 100, y: 10 },
          { x: 100, y: 200 },
          { x: 10, y: 200 },
        ],
        tags: ["sleeved"],
      },
    ],
    ...overrides,
  };
}

describe("listPhotos", () => {
  it("reports an unlabeled photo as unlabeled with quadCount 0", () => {
    fs.writeFileSync(path.join(photosDir, "single", "photo-001.jpg"), "fake-bytes");
    const entries = listPhotos(photosDir, labelsDir);
    expect(entries).toEqual([{ fileName: "single/photo-001.jpg", sceneTypeGuess: "single", labeled: false, quadCount: 0 }]);
  });

  it("reports a labeled photo's quad count", () => {
    fs.writeFileSync(path.join(photosDir, "single", "photo-001.jpg"), "fake-bytes");
    fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
    fs.writeFileSync(path.join(labelsDir, "single", "photo-001.json"), JSON.stringify(validLabel()));

    const entries = listPhotos(photosDir, labelsDir);
    expect(entries).toEqual([{ fileName: "single/photo-001.jpg", sceneTypeGuess: "single", labeled: true, quadCount: 1 }]);
  });

  it("ignores non-photo files", () => {
    fs.writeFileSync(path.join(photosDir, "single", "notes.txt"), "not a photo");
    expect(listPhotos(photosDir, labelsDir)).toEqual([]);
  });
});

describe("getLabel", () => {
  it("returns null when no label file exists yet (fresh photo, nothing to resume)", () => {
    expect(getLabel(labelsDir, "single/photo-001.jpg")).toBeNull();
  });

  it("returns the existing label so the UI can hydrate/resume it", () => {
    fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
    fs.writeFileSync(path.join(labelsDir, "single", "photo-001.json"), JSON.stringify(validLabel()));
    const label = getLabel(labelsDir, "single/photo-001.jpg");
    expect(label).toMatchObject({ photoId: "photo-001", quads: [{ printingId: "pr1" }] });
  });
});

describe("putLabel — validates via validatePhotoLabel before ever writing", () => {
  it("writes a valid label to labels/<scene>/<photoId>.json", () => {
    const result = putLabel(labelsDir, "single/photo-001.jpg", validLabel());
    expect(result.ok).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(labelsDir, "single", "photo-001.json"), "utf8"));
    expect(onDisk.photoId).toBe("photo-001");
  });

  it("rejects an invalid label (bad sceneType) and writes NOTHING to disk", () => {
    const result = putLabel(labelsDir, "single/photo-001.jpg", validLabel({ sceneType: "not-a-scene" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(labelsDir, "single", "photo-001.json"))).toBe(false);
  });

  it("rejects a label with zero quads (validatePhotoLabel's own rule) rather than writing an empty label", () => {
    const result = putLabel(labelsDir, "single/photo-001.jpg", validLabel({ quads: [] }));
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(labelsDir, "single", "photo-001.json"))).toBe(false);
  });

  // #258 hard requirement: a card cropped by the photo frame has corners
  // OUTSIDE the image bounds (negative, or beyond width/height) — the
  // amodal convention (pipeline/docs/benchmark-labeling.md, geometry.ts).
  // validatePhotoLabel deliberately does not bound-check corners; this tool
  // must not "fix" that by clamping before/while writing. A clamping bug
  // here silently corrupts ground truth and disagrees with the synthetic
  // generator's convention — this is a merge blocker per the issue.
  it("AMODAL: writes out-of-bounds corners (negative and beyond any plausible photo dimension) byte-for-byte unchanged — never clamped", () => {
    const amodalLabel = validLabel({
      quads: [
        {
          printingId: "pr-cropped",
          corners: [
            { x: -120.5, y: -30 }, // above/left of frame
            { x: 250, y: -30 },
            { x: 250, y: 900 },
            { x: -120.5, y: 900 },
          ],
          tags: [],
        },
      ],
    });

    const result = putLabel(labelsDir, "single/photo-001.jpg", amodalLabel);
    expect(result.ok).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(labelsDir, "single", "photo-001.json"), "utf8"));
    expect(onDisk.quads[0].corners).toEqual([
      { x: -120.5, y: -30 },
      { x: 250, y: -30 },
      { x: 250, y: 900 },
      { x: -120.5, y: 900 },
    ]);
  });

  it("resume: a photo re-saved after loading its existing label round-trips through getLabel unchanged, then a correction overwrites cleanly", () => {
    putLabel(labelsDir, "single/photo-001.jpg", validLabel());
    const loaded = getLabel(labelsDir, "single/photo-001.jpg");
    expect(loaded).not.toBeNull();

    // Simulate a human correction: drag one corner, keep everything else.
    const corrected = { ...loaded, quads: [{ ...loaded!.quads[0], corners: [{ x: 11, y: 11 }, { x: 101, y: 10 }, { x: 100, y: 200 }, { x: 10, y: 200 }] }] };
    const result = putLabel(labelsDir, "single/photo-001.jpg", corrected);
    expect(result.ok).toBe(true);

    const reLoaded = getLabel(labelsDir, "single/photo-001.jpg");
    expect(reLoaded!.quads[0].corners[0]).toEqual({ x: 11, y: 11 });
  });
});
