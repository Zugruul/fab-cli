/**
 * Real-photo benchmark -> detector-dataset exporter (APP-027, issue #139).
 *
 * APP-027's acceptance criterion requires a real-photo-benchmark mAP
 * alongside the synthetic-val mAP — but the two evals need their data in
 * the SAME shape: train_vision/dataset.py's `build_dataset` (the reader
 * used for both) expects one directory holding a manifest.json
 * (`{ composites: [{ compositeId, fileName, ... }] }`) plus one
 * `<compositeId>.png` + `<compositeId>.json` pair per item, with EVERY
 * image in the dir sharing one canvas size divisible by the model stride
 * (train.py's `_validate_canvas_for_stride`). The real-photo benchmark set
 * (APP-025, pipeline/src/benchmark/) is a folder of arbitrarily-sized phone
 * photos + per-photo label JSON — this module bridges the two: it
 * letterboxes each labeled photo into that fixed square canvas and
 * transforms its quads by the exact same scale/offset used to render the
 * pixels, then writes the composites-generator's own dataset-dir layout
 * (composites/write.ts's conventions) so `build_dataset` can read a
 * real-photo run exactly like a synthetic one.
 *
 * LETTERBOX, NOT SQUASH: a non-uniform (independent x/y) resize would
 * distort card aspect ratio away from what the detector was trained on
 * (synthetic composites always paste true-aspect card art), making a
 * reported mAP against squashed photos meaningless — it would be scoring
 * the model against images it was never designed to see. Letterboxing
 * (uniform scale `s = min(canvasSize/W, canvasSize/H)`, then centered
 * padding) preserves aspect ratio exactly like the synthetic side does,
 * at the cost of some wasted canvas as padding bars — an eval-time-only
 * trade since this directory is never used for training.
 *
 * AMODAL CONTRACT (dev-brain lesson from the composites generator,
 * geometry.ts/warp.ts's header, restated here): a card's true extent can
 * legitimately fall outside the photo frame (docs/benchmark-labeling.md
 * records these unclamped, in the photo's native pixel space). This
 * module's transform must preserve that — corners are scaled+offset only,
 * NEVER clamped into [0, canvasSize]. Clamping here would silently corrupt
 * ground truth for exactly the cropped-card cases a real-photo benchmark
 * most needs to exercise.
 */
import fs from "node:fs";
import path from "node:path";
import { loadBenchmarkPhotoSet } from "../benchmark/loadSet.js";
import { validatePhotoLabel, validateLabelFrame, validateLabelBounds } from "../benchmark/validate.js";
import { sha256 } from "../benchmark/manifest.js";
import { decodeImageToRaw, encodeRawToPng } from "../composites/imageIO.js";
import { bilinearSample } from "../composites/rawImage.js";
import type { RawImage } from "../composites/rawImage.js";
import type { Point, Quad } from "../benchmark/types.js";

/** Bumped whenever this module's on-disk dataset-dir shape changes
 * (manifest.json or per-photo label.json fields). */
export const REAL_PHOTO_EVAL_SCHEMA_VERSION = "0.1.0";
/** Independent from the dataset schema above — versions the export
 * report's own shape (mirrors composites/manifest.ts vs coverageReport.ts
 * being versioned separately). */
export const REAL_PHOTO_EVAL_REPORT_SCHEMA_VERSION = "0.1.0";

/** Matches composites-generation.json's committed default outputSize
 * (1024x1024) — not a hard requirement, just a sane default that keeps
 * the real-photo eval canvas the same size as the synthetic-val canvas a
 * default `composites generate` run produces. */
export const DEFAULT_CANVAS_SIZE = 1024;

/** Opaque black — the letterbox padding-bar fill color. Never sampled by
 * any real quad (padding is, by construction, outside every source
 * photo's content), so the exact color is immaterial to eval correctness;
 * it just needs to be a fixed, documented, deterministic value rather than
 * leftover garbage or transparency. */
const PAD_FILL: [number, number, number, number] = [0, 0, 0, 255];

