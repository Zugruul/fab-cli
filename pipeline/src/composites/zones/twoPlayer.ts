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
 * `left` becomes the LEFT half (upright, untouched — it already occupies
 * x in [0,matWidth)); `right` becomes the RIGHT half (rotated 180° about
 * its own mat center — same rotateQuad180AboutMat/rotate180RawImage this
 * file already uses for the far mat above, since a 180° rotation about a
 * mat's own center is the identical operation regardless of which axis
 * the two mats end up arranged along — then translated by matWidth in x,
 * 0 in y). Reuses RenderResult/CompositeLabel unchanged, so the result
 * flows through write.ts/sampleSheet.ts exactly like any other composite,
 * same as mergeTwoPlayerRenders.
 */
export function mergeBroadcastTableRenders(left: RenderResult, right: RenderResult, compositeId: string): RenderResult {
  if (left.image.width !== right.image.width || left.image.height !== right.image.height) {
    throw new Error(
      `mergeBroadcastTableRenders: mat dimension mismatch (left=${left.image.width}x${left.image.height}, right=${right.image.width}x${right.image.height})`,
    );
  }
  const matWidth = left.image.width;
  const matHeight = left.image.height;

  const rightRotated = rotate180RawImage(right.image);
  const image = stackHorizontally(left.image, rightRotated);

  const leftCards: CompositeCardLabel[] = left.label.cards.map((c) => ({ ...c }));
  const rightCards: CompositeCardLabel[] = right.label.cards.map((c) => ({
    ...c,
    corners: translateQuad(rotateQuad180AboutMat(c.corners, matWidth, matHeight), matWidth, 0),
  }));

  const label: CompositeLabel = {
    compositeId,
    fileName: `${compositeId}.png`,
    width: matWidth * 2,
    height: matHeight,
    backgroundType: left.label.backgroundType,
    backgroundHash: left.label.backgroundHash,
    cards: [...leftCards, ...rightCards],
    excludedCards: left.label.excludedCards + right.label.excludedCards,
    cardBacksPlaced: left.label.cardBacksPlaced + right.label.cardBacksPlaced,
  };

  return { image, label };
}
