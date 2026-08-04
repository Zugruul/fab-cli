/**
 * Synthetic-composite generator label vocabulary (SPEC-APP.md §8.7b,
 * APP-026). Reuses benchmark/types.ts's `Point`/`Quad`/`QuadTag`
 * verbatim for the per-card ground truth (corners + printingId + tags)
 * — the same label vocabulary the real-photo benchmark (APP-025) and the
 * eventual detector (APP-027) both consume, per this task's brief: "the
 * same label vocabulary as pipeline/src/benchmark/".
 */
export type { Point, Quad, QuadTag } from "../benchmark/types.js";
export { QUAD_TAGS } from "../benchmark/types.js";
import type { Quad } from "../benchmark/types.js";

export const BACKGROUND_TYPES = ["solid", "gradient", "noise", "texture"] as const;
export type BackgroundType = (typeof BACKGROUND_TYPES)[number];

/** Full background provenance kind recorded per composite (#244): either a
 * procedural pattern (backed by BackgroundType) or a real external photo.
 * Distinct from BackgroundType itself since "external" isn't one of the
 * procedural pattern types config.backgroundTypes draws from — it's a
 * template-literal union so "procedural:solid" etc. stay tied to
 * BackgroundType rather than being a free-form string. */
export type CompositeBackgroundKind = `procedural:${BackgroundType}` | "external";

/** Bumped whenever this label shape changes in a way that would break an
 * existing composite's label file (mirrors benchmark/types.ts's
 * LABEL_SCHEMA_VERSION convention). #244: backgroundType widened from
 * BackgroundType to CompositeBackgroundKind + backgroundHash added. */
export const COMPOSITE_LABEL_SCHEMA_VERSION = "0.2.0";

/**
 * One rendered composite's ground truth. `cards[i].corners` are the
 * POST-TRANSFORM pixel coordinates in THIS composite's own pixel space
 * (not the source card image's space) — computed by the exact same
 * geometry (geometry.ts's computeDestQuad) used to render that card, so
 * label and pixels can never silently diverge (see compositor.ts's header
 * and SPEC-APP.md §8.7b's WHY: label fidelity is what makes the
 * downstream detector's ground truth trustworthy).
 */
export interface CompositeLabel {
  compositeId: string;
  /** Path of the rendered composite image, relative to the run's output dir. */
  fileName: string;
  width: number;
  height: number;
  backgroundType: CompositeBackgroundKind;
  /** The external background's content hash (matches its imported file
   * name's stem — see importBackgrounds.ts), or null for a procedural
   * background. Exact per-composite provenance: which real photo trained
   * on which sample (#244). */
  backgroundHash: string | null;
  /** One entry per pasted card, in paste (z-)order. */
  cards: Quad[];
}