export interface LetterboxTransform {
  /** Single uniform scale applied to BOTH axes — see this file's header
   * for why a squash (independent x/y scale) is never correct here. */
  scale: number;
  padX: number;
  padY: number;
  canvasSize: number;
}

/**
 * Computes the letterbox (contain-fit + centered pad) transform for
 * fitting a `sourceWidth`x`sourceHeight` image into a `canvasSize`x
 * `canvasSize` square canvas: `scale = min(canvasSize/W, canvasSize/H)`,
 * then centered padding on whichever axis has slack left over. Pure
 * arithmetic — no image data touched — so both the pixel renderer
 * (letterboxRawImage) and the quad-corner transform (transformQuad) can
 * share exactly one source of truth for scale/offset, guaranteeing labels
 * and pixels can never silently diverge (same discipline as composites/
 * compositor.ts's geometry-drives-both-pixels-and-labels contract).
 */
export function computeLetterboxTransform(sourceWidth: number, sourceHeight: number, canvasSize: number): LetterboxTransform {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(`computeLetterboxTransform: source dimensions must be positive (got ${sourceWidth}x${sourceHeight})`);
  }
  const scale = Math.min(canvasSize / sourceWidth, canvasSize / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;
  return {
    scale,
    padX: (canvasSize - scaledWidth) / 2,
    padY: (canvasSize - scaledHeight) / 2,
    canvasSize,
  };
}

/** Scales then offsets one point — never clamped (see this file's AMODAL
 * CONTRACT doc above). */
export function transformPoint(point: Point, t: LetterboxTransform): Point {
  return { x: point.x * t.scale + t.padX, y: point.y * t.scale + t.padY };
}

/** Transforms every corner of a quad by the SAME transform, preserving
 * corner order (TL, TR, BR, BL) and carrying printingId/tags through
 * unchanged. */
export function transformQuad(quad: Quad, t: LetterboxTransform): Quad {
  return {
    printingId: quad.printingId,
    corners: quad.corners.map((c) => transformPoint(c, t)) as Quad["corners"],
    tags: quad.tags,
  };
}

/** Throws when `canvasSize` isn't evenly divisible by `stride` — the exact
 * constraint train_vision/train.py's `_validate_canvas_for_stride` enforces
 * on the training side; checked here too so a misconfigured canvas size
 * fails at export time, at the source, instead of surfacing later as an
 * opaque Python ValueError deep inside a training/eval run. */
export function validateCanvasDivisibleByStride(canvasSize: number, stride: number): void {
  if (!Number.isInteger(canvasSize) || canvasSize <= 0) {
    throw new Error(`realPhotoEvalSet: canvasSize must be a positive integer (got ${canvasSize})`);
  }
  if (!Number.isInteger(stride) || stride <= 0) {
    throw new Error(`realPhotoEvalSet: stride must be a positive integer (got ${stride})`);
  }
  if (canvasSize % stride !== 0) {
    throw new Error(`realPhotoEvalSet: canvasSize ${canvasSize} is not evenly divisible by stride ${stride}`);
  }
}

/**
 * Letterboxes `img` into a `canvasSize`x`canvasSize` RGBA canvas: uniform
 * scale (computeLetterboxTransform), bilinear-sampled (same sampling as
 * warp.ts/coverFitRawImage), padding bars filled with opaque black. Pure
 * pixel math — no codec involved — so it's unit-testable against
 * synthetic RawImage buffers without ever touching sharp.
 */
