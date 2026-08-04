/**
 * Two-player mirrored-playmat composition (#253f): a single canvas holding
 * two copies of the playmat stacked vertically — the NEAR mat (bottom
 * half, upright) and the FAR mat (top half, rotated 180°) — like two
 * players facing each other across a table. Each mat is planned and
 * rendered as its own ordinary single-mat composite (planZoneLayout.ts +
 * the existing renderComposite), then combined here: image stacking is a
 * pure pixel operation, and each mat's card quads are transformed by the
 * exact geometric operation that was actually applied to its pixels (a
 * translate for the near mat, a 180-rotation-about-the-mat-center for the
 * far mat) — mirroring geometry.ts's own contract that a label must never
 * silently diverge from what was actually rendered.
 *
 * The far mat's quad transform preserves each corner's SOURCE identity
 * (index 0..3 stays TL/TR/BR/BL by construction, not by post-rotation
 * visual position) — same convention geometry.ts's computeDestQuad
 * documents for its own rotationDeg handling — and is never clamped,
 * consistent with the amodal convention used everywhere else in this
 * pipeline: an off-mat (negative or >matWidth/matHeight) corner stays
 * exactly that after the 180 flip.
 */
import type { RawImage } from "../rawImage.js";
import type { RenderResult } from "../compositor.js";
import type { CompositeLabel, CompositeCardLabel, Point } from "../types.js";

/** Reverses the RGBA buffer in whole-pixel (4-byte) groups — a 180°
 * rotation about the image's own center is exactly "read the pixels
 * back to front," not a re-render. */
export function rotate180RawImage(img: RawImage): RawImage {
  const total = img.width * img.height;
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < total; i++) {
    const src = i * 4;
    const dst = (total - 1 - i) * 4;
    out[dst] = img.data[src];
    out[dst + 1] = img.data[src + 1];
    out[dst + 2] = img.data[src + 2];
    out[dst + 3] = img.data[src + 3];
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Rotates an image a quarter turn. `cw` maps source (x, y) -> (H - 1 - y, x)
 * and `ccw` maps (x, y) -> (y, W - 1 - x); both swap the canvas dimensions
 * (W x H -> H x W). Like rotate180RawImage this is a pure pixel re-read, not
 * a re-render, and is exactly lossless (cw then ccw is the identity).
 *
 * Needed because a playmat is authored LANDSCAPE (its zone rows run across
 * the mat) but on a real tournament table the two mats are laid out along
 * the table's long axis, each turned a quarter turn so a player's zone rows
 * run down their own side of frame. Stacking two landscape mats instead
 * produces a canvas roughly 2*(W/H) wide, which then can only be fitted into
 * a landscape play-area rect by squashing it — see this module's
 * mergeBroadcastTableRenders and the test file that locks it.
 */
export function rotate90RawImage(img: RawImage, direction: "cw" | "ccw"): RawImage {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(img.data.length);
  // Rotated canvas is h wide, w tall.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dx = direction === "cw" ? h - 1 - y : y;
      const dy = direction === "cw" ? x : w - 1 - x;
      const dst = (dy * h + dx) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = img.data[src + 3];
    }
  }
  return { width: h, height: w, data: out };
}

/**
 * Removes the top `cropPx` rows of an image, shrinking its height by
 * exactly that amount (width unchanged). Used by mergeBroadcastTableRenders
 * (#256 correction) to strip each mat's decorative top-edge banner BEFORE
 * the quarter-turn — see that function's header for why cropping
 * pre-rotation (a single axis-aligned strip) is simpler than cropping the
 * rotated image's inner-edge columns, even though the two are equivalent
 * under rotate90RawImage's own coordinate map.
 */
export function cropTopRawImage(img: RawImage, cropPx: number): RawImage {
  if (cropPx < 0 || cropPx >= img.height) {
    throw new Error(`cropTopRawImage: cropPx (${cropPx}) must be in [0, height) (height=${img.height})`);
  }
  return { width: img.width, height: img.height - cropPx, data: img.data.slice(cropPx * img.width * 4) };
}

/**
 * The quad analog of rotate90RawImage — the SAME geometric operation applied
 * to a label, so a card's quad never silently diverges from where its pixels
 * actually landed (geometry.ts's contract). Continuous-coordinate form of the
 * pixel map above: cw is (x, y) -> (matHeight - y, x), ccw is (x, y) ->
 * (y, matWidth - x).
 *
 * Corner TUPLE ORDER is preserved — index 0..3 stays TL/TR/BR/BL by SOURCE
 * identity, not by post-rotation visual position, matching
 * rotateQuad180AboutMat and computeDestQuad's documented rotationDeg
 * handling. Never clamped: an off-mat corner stays off-mat (amodal).
 *
 * Being a rigid motion, this cannot change a card's edge lengths — which is
 * precisely why the fix for the squish is a rotation and not a rescale.
 */
