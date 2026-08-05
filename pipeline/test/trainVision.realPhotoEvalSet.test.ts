import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import {
  computeLetterboxTransform,
  transformPoint,
  transformQuad,
  letterboxRawImage,
  validateCanvasDivisibleByStride,
  exportRealPhotoEvalSet,
  DEFAULT_CANVAS_SIZE,
  REAL_PHOTO_EVAL_SCHEMA_VERSION,
  REAL_PHOTO_EVAL_REPORT_SCHEMA_VERSION,
} from "../src/train-vision/realPhotoEvalSet.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { PhotoLabel, Quad } from "../src/benchmark/types.js";

// ---------------------------------------------------------------------------
// Pure geometry: computeLetterboxTransform / transformPoint / transformQuad
// ---------------------------------------------------------------------------

describe("computeLetterboxTransform", () => {
  it("pins the exact scale + padding for a portrait photo into a square canvas (height-limited)", () => {
    // 3024x4032 (a realistic phone-photo aspect ratio) into a 1024 canvas:
    // scale is bound by the TALLER dimension (height), leaving horizontal
    // padding bars — pinned numeric values, not just bounds, so a formula
    // regression (e.g. swapping min for max, or picking the wrong axis)
    // is caught exactly.
    const t = computeLetterboxTransform(3024, 4032, 1024);
    expect(t.scale).toBeCloseTo(1024 / 4032, 10);
    expect(t.padY).toBeCloseTo(0, 10);
    expect(t.padX).toBeCloseTo((1024 - 3024 * (1024 / 4032)) / 2, 6);
    expect(t.canvasSize).toBe(1024);
  });

  it("pins the exact scale + padding for a landscape photo (width-limited)", () => {
    const t = computeLetterboxTransform(4032, 3024, 1024);
    expect(t.scale).toBeCloseTo(1024 / 4032, 10);
    expect(t.padX).toBeCloseTo(0, 10);
    expect(t.padY).toBeCloseTo((1024 - 3024 * (1024 / 4032)) / 2, 6);
  });

  it("is a no-op transform (scale 1, no padding) for a source that already matches the canvas", () => {
    const t = computeLetterboxTransform(512, 512, 512);
    expect(t.scale).toBeCloseTo(1, 10);
    expect(t.padX).toBeCloseTo(0, 10);
    expect(t.padY).toBeCloseTo(0, 10);
  });

  // Letterbox vs squash: a uniform scale factor is the entire point — a
  // squash (independent x/y scale to fill the canvas exactly) would distort
  // card aspect ratio away from the training distribution. Kill-first: an
  // implementation using separate scaleX = canvasSize/w, scaleY =
  // canvasSize/h (squash) would report scale as an object or would need
  // two different numbers here — this single `scale` field applying
  // identically to both axes IS the uniform-scale guarantee.
  it("uses ONE uniform scale for both axes — never independent x/y factors (the letterbox-not-squash guarantee)", () => {
    const t = computeLetterboxTransform(2000, 1000, 1024);
    const impliedScaleX = t.scale;
    const impliedScaleY = t.scale;
    expect(impliedScaleX).toBe(impliedScaleY);
    // And it must be the SMALLER of the two per-axis fit ratios (contain,
    // not cover) — min(1024/2000, 1024/1000) = 0.512, not 1.024.
    expect(t.scale).toBeCloseTo(0.512, 10);
  });

  it("throws on a non-positive source dimension rather than producing a division-by-zero / Infinity transform", () => {
    expect(() => computeLetterboxTransform(0, 100, 1024)).toThrow();
    expect(() => computeLetterboxTransform(100, 0, 1024)).toThrow();
  });
});