export function letterboxRawImage(img: RawImage, canvasSize: number): { image: RawImage; transform: LetterboxTransform } {
  const transform = computeLetterboxTransform(img.width, img.height, canvasSize);
  const data = new Uint8ClampedArray(canvasSize * canvasSize * 4);

  const maxX = img.width - 1e-4;
  const maxY = img.height - 1e-4;
  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      const i = (y * canvasSize + x) * 4;
      const srcX = (x + 0.5 - transform.padX) / transform.scale - 0.5;
      const srcY = (y + 0.5 - transform.padY) / transform.scale - 0.5;
      if (srcX < 0 || srcX > maxX || srcY < 0 || srcY > maxY) {
        data[i] = PAD_FILL[0];
        data[i + 1] = PAD_FILL[1];
        data[i + 2] = PAD_FILL[2];
        data[i + 3] = PAD_FILL[3];
        continue;
      }
      const [r, g, b, a] = bilinearSample(img, Math.min(Math.max(srcX, 0), maxX), Math.min(Math.max(srcY, 0), maxY));
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { image: { width: canvasSize, height: canvasSize, data }, transform };
}

/** One photo's dataset-dir label file — train_vision/dataset.py's
 * `build_dataset` reads exactly these four fields (see this file's header
 * doc). Deliberately NOT CompositeCardLabel/CompositeLabel: those carry
 * synthetic-only fields (visibleFraction, region, backgroundType, ...)
 * that have no real-photo equivalent to compute them from — see
 * composites/types.ts's CompositeCardLabel doc for why that stays a
 * synthetic-generator-only extension. */
export interface RealPhotoEvalLabel {
  fileName: string;
  width: number;
  height: number;
  cards: Quad[];
}

export interface RealPhotoEvalManifestEntry {
  compositeId: string;
  fileName: string;
  cardCount: number;
  labelFileHash: string;
}

export interface RealPhotoEvalManifest {
  schemaVersion: string;
  buildDate: string;
  canvasSize: number;
  stride: number;
  sourcePhotosDir: string;
  compositeCount: number;
  composites: RealPhotoEvalManifestEntry[];
}

export interface RealPhotoEvalExportEntry {
  photoId: string;
  fileName: string;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  quadCount: number;
}

/**
 * Export report: THREE distinct populations, deliberately never collapsed
 * into one number (same discipline as composites/coverageReport.ts's
 * covered / eligibleButNotPlaced / unavailableUpstream partition) —
 * `exported.length + skippedUnlabeledCount + skippedInvalidLabel.length`
 * always equals every photo file discovered under `photosDir`.
 */
export interface RealPhotoEvalExportReport {
  schemaVersion: string;
  buildDate: string;
  canvasSize: number;
  stride: number;
  /** Per-exported-photo real, computed facts — scale/sourceWidth/
   * sourceHeight come from the actual decoded photo, never a config
   * stand-in (see the "records a distinct, real ... scale" test). */
  exported: RealPhotoEvalExportEntry[];
  exportedCount: number;
  /** Photo files with NO matching label file at all (loadSet.ts's
   * missingLabels) — relative fileNames, same scheme as benchmark/
   * manifest.ts's skipped entries. */
  skippedUnlabeled: string[];
  skippedUnlabeledCount: number;
  /** Photo files that DO have a label file, but it failed to parse as
   * JSON or failed validatePhotoLabel's schema check — a photo present
   * but unlabeled and a photo present but MISlabeled are different
   * failure modes and are never folded into the same bucket. */
  skippedInvalidLabel: { fileName: string; reason: string }[];
  totalQuads: number;
}

export interface RealPhotoEvalSetOptions {
  photosDir: string;
  labelsDir: string;
  outDir: string;
  canvasSize?: number;
  stride?: number;
  now?: () => string;
}

/**
 * Builds a train_vision/dataset.py-compatible dataset dir from a labeled
 * real-photo benchmark set (see this file's header). Validates canvasSize/
 * stride BEFORE touching the filesystem (a misconfigured run should fail
 * loudly before clearing outDir, not after). Reuses benchmark/loadSet.ts's
 * loader — never re-implements label parsing — and validatePhotoLabel
 * directly (rather than benchmark/manifest.ts's aggregate) so this module
 * can distinguish "no label file" from "label file present but invalid"
 * in its own three-population report.
 */
