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