export function rotateQuad90AboutMat(
  corners: [Point, Point, Point, Point],
  matWidth: number,
  matHeight: number,
  direction: "cw" | "ccw",
): [Point, Point, Point, Point] {
  const turn = (p: Point): Point =>
    direction === "cw" ? { x: matHeight - p.y, y: p.x } : { x: p.y, y: matWidth - p.x };
  return [turn(corners[0]), turn(corners[1]), turn(corners[2]), turn(corners[3])];
}

/** Stacks `top` directly above `bottom` into one canvas of the combined
 * height — both must share the same width. */
export function stackVertically(top: RawImage, bottom: RawImage): RawImage {
  if (top.width !== bottom.width) {
    throw new Error(`stackVertically: mismatched width (top=${top.width}, bottom=${bottom.width})`);
  }
  const width = top.width;
  const height = top.height + bottom.height;
  const data = new Uint8ClampedArray(width * height * 4);
  data.set(top.data, 0);
  data.set(bottom.data, top.data.length);
  return { width, height, data };
}

/**
 * Stacks `left` directly beside `right` into one canvas of the combined
 * width — both must share the same height. The left/right analog of
 * stackVertically above (#256, Phase C.1's landscape/vertical-mirror-axis
 * table) — a plain row-wise pixel concatenation, not a re-render.
 */
export function stackHorizontally(left: RawImage, right: RawImage): RawImage {
  if (left.height !== right.height) {
    throw new Error(`stackHorizontally: mismatched height (left=${left.height}, right=${right.height})`);
  }
  const height = left.height;
  const width = left.width + right.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const destRowStart = y * width * 4;
    const leftRowStart = y * left.width * 4;
    const rightRowStart = y * right.width * 4;
    data.set(left.data.subarray(leftRowStart, leftRowStart + left.width * 4), destRowStart);
    data.set(right.data.subarray(rightRowStart, rightRowStart + right.width * 4), destRowStart + left.width * 4);
  }
  return { width, height, data };
}

/** (x, y) -> (matWidth - x, matHeight - y) for each corner, tuple order
 * preserved (source-corner identity, not post-rotation visual position —
 * see this module's header). Never clamped (amodal, matches geometry.ts). */
export function rotateQuad180AboutMat(corners: [Point, Point, Point, Point], matWidth: number, matHeight: number): [Point, Point, Point, Point] {
  const flip = (p: Point): Point => ({ x: matWidth - p.x, y: matHeight - p.y });
  return [flip(corners[0]), flip(corners[1]), flip(corners[2]), flip(corners[3])];
}

export function translateQuad(corners: [Point, Point, Point, Point], dx: number, dy: number): [Point, Point, Point, Point] {
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return [shift(corners[0]), shift(corners[1]), shift(corners[2]), shift(corners[3])];
}

/**
 * Merges two independently-rendered single-mat composites into one
 * two-player composite: `near` becomes the bottom half (upright,
 * translated down by its own height), `far` becomes the top half
 * (rotated 180° about its own center — both the pixels AND every one of
 * its card quads). Reuses RenderResult/CompositeLabel unchanged, so the
 * result flows through write.ts/sampleSheet.ts exactly like any other
 * composite.
 */
export function mergeTwoPlayerRenders(near: RenderResult, far: RenderResult, compositeId: string): RenderResult {
  if (near.image.width !== far.image.width || near.image.height !== far.image.height) {
    throw new Error(
      `mergeTwoPlayerRenders: mat dimension mismatch (near=${near.image.width}x${near.image.height}, far=${far.image.width}x${far.image.height})`,
    );
  }
  const matWidth = near.image.width;
  const matHeight = near.image.height;

  const farRotated = rotate180RawImage(far.image);
  const image = stackVertically(farRotated, near.image);

  const nearCards: CompositeCardLabel[] = near.label.cards.map((c) => ({ ...c, corners: translateQuad(c.corners, 0, matHeight) }));
  const farCards: CompositeCardLabel[] = far.label.cards.map((c) => ({ ...c, corners: rotateQuad180AboutMat(c.corners, matWidth, matHeight) }));

  const label: CompositeLabel = {
    compositeId,
    fileName: `${compositeId}.png`,
    width: matWidth,
    height: matHeight * 2,
    backgroundType: near.label.backgroundType,
    backgroundHash: near.label.backgroundHash,
    cards: [...farCards, ...nearCards],
    excludedCards: near.label.excludedCards + far.label.excludedCards,
    cardBacksPlaced: near.label.cardBacksPlaced + far.label.cardBacksPlaced,
  };

  return { image, label };
}