export async function exportRealPhotoEvalSet(opts: RealPhotoEvalSetOptions): Promise<RealPhotoEvalExportReport> {
  const canvasSize = opts.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const stride = opts.stride ?? 8;
  validateCanvasDivisibleByStride(canvasSize, stride);
  const now = opts.now ?? (() => new Date().toISOString());

  const { entries, missingLabels } = loadBenchmarkPhotoSet(opts.photosDir, opts.labelsDir);

  const exported: RealPhotoEvalExportEntry[] = [];
  const manifestEntries: RealPhotoEvalManifestEntry[] = [];
  const skippedInvalidLabel: { fileName: string; reason: string }[] = [];
  let totalQuads = 0;

  fs.rmSync(opts.outDir, { recursive: true, force: true });
  fs.mkdirSync(opts.outDir, { recursive: true });

  for (const entry of entries) {
    if (entry.labelParseError) {
      skippedInvalidLabel.push({ fileName: entry.fileName, reason: `invalid JSON: ${entry.labelParseError}` });
      continue;
    }
    const result = validatePhotoLabel(entry.labelRaw);
    if (!result.valid) {
      skippedInvalidLabel.push({ fileName: entry.fileName, reason: result.errors.join("; ") });
      continue;
    }
    const photoLabel = result.label;

    const srcImage = await decodeImageToRaw(path.join(opts.photosDir, entry.fileName));

    // #286: cross-check the declared orientation against the real decoded
    // (EXIF-applied) frame before trusting this label's coordinates — a
    // mismatch here is the exact defect shape that let all 16 real
    // benchmark labels ship rotated 90° from their photos undetected.
    const frameErrors = validateLabelFrame(photoLabel, srcImage.width, srcImage.height);
    if (frameErrors.length > 0) {
      skippedInvalidLabel.push({ fileName: entry.fileName, reason: frameErrors.join("; ") });
      continue;
    }

    // #286 review round 2: the bounds-corruption backstop, alongside the
    // orientation check above.
    const boundsErrors = validateLabelBounds(photoLabel, srcImage.width, srcImage.height);
    if (boundsErrors.length > 0) {
      skippedInvalidLabel.push({ fileName: entry.fileName, reason: boundsErrors.join("; ") });
      continue;
    }

    const { image, transform } = letterboxRawImage(srcImage, canvasSize);
    const cards = photoLabel.quads.map((q) => transformQuad(q, transform));

    const fileName = `${photoLabel.photoId}.png`;
    const outLabel: RealPhotoEvalLabel = { fileName, width: canvasSize, height: canvasSize, cards };
    const labelBytes = Buffer.from(JSON.stringify(outLabel, null, 2) + "\n");

    fs.writeFileSync(path.join(opts.outDir, fileName), await encodeRawToPng(image));
    fs.writeFileSync(path.join(opts.outDir, `${photoLabel.photoId}.json`), labelBytes);

    manifestEntries.push({ compositeId: photoLabel.photoId, fileName, cardCount: cards.length, labelFileHash: sha256(labelBytes) });
    exported.push({
      photoId: photoLabel.photoId,
      fileName,
      sourceWidth: srcImage.width,
      sourceHeight: srcImage.height,
      scale: transform.scale,
      quadCount: cards.length,
    });
    totalQuads += cards.length;
  }

  const manifest: RealPhotoEvalManifest = {
    schemaVersion: REAL_PHOTO_EVAL_SCHEMA_VERSION,
    buildDate: now(),
    canvasSize,
    stride,
    sourcePhotosDir: opts.photosDir,
    compositeCount: manifestEntries.length,
    composites: manifestEntries,
  };
  fs.writeFileSync(path.join(opts.outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const report: RealPhotoEvalExportReport = {
    schemaVersion: REAL_PHOTO_EVAL_REPORT_SCHEMA_VERSION,
    buildDate: now(),
    canvasSize,
    stride,
    exported,
    exportedCount: exported.length,
    skippedUnlabeled: missingLabels,
    skippedUnlabeledCount: missingLabels.length,
    skippedInvalidLabel,
    totalQuads,
  };
  fs.writeFileSync(path.join(opts.outDir, "export-report.json"), JSON.stringify(report, null, 2) + "\n");

  return report;
}
