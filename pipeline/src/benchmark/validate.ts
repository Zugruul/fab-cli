import { ORIENTATIONS, QUAD_TAGS, SCENE_TYPES } from "./types.js";
import type { Orientation, PhotoLabel, Point, Quad, QuadTag, SceneType } from "./types.js";

export type ValidationResult = { valid: true; label: PhotoLabel } | { valid: false; errors: string[] };

/**
 * Validates a parsed label JSON object against the protocol in
 * pipeline/docs/benchmark-labeling.md. Collects every violation rather than
 * stopping at the first, so a malformed label file gets one actionable
 * error list instead of a fix-one-rerun-find-the-next loop.
 */
export function validatePhotoLabel(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["label is not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.photoId !== "string" || r.photoId.length === 0) {
    errors.push('"photoId" must be a non-empty string');
  }
  if (typeof r.fileName !== "string" || r.fileName.length === 0) {
    errors.push('"fileName" must be a non-empty string');
  }
  if (!isSceneType(r.sceneType)) {
    errors.push(`"sceneType" must be one of ${SCENE_TYPES.join("|")} (got ${JSON.stringify(r.sceneType)})`);
  }
  if (!isOrientation(r.orientation)) {
    errors.push(`"orientation" must be one of ${ORIENTATIONS.join("|")} (got ${JSON.stringify(r.orientation)})`);
  }

  if (!Array.isArray(r.quads)) {
    errors.push('"quads" must be an array');
  } else if (r.quads.length === 0) {
    errors.push('"quads" must contain at least one quad (a labeled photo with zero cards is not useful benchmark data)');
  } else {
    r.quads.forEach((q, i) => {
      for (const err of validateQuad(q)) errors.push(`quads[${i}]: ${err}`);
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    label: {
      photoId: r.photoId as string,
      fileName: r.fileName as string,
      sceneType: r.sceneType as SceneType,
      orientation: r.orientation as Orientation,
      quads: r.quads as Quad[],
    },
  };
}

function validateQuad(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["quad is not a JSON object"];
  const q = raw as Record<string, unknown>;

  if (typeof q.printingId !== "string" || q.printingId.length === 0) {
    errors.push('"printingId" must be a non-empty string');
  }

  if (!Array.isArray(q.corners) || q.corners.length !== 4) {
    const gotLen = Array.isArray(q.corners) ? q.corners.length : typeof q.corners;
    errors.push(`"corners" must be an array of exactly 4 points (got ${gotLen})`);
  } else {
    q.corners.forEach((c, i) => {
      if (!isPoint(c)) errors.push(`corners[${i}] must be {x: number, y: number}`);
    });
  }

  if (!Array.isArray(q.tags)) {
    errors.push('"tags" must be an array');
  } else {
    q.tags.forEach((t, i) => {
      if (!isQuadTag(t)) errors.push(`tags[${i}] must be one of ${QUAD_TAGS.join("|")} (got ${JSON.stringify(t)})`);
    });
  }

  return errors;
}

/**
 * Validates a label's declared `orientation` against the frame it actually
 * describes (#286). `frameWidth`/`frameHeight` must be the DECODED,
 * EXIF-applied dimensions — composites/imageIO.ts's `decodeImageToRaw` is
 * the canonical source, matching docs/benchmark-labeling.md's
 * canonical-frame decision (displayed/transposed wins, since that is the
 * frame every human label was authored in).
 *
 * This is the guard that would have caught #286 on day one: a
 * portrait-declared label against a wider-than-tall decoded frame (or vice
 * versa) means the label was authored against a different frame than the
 * one it will actually be scored against — exactly how all 16 real
 * benchmark labels went undetected (every one declared "portrait" while
 * the pre-fix decoder produced landscape buffers for every orientation-6
 * source). A square frame (width === height) has no orientation
 * preference and is never flagged either way.
 *
 * Deliberately NOT a per-corner bounds check: docs/benchmark-labeling.md's
 * amodal-labeling convention explicitly allows corners to fall arbitrarily
 * outside the photo's own pixel bounds for cropped/occluded cards (see
 * "Partially-visible or frame-cropped cards"), and `validatePhotoLabel`
 * above deliberately never bound-checks corners for the same reason — a
 * bounds check here would either reject legitimate severely-cropped labels
 * or, loosened enough to tolerate them, fail to catch the actual defect:
 * one of the 16 real mislabeled photos in this set
 * (HER155-unsleeved-groundbreaker-crix-marvel-cf) has a bounding box that
 * fits BOTH the raw and the transposed frame with zero overrun in either —
 * no bounds margin, however tight, can distinguish that case. Only the
 * frame's aspect ratio can, and it catches all 16 with nothing to tune.
 */
export function validateLabelFrame(label: PhotoLabel, frameWidth: number, frameHeight: number): string[] {
  if (frameWidth === frameHeight) return [];
  const actualOrientation: Orientation = frameWidth < frameHeight ? "portrait" : "landscape";
  if (label.orientation === actualOrientation) return [];
  return [
    `"orientation" is "${label.orientation}" but the decoded (EXIF-applied) photo frame is ` +
      `${frameWidth}x${frameHeight}, which is ${actualOrientation} — the label was likely authored ` +
      `against a different frame than the one it will be scored against (see #286)`,
  ];
}

/** Fraction of each axis's own frame dimension a corner may fall beyond
 * that axis's [0, dimension] range before `validateLabelBounds` treats it
 * as corrupted rather than legitimately cropped. See that function's doc
 * comment for how this number was chosen. */
const BOUNDS_MARGIN_RATIO = 0.5;

/**
 * A SEPARATE corruption backstop from `validateLabelFrame` above (#286
 * review round 2) — rejects a label whose corners are wildly outside the
 * canonical (EXIF-applied) frame: a completely wrong photo/label pairing,
 * a coordinate unit mixup, garbled data. Deliberately NOT tuned to re-catch
 * #286's own historical overrun range (4%-21% across the 16 real
 * mislabeled photos) — that is `validateLabelFrame`'s job, and it already
 * does it completely (16/16, nothing to tune). This function exists purely
 * as a generous safety net for data that's wrong in a different way.
 *
 * The margin has to be sized around a hard constraint: this codebase
 * already tests amodal cropping as functionally UNBOUNDED, not just
 * generous, in multiple places —
 *   - test/trainVision.realPhotoEvalSet.test.ts's "off-photo corner" test:
 *     a corner at (-100,-100) on a 300x400 frame (33.3%/25% overrun), run
 *     through the exact exportRealPhotoEvalSet pipeline this backstop sits
 *     in. This is the BINDING case for the margin below.
 *   - test/benchmarkLabel.routes.test.ts / .server.test.ts: corners
 *     hundreds of px past frame edges, asserted byte-for-byte "never
 *     clamped," explicitly called a merge blocker if violated (those go
 *     through `validatePhotoLabel` only, not this function, but document
 *     the same design intent this margin has to respect).
 *   - realPhotoEvalSet.ts's own header: "corners are scaled+offset only,
 *     NEVER clamped into [0, canvasSize]."
 * A per-corner bounds check that rejected any of that would silently
 * corrupt real ground truth for exactly the cropped-card cases the
 * benchmark most needs — worse than the bug this backstop exists to catch.
 *
 * `BOUNDS_MARGIN_RATIO` (50%) clears the binding 33.3% case with real
 * headroom (1.5x) while still catching genuinely nonsensical data (e.g. a
 * corner several times the frame's own size) — sized to be a hygiene
 * backstop, not a #286-specific detector.
 */
export function validateLabelBounds(label: PhotoLabel, frameWidth: number, frameHeight: number): string[] {
  const marginX = frameWidth * BOUNDS_MARGIN_RATIO;
  const marginY = frameHeight * BOUNDS_MARGIN_RATIO;
  const errors: string[] = [];
  label.quads.forEach((quad, qi) => {
    quad.corners.forEach((corner, ci) => {
      if (corner.x < -marginX || corner.x > frameWidth + marginX || corner.y < -marginY || corner.y > frameHeight + marginY) {
        errors.push(
          `quads[${qi}].corners[${ci}] (${corner.x}, ${corner.y}) is far outside the ${frameWidth}x${frameHeight} decoded ` +
            `frame (beyond a ${Math.round(BOUNDS_MARGIN_RATIO * 100)}% margin) — likely a corrupted coordinate or a label ` +
            `matched to the wrong photo`,
        );
      }
    });
  });
  return errors;
}

function isPoint(v: unknown): v is Point {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Point).x === "number" &&
    typeof (v as Point).y === "number"
  );
}

function isSceneType(v: unknown): v is SceneType {
  return typeof v === "string" && (SCENE_TYPES as readonly string[]).includes(v);
}

function isOrientation(v: unknown): v is Orientation {
  return typeof v === "string" && (ORIENTATIONS as readonly string[]).includes(v);
}

function isQuadTag(v: unknown): v is QuadTag {
  return typeof v === "string" && (QUAD_TAGS as readonly string[]).includes(v);
}