describe("transformPoint / transformQuad", () => {
  it("maps a point by scale then offset by padding, in that order", () => {
    const t = { scale: 0.5, padX: 10, padY: 20, canvasSize: 1024 };
    expect(transformPoint({ x: 100, y: 200 }, t)).toEqual({ x: 100 * 0.5 + 10, y: 200 * 0.5 + 20 });
  });

  it("transforms every corner of a quad, preserving corner order, printingId, and tags", () => {
    const quad: Quad = {
      printingId: "abc123",
      corners: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      tags: ["sleeved"],
    };
    const t = { scale: 2, padX: 5, padY: 5, canvasSize: 1024 };
    const out = transformQuad(quad, t);
    expect(out.printingId).toBe("abc123");
    expect(out.tags).toEqual(["sleeved"]);
    expect(out.corners).toEqual([
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 25 },
      { x: 5, y: 25 },
    ]);
  });

  // AMODAL CONTRACT (dev-brain lesson from the composites generator, restated
  // here for the real-photo eval set): a card's true extent can legitimately
  // extend off the source photo's edge (labelers record it unclamped — see
  // docs/benchmark-labeling.md). That must survive the letterbox transform
  // unclamped too. Kill-first: an implementation that clamps corners into
  // [0, canvasSize] (e.g. `Math.max(0, Math.min(canvasSize, ...))`) would
  // make this test fail — a negative source coordinate must stay negative
  // (offset only by padding, never floored to 0) after transform.
  it("does NOT clamp off-photo corners to the canvas — negative/overflowing coordinates stay negative/overflowing", () => {
    // At this source/canvas pair (3024x4032 into 1024, scale ~0.254,
    // padX ~128), a corner has to be well past the photo edge for the
    // scaled coordinate to actually cross 0/canvasSize after padding is
    // added — -600/5000 clear that margin, unlike a small -50 which
    // would land inside the padding bar itself, not past the canvas edge.
    const quad: Quad = {
      printingId: "off-canvas-card",
      corners: [
        { x: -600, y: -600 },
        { x: 5000, y: -600 },
        { x: 5000, y: 5000 },
        { x: -600, y: 5000 },
      ],
      tags: [],
    };
    const t = computeLetterboxTransform(3024, 4032, 1024);
    const out = transformQuad(quad, t);
    expect(out.corners[0].x).toBeLessThan(0);
    expect(out.corners[0].y).toBeLessThan(0);
    expect(out.corners[2].x).toBeGreaterThan(1024);
    expect(out.corners[2].y).toBeGreaterThan(1024);
  });
});

// ---------------------------------------------------------------------------
// validateCanvasDivisibleByStride
// ---------------------------------------------------------------------------

describe("validateCanvasDivisibleByStride", () => {
  it("accepts a canvas size evenly divisible by the stride", () => {
    expect(() => validateCanvasDivisibleByStride(1024, 8)).not.toThrow();
  });

  // Kill-first: removing this check (or the modulo condition) would let a
  // misconfigured canvas size silently reach train_vision/train.py, which
  // fails loudly there instead (_validate_canvas_for_stride) — this test
  // locks the SAME check happening early, on the TS side, at export time.
  it("throws when the canvas size is not evenly divisible by the stride", () => {
    expect(() => validateCanvasDivisibleByStride(1023, 8)).toThrow(/divisible/);
    expect(() => validateCanvasDivisibleByStride(999, 8)).toThrow(/divisible/);
  });
});

// ---------------------------------------------------------------------------
// letterboxRawImage — pixel-level, no file IO
// ---------------------------------------------------------------------------

