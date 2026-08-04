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
 * BackgroundType to CompositeBackgroundKind + backgroundHash added. #252:
 * cards[] entries gained visibleFraction, and the label gained
 * excludedCards. */
export const COMPOSITE_LABEL_SCHEMA_VERSION = "0.3.0";

/**
 * One pasted card's ground truth, extending the shared Quad vocabulary
 * with a composites-only visibility signal (#252). `visibleFraction` is
 * NOT added to the shared `Quad`/benchmark/types.ts interface itself —
 * the real-photo benchmark (APP-025) has no equivalent per-pixel
 * bookkeeping to compute it from, so this stays a synthetic-generator-
 * only extension layered on top of the shared corners/tags/printingId
 * shape.
 *
 * ## visibleFraction (#252)
 *
 * Fraction (0..1) of this card's own full, un-clamped geometric footprint
 * (compositor.ts's per-card owner/survivingCount bookkeeping, computed
 * against warp.ts's `countCardFootprintPixels` denominator — see that
 * function's doc) that survives, un-occluded and on-canvas, in the final
 * rendered image:
 *
 *   visibleFraction = survivingOnCanvasPixelCount / fullFootprintPixelCount
 *
 * **Canvas-edge clipping and later-card occlusion are combined into this
 * ONE number**, not tracked as separate `clippedFraction`/
 * `occludedFraction` fields — a deliberate decision, not an oversight:
 *
 * - It matches this codebase's existing amodal convention, which already
 *   treats the two as the same kind of visibility loss in the same
 *   breath — see geometry.ts's doc comment and
 *   docs/benchmark-labeling.md's "Partially-visible or frame-cropped
 *   cards" section, which lists "cropped by the photo frame edge, or
 *   partly hidden behind another card" as one unified case, not two.
 * - The training consumer (APP-027's encode) only needs to know "is there
 *   enough legible pixel signal here to learn from" — a pixel that's
 *   off-canvas is exactly as unlearnable as a pixel painted over by a
 *   later card. The CAUSE doesn't change that answer, so a second field
 *   would be unused complexity right now (APP-027's encode already drops
 *   out-of-heatmap centers separately, for the different, coarser
 *   question of "is this card's center even representable").
 *
 * Amodal quad `corners` are UNCHANGED by any of this: an included card's
 * corners still record its true, full geometric extent exactly as before
 * — visibleFraction is a purely additive filtering signal, not a
 * replacement for the amodal convention.
 *
 * ## Boundary conventions (decided before the first test, #252)
 *
 * - A card fully off-canvas has visibleFraction exactly 0 (its footprint
 *   is real, positive; nothing of it survives on-canvas) — this reads
 *   like full occlusion and is excluded the same way, by the same
 *   threshold check.
 * - Inclusion is `visibleFraction >= config.minVisibleFraction` — the
 *   threshold is INCLUSIVE at the boundary, not `>`.
 * - A composite where every pasted card falls below the threshold is
 *   still a VALID composite: `cards: []`, `excludedCards` set to the
 *   pasted count — never re-rolled. Re-rolling would consume additional
 *   rng draws conditionally on rendered pixel content, breaking
 *   paramStream.ts's "same seed -> same draw shape" determinism
 *   contract; this filtering is strictly post-hoc (computed AFTER
 *   rendering, from already-deterministic pixels) and never feeds back
 *   into planning.
 * - Paste order is authoritative: only a STRICTLY LATER card can reduce
 *   an earlier card's visibleFraction. An occluder painted UNDER a card
 *   (earlier in paste order) never reduces that card's visibility, even
 *   if their quads geometrically overlap — see compositor.ts's
 *   owner/survivingCount bookkeeping, which only ever transfers a pixel
 *   from an earlier card's count to a later one, never the reverse.
 */
export interface CompositeCardLabel extends Quad {
  visibleFraction: number;
}

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
  /** One entry per pasted card that cleared config.minVisibleFraction, in
   * paste (z-)order — see CompositeCardLabel's doc (#252). A card pasted
   * but excluded for low visibility does NOT appear here at all (its
   * pixels are still rendered; only its ground-truth entry is dropped). */
  cards: CompositeCardLabel[];
  /** Count of cards pasted into this composite (pixels rendered) but
   * excluded from `cards` because their visibleFraction fell below
   * config.minVisibleFraction (#252) — the per-composite provenance
   * counterpart to `cards.length`, so a reader can tell "a 2-card
   * composite where 1 card was excluded" (cards.length=1,
   * excludedCards=1) apart from "a normal 1-card composite"
   * (cards.length=1, excludedCards=0) without re-deriving anything from
   * pixels. 0 for a composite where every pasted card cleared the
   * threshold — the common case. */
  excludedCards: number;
}
