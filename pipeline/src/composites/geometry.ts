/**
 * Pure geometry for one pasted card's post-transform corners (SPEC-APP.md
 * §8.7b). computeDestQuad is THE function whose output is used BOTH for
 * the emitted ground-truth label (compositor.ts) AND for the pixel warp
 * target (warp.ts) — by construction the same array/values feed both, so
 * label and rendered pixels cannot silently diverge.
 *
 * "Perspective" here concretely means: a single-axis keystone/trapezoid
 * distortion of the card's TOP edge (each top corner independently pushed
 * horizontally toward the vertical center line), NOT a full 3D camera/
 * out-of-plane projection. It's still rendered as a genuine 4-point
 * projective warp (homography.ts + warp.ts), not an affine shear — see
 * this module's tests for the non-affine (non-parallel-sides) check.
 */
import type { Point } from "./types.js";

export interface QuadPlacement {
  centerXFrac: number;
  centerYFrac: number;
  rotationDeg: number;
  cardHeightFrac: number;
  perspectiveLeftFrac: number;
  perspectiveRightFrac: number;
}

/**
 * Order of operations (in the card's local, unrotated frame, then rotated,
 * then translated into canvas space):
 *  1. Start from the axis-aligned rect of size (cardW, cardH) centered on
 *     the origin: TL=(-w/2,-h/2) TR=(w/2,-h/2) BR=(w/2,h/2) BL=(-w/2,h/2).
 *  2. Perspective: push the TOP two corners horizontally toward the
 *     vertical center line by perspectiveLeftFrac/perspectiveRightFrac
 *     (each a fraction of the half-width).
 *  3. Rotate all 4 points by rotationDeg (degrees, clockwise-positive in
 *     screen/pixel-space, i.e. y-down) about the origin.
 *  4. Translate by (centerXFrac*canvasWidth, centerYFrac*canvasHeight).
 *
 * Returns [TL, TR, BR, BL] — clockwise starting top-left, matching
 * benchmark/types.ts's Quad.corners convention (these labels track the
 * SOURCE corner identity, not the post-rotation visual position).
 */
export function computeDestQuad(
  canvasWidth: number,
  canvasHeight: number,
  aspectRatio: number,
  placement: QuadPlacement,
): [Point, Point, Point, Point] {
  const cardH = placement.cardHeightFrac * canvasHeight;
  const cardW = cardH * aspectRatio;
  const halfW = cardW / 2;
  const halfH = cardH / 2;

  const tl: Point = { x: -halfW + placement.perspectiveLeftFrac * halfW, y: -halfH };
  const tr: Point = { x: halfW - placement.perspectiveRightFrac * halfW, y: -halfH };
  const br: Point = { x: halfW, y: halfH };
  const bl: Point = { x: -halfW, y: halfH };

  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = placement.centerXFrac * canvasWidth;
  const cy = placement.centerYFrac * canvasHeight;

  const transform = (p: Point): Point => ({
    x: p.x * cos - p.y * sin + cx,
    y: p.x * sin + p.y * cos + cy,
  });

  return [transform(tl), transform(tr), transform(br), transform(bl)];
}