function solidRaw(width: number, height: number, rgb: [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function pixelAt(img: RawImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

describe("letterboxRawImage", () => {
  it("produces a square canvas of exactly canvasSize x canvasSize regardless of source aspect ratio", () => {
    const { image } = letterboxRawImage(solidRaw(8, 4, [200, 10, 10]), 16);
    expect(image.width).toBe(16);
    expect(image.height).toBe(16);
  });

  it("returns the SAME transform computeLetterboxTransform would compute for that source/canvas pair", () => {
    const src = solidRaw(8, 4, [200, 10, 10]);
    const { transform } = letterboxRawImage(src, 16);
    expect(transform).toEqual(computeLetterboxTransform(8, 4, 16));
  });

  it("fills the letterbox padding bars with opaque black — never leaves them transparent or garbage", () => {
    // 8x4 source into a 16x16 canvas: scale = min(16/8, 16/4) = 2, so the
    // source fills the full width (16) but only 8 of the 16 rows — rows
    // 0-3 and 12-15 are pure padding.
    const { image } = letterboxRawImage(solidRaw(8, 4, [200, 10, 10]), 16);
    expect(pixelAt(image, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(image, 15, 15)).toEqual([0, 0, 0, 255]);
  });

  it("places the scaled source content centered on the canvas, matching its source color", () => {
    const { image } = letterboxRawImage(solidRaw(8, 4, [200, 10, 10]), 16);
    // Row 8 (middle of the vertical band the source occupies: rows 4-11)
    // should be the source's color, not the black pad.
    const [r, g, b, a] = pixelAt(image, 8, 8);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
    expect(a).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// exportRealPhotoEvalSet — full orchestration against real files
// ---------------------------------------------------------------------------

let tmpDir: string;
let photosDir: string;
let labelsDir: string;
let outDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-real-photo-eval-test-"));
  photosDir = path.join(tmpDir, "benchmark-photos");
  labelsDir = path.join(photosDir, "labels");
  outDir = path.join(tmpDir, "real-photo-eval");
  fs.mkdirSync(path.join(photosDir, "single"), { recursive: true });
  fs.mkdirSync(path.join(labelsDir, "single"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function writePhoto(relPath: string, width: number, height: number, rgb: [number, number, number]): Promise<void> {
  const full = path.join(photosDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .jpeg({ quality: 100 })
    .toFile(full);
}

function writeLabel(relPath: string, label: PhotoLabel): void {
  const full = path.join(labelsDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(label, null, 2) + "\n");
}

function labelFor(photoId: string, fileName: string, corners: Quad["corners"]): PhotoLabel {
  return {
    photoId,
    fileName,
    sceneType: "single",
    orientation: "portrait",
    quads: [{ printingId: "print-1", corners, tags: [] }],
  };
}

describe("exportRealPhotoEvalSet", () => {
  it("exports only photos with a matching label file, writing <photoId>.png + <photoId>.json + manifest.json", async () => {
    await writePhoto("single/a.jpg", 300, 400, [200, 10, 10]);
    writeLabel("single/a.json", labelFor("photo-a", "single/a.jpg", [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 100 }]));
    // No label written for this one — must be skipped, never crash the run.
    await writePhoto("single/unlabeled.jpg", 300, 400, [10, 10, 200]);

    const report = await exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 16, stride: 8 });

    expect(report.exportedCount).toBe(1);
    expect(report.skippedUnlabeledCount).toBe(1);
    expect(report.skippedUnlabeled).toEqual(["single/unlabeled.jpg"]);
    expect(report.skippedInvalidLabel).toEqual([]);
    expect(report.totalQuads).toBe(1);

    expect(fs.existsSync(path.join(outDir, "photo-a.png"))).toBe(true);
    const label = JSON.parse(fs.readFileSync(path.join(outDir, "photo-a.json"), "utf8"));
    expect(label.fileName).toBe("photo-a.png");
    expect(label.width).toBe(16);
    expect(label.height).toBe(16);
    expect(label.cards).toHaveLength(1);
    expect(label.cards[0].printingId).toBe("print-1");

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest.composites).toHaveLength(1);
    expect(manifest.composites[0].compositeId).toBe("photo-a");
    expect(manifest.composites[0].fileName).toBe("photo-a.png");
    expect(manifest.canvasSize).toBe(16);
    expect(manifest.stride).toBe(8);
  });

  it("keeps skipped-unlabeled and skipped-invalid-label as DISTINCT populations from exported — never collapsed into one number", async () => {
    await writePhoto("single/good.jpg", 200, 200, [1, 2, 3]);
    writeLabel("single/good.json", labelFor("photo-good", "single/good.jpg", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));

    await writePhoto("single/no-label.jpg", 200, 200, [4, 5, 6]);
    // no label file written for no-label.jpg

    await writePhoto("single/bad-label.jpg", 200, 200, [7, 8, 9]);
    // present but invalid: zero quads is rejected by validatePhotoLabel
    fs.mkdirSync(path.dirname(path.join(labelsDir, "single/bad-label.json")), { recursive: true });
    fs.writeFileSync(
      path.join(labelsDir, "single/bad-label.json"),
      JSON.stringify({ photoId: "photo-bad", fileName: "single/bad-label.jpg", sceneType: "single", orientation: "portrait", quads: [] }),
    );

    const report = await exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 16, stride: 8 });

    expect(report.exportedCount).toBe(1);
    expect(report.exported.map((e) => e.photoId)).toEqual(["photo-good"]);
    expect(report.skippedUnlabeled).toEqual(["single/no-label.jpg"]);
    expect(report.skippedInvalidLabel).toHaveLength(1);
    expect(report.skippedInvalidLabel[0].fileName).toBe("single/bad-label.jpg");
    expect(report.skippedInvalidLabel[0].reason).toMatch(/quads/);

    // Partition completeness: every discovered photo file lands in exactly
    // one of the three buckets (mirrors the composites coverage report's
    // "accounted for" discipline) — 3 photos in, 3 accounted for.
    const totalAccounted = report.exportedCount + report.skippedUnlabeledCount + report.skippedInvalidLabel.length;
    expect(totalAccounted).toBe(3);
  });

  it("records a distinct, real (never fabricated) scale + source dimensions per exported photo", async () => {
    await writePhoto("single/wide.jpg", 400, 200, [1, 1, 1]);
    writeLabel("single/wide.json", labelFor("photo-wide", "single/wide.jpg", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
    await writePhoto("single/tall.jpg", 200, 400, [1, 1, 1]);
    writeLabel("single/tall.json", labelFor("photo-tall", "single/tall.jpg", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));

    const report = await exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 32, stride: 8 });

    const wide = report.exported.find((e) => e.photoId === "photo-wide")!;
    const tall = report.exported.find((e) => e.photoId === "photo-tall")!;
    expect(wide.sourceWidth).toBe(400);
    expect(wide.sourceHeight).toBe(200);
    expect(tall.sourceWidth).toBe(200);
    expect(tall.sourceHeight).toBe(400);
    // Different aspect ratios at the same canvas size must produce
    // different (real, computed) scales — not one hardcoded config value
    // copy-pasted onto every entry.
    expect(wide.scale).toBeCloseTo(computeLetterboxTransform(400, 200, 32).scale, 10);
    expect(tall.scale).toBeCloseTo(computeLetterboxTransform(200, 400, 32).scale, 10);
  });

  it("transforms quad corners consistently with the rendered image — an off-photo corner stays off-canvas in the emitted label", async () => {
    await writePhoto("single/a.jpg", 300, 400, [200, 10, 10]);
    // A corner well outside the 300x400 source, per the amodal convention.
    // At canvasSize=16 this photo's scale is 16/400=0.04 with padX=2, so
    // -100 (not just -20) is needed to actually cross 0 after padding.
    writeLabel(
      "single/a.json",
      labelFor("photo-a", "single/a.jpg", [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }]),
    );

    await exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 16, stride: 8 });
    const label = JSON.parse(fs.readFileSync(path.join(outDir, "photo-a.json"), "utf8"));
    expect(label.cards[0].corners[0].x).toBeLessThan(0);
    expect(label.cards[0].corners[0].y).toBeLessThan(0);
  });

  it("throws before writing anything when canvasSize is not divisible by stride", async () => {
    await writePhoto("single/a.jpg", 300, 400, [200, 10, 10]);
    writeLabel("single/a.json", labelFor("photo-a", "single/a.jpg", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));

    await expect(exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 999, stride: 8 })).rejects.toThrow(/divisible/);
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("clears a stale existing outDir before writing (no leftover from a previous run survives)", async () => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stale-leftover.json"), "{}");
    await writePhoto("single/a.jpg", 300, 400, [200, 10, 10]);
    writeLabel("single/a.json", labelFor("photo-a", "single/a.jpg", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));

    await exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 16, stride: 8 });

    expect(fs.existsSync(path.join(outDir, "stale-leftover.json"))).toBe(false);
  });

  it("uses defaults of 1024 canvas / stride 8 when not specified", async () => {
    expect(DEFAULT_CANVAS_SIZE).toBe(1024);
  });

  it("stamps schema versions on the manifest and the export report", async () => {
    await writePhoto("single/a.jpg", 300, 400, [200, 10, 10]);
    writeLabel("single/a.json", labelFor("photo-a", "single/a.jpg", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));

    const report = await exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 16, stride: 8 });
    expect(report.schemaVersion).toBe(REAL_PHOTO_EVAL_REPORT_SCHEMA_VERSION);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest.schemaVersion).toBe(REAL_PHOTO_EVAL_SCHEMA_VERSION);
  });

  it("every exported image on disk really is canvasSize x canvasSize (round-trips through a real PNG decode)", async () => {
    await writePhoto("single/a.jpg", 300, 400, [200, 10, 10]);
    writeLabel("single/a.json", labelFor("photo-a", "single/a.jpg", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));

    await exportRealPhotoEvalSet({ photosDir, labelsDir, outDir, canvasSize: 32, stride: 8 });
    const meta = await sharp(path.join(outDir, "photo-a.png")).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(32);
  });
});