/**
 * Landscape, VERTICAL-mirror-axis analog of mergeTwoPlayerRenders above
 * (#256 Phase C.1) — 90° off that function's horizontal/near-far axis:
 * players sit LEFT and RIGHT of frame instead of near/far, top/bottom.
 *
 * Each mat is first rotated a QUARTER TURN (left cw, right ccw), THEN placed
 * side by side. The quarter turn is what makes this a real table rather than
 * two landscape mats jammed together:
 *
 *   - A playmat is authored landscape (matWidth x matHeight, matWidth >
 *     matHeight). Stacking two of those unrotated gives a canvas of aspect
 *     2*(matWidth/matHeight) — 3.43 for the real 1728x1008 Combat Chain mat —
 *     which can only be fitted into the landscape play-area rect (aspect
 *     ~1.16) by a NON-UNIFORM scale. That squash is what produced 249 card
 *     labels at aspect 0.259 against a real card's 63/88 = 0.716.
 *   - Rotated first, each mat is matHeight x matWidth (portrait) and the pair
 *     is 2*matHeight x matWidth — 2016x1728, aspect 1.166 for the real mat,
 *     i.e. the play-area aspect. It fits under a UNIFORM scale, so a card
 *     keeps its 0.716.
 *
 * Using cw for one side and ccw for the other keeps the relative 180° between
 * the players — they still face each other across the table — since
 * ccw === cw composed with a 180° turn. Every card quad is transformed by the
 * exact operation applied to its pixels, from this one place, so labels can
 * never diverge from the render (geometry.ts's contract). Reuses
 * RenderResult/CompositeLabel unchanged, so the result flows through
 * write.ts/sampleSheet.ts exactly like any other composite.
 *
 * `topCropFrac` (#256 correction, human-upgraded to blocking: "two separate
 * mats butted together") strips each mat's own decorative top-edge band —
 * a fraction of matHeight, rounded to a pixel count — BEFORE the quarter
 * turn. Without it, EACH mat's top edge (e.g. the reference playmat's
 * "COMBAT CHAIN" banner) lands right at the seam after rotation: cw maps
 * original y=0 to the rotated image's rightmost column (the left mat's
 * inner/seam edge); ccw maps original y=0 to the leftmost column (the
 * right mat's inner/seam edge) — both banners end up adjacent, visible as
 * two back-to-back decorative strips down the middle of an otherwise
 * continuous table. Cropping pre-rotation is a single axis-aligned strip
 * (simpler than clipping the rotated image's inner columns, though the two
 * are equivalent under rotate90RawImage's own coordinate map) — every
 * remaining card quad only needs the SAME uniform upward shift
 * (translateQuad by (0, -cropPx)) applied before the existing rotation,
 * never a rotated-frame clip. Defaults to 0 (byte-identical to the
 * pre-correction signature) since this is meaningless outside `--mode
 * broadcast`'s specific reference-playmat assumption — see
 * generateBroadcastRun.ts's BROADCAST_TABLE_TOP_CROP_FRAC for the actual
 * measured value and the safety-margin proof that it never clips a real
 * card under the production zone-layout config's jitter/rotation ranges.
 */
export function mergeBroadcastTableRenders(left: RenderResult, right: RenderResult, compositeId: string, topCropFrac = 0): RenderResult {
  if (left.image.width !== right.image.width || left.image.height !== right.image.height) {
    throw new Error(
      `mergeBroadcastTableRenders: mat dimension mismatch (left=${left.image.width}x${left.image.height}, right=${right.image.width}x${right.image.height})`,
    );
  }
  const matWidth = left.image.width;
  const matHeight = left.image.height;
  const cropPx = Math.round(topCropFrac * matHeight);
  const croppedMatHeight = matHeight - cropPx;

  const leftCropped = cropTopRawImage(left.image, cropPx);
  const rightCropped = cropTopRawImage(right.image, cropPx);

  const leftRotated = rotate90RawImage(leftCropped, "cw");
  const rightRotated = rotate90RawImage(rightCropped, "ccw");
  const image = stackHorizontally(leftRotated, rightRotated);

  // Post-rotation each (now-cropped) mat occupies croppedMatHeight in x and
  // matWidth in y.
  const halfWidth = croppedMatHeight;

  const leftCards: CompositeCardLabel[] = left.label.cards.map((c) => ({
    ...c,
    corners: rotateQuad90AboutMat(translateQuad(c.corners, 0, -cropPx), matWidth, croppedMatHeight, "cw"),
  }));
  const rightCards: CompositeCardLabel[] = right.label.cards.map((c) => ({
    ...c,
    corners: translateQuad(rotateQuad90AboutMat(translateQuad(c.corners, 0, -cropPx), matWidth, croppedMatHeight, "ccw"), halfWidth, 0),
  }));

  const label: CompositeLabel = {
    compositeId,
    fileName: `${compositeId}.png`,
    width: halfWidth * 2,
    height: matWidth,
    backgroundType: left.label.backgroundType,
    backgroundHash: left.label.backgroundHash,
    cards: [...leftCards, ...rightCards],
    excludedCards: left.label.excludedCards + right.label.excludedCards,
    cardBacksPlaced: left.label.cardBacksPlaced + right.label.cardBacksPlaced,
  };

  return { image, label };
}
