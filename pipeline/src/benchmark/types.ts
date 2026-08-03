/**
 * Real-photo benchmark labeling protocol types (SPEC-APP.md §8.7e, APP-025).
 * See pipeline/docs/benchmark-labeling.md for the full protocol these
 * codify; validate.ts enforces them, manifest.ts versions a labeled set.
 */

/** Bumped whenever this label shape changes in a way that would break an
 * existing labeled photo's file (new required field, renamed field, etc.). */
export const LABEL_SCHEMA_VERSION = "0.1.0";

export const SCENE_TYPES = ["single", "field", "binder"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const ORIENTATIONS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const QUAD_TAGS = ["sleeved", "foil", "glare"] as const;
export type QuadTag = (typeof QUAD_TAGS)[number];

/** Pixel coordinates in the photo's native, unrotated pixel space. */
export interface Point {
  x: number;
  y: number;
}

/** One card's bounding quad within a photo: 4 pixel-space corners in
 * clockwise order starting top-left (TL, TR, BR, BL). */
export interface Quad {
  /** The stable printing identifier — the-fab-cube's printing `unique_id`
   * (see pipeline/src/images/catalog.ts's doc comment for why), NOT the
   * human-readable set+number print code and NOT a registry id (that
   * mapping happens at eval time, per APP-025's backlog note — no APP-085
   * dependency here). */
  printingId: string;
  corners: [Point, Point, Point, Point];
  tags: QuadTag[];
}

export interface PhotoLabel {
  photoId: string;
  /** Path of the photo file, relative to the benchmark photos dir. */
  fileName: string;
  sceneType: SceneType;
  orientation: Orientation;
  /** One entry per card visible in the photo — at least one (a labeled
   * photo with zero cards isn't useful benchmark data). */
  quads: Quad[];
}
