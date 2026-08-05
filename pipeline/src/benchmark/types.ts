/**
 * Real-photo benchmark labeling protocol types (SPEC-APP.md §8.7e, APP-025).
 * See pipeline/docs/benchmark-labeling.md for the full protocol these
 * codify; validate.ts enforces them, manifest.ts versions a labeled set.
 */

/** Bumped whenever this label shape changes in a way that would break an
 * existing labeled photo's file (new required field, renamed field, etc.).
 * 0.2.0 (issue #274): extended QUAD_TAGS below — purely additive (no
 * existing field renamed/removed, no existing tag's meaning changed), so
 * every label file written under 0.1.0 still validates unchanged under
 * 0.2.0. Bumped anyway because the *set of legal tags* a validator accepts
 * is part of this shape's contract, and a consumer pinned to 0.1.0's tag
 * list should know new ones exist. */
export const LABEL_SCHEMA_VERSION = "0.2.0";

export const SCENE_TYPES = ["single", "field", "binder"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const ORIENTATIONS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/**
 * Per-quad tag vocabulary. Issue #274 extended the original
 * `sleeved | foil | glare` with treatment/rarity tags, grounded in
 * the-fab-cube's own catalog fields (never invented) so a human labeler
 * can apply them consistently against what the printing actually is:
 *
 * - `cold-foil` / `rainbow-foil` / `gold-foil` — refine `foil` by
 *   the-fab-cube `foiling` code (`C`/`R`/`G`; `S` = standard/non-foil,
 *   i.e. no foil tag at all). `foil` itself is KEPT, unchanged, as the
 *   generic/unspecified-foil-type bit — additive, not a replacement, so
 *   every pre-#274 labeled quad stays valid and a labeler who hasn't
 *   confirmed which foil type it is can still tag just `foil`.
 * - `marvel` / `promo` — the-fab-cube `rarity` codes `V`/`P`. Called out
 *   explicitly because a full-art cold-foil promo *looks* Marvel but is
 *   rarity `P`, not `V` (verified live: HER155 Groundbreaker Crix is
 *   `P`) — collapsing them would hide exactly the confusion this tag
 *   exists to record.
 * - `alternate-art` / `alternate-border` / `extended-art` / `full-art` /
 *   `alternate-text` — the-fab-cube `art_variations` codes `AA`/`AB`/
 *   `EA`/`FA`/`AT`, i.e. the exact same five-value vocabulary
 *   `fab-cli fabrary cards search --treatment` already uses for this
 *   concept (see fab-cli/CLAUDE.md's `--treatment` flag) — not a newly
 *   invented naming, a match to prior art in this monorepo. (`art_
 *   variations`'s sixth code, `HS`, is dropped: 4 occurrences across the
 *   whole catalog, undocumented, not part of that existing `--treatment`
 *   vocabulary either — too thin to ground a tag on.)
 *
 * Other rarity codes (`C`/`R`/`M`/`T`/`L`/`S`/`B`/`F`) are deliberately
 * NOT tags: unlike marvel/promo, plain rarity isn't a visual-treatment
 * axis a recognizer needs to tell printings apart on — see issue #274's
 * report for this scoping call.
 */
export const QUAD_TAGS = [
  "sleeved",
  "foil",
  "glare",
  "cold-foil",
  "rainbow-foil",
  "gold-foil",
  "marvel",
  "promo",
  "alternate-art",
  "alternate-border",
  "extended-art",
  "full-art",
  "alternate-text",
] as const;
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
