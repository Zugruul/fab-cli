/**
 * Table-level perspective keystone for `--mode broadcast` (#256 Phase
 * C.2). SAME math as geometry.ts's per-card computeDestQuad — a
 * single-axis keystone/trapezoid inset, rendered as a genuine 4-point
 * projective warp (homography.ts + warp.ts), not an affine shear — but
 * rotated 90°: geometry.ts insets the card's TOP edge horizontally toward
 * the vertical center line (for `--mode two-player`'s horizontal,
 * near/far mirror axis). Broadcast mode's mirror axis is VERTICAL
 * (players seated left/right of the frame, #256 brief), so the analogous
 * keystone insets the LEFT and RIGHT edges VERTICALLY toward the
 * horizontal center line instead — literally geometry.ts's own transform
 * with x/y swapped, not a different algorithm; see this module's tests
 * for the direct side-by-side comparison.
 *
 * `computeTableDestQuad` is THE single source of truth feeding both:
 *   1. the pixel warp (warpToQuad(tableImage, dstQuad, canvasW, canvasH) —
 *      called by the broadcast render step, this module does not call it
 *      itself, mirroring how geometry.ts doesn't call warpToQuad either),
 *      and
 *   2. every card label already in the table image's own local pixel
 *      space (mergeBroadcastTableRenders's output, twoPlayer.ts),
 *      transformed by `transformTableLabelsThroughHomography` below.
 * Both consumers derive the SAME homography matrix from the SAME
 * (srcRect, dstQuad) pair — srcRect is purely `tableImage.width/height`,
 * dstQuad is this module's one computed quad — so the two can never
 * silently diverge, exactly the guarantee geometry.ts's own header
 * documents for computeDestQuad feeding both compositor.ts's warp call
 * and its label push.
 *
 * AMODAL (matches geometry.ts and every other quad-producing function in
 * this pipeline): never clamps to canvas bounds, in either function.
 */
import { solveHomography, applyHomography } from "../homography.js";
import type { Point } from "../types.js";
import type { CompositeCardLabel } from "../types.js";

export interface TableQuadPlacement {
  centerXFrac: number;
  centerYFrac: number;
  /** The table's rendered size, as fractions of the FRAME canvas
   * (typically matching a broadcast-layout config's playArea rect). */
  tableWidthFrac: number;
  tableHeightFrac: number;
  /** Inset of the LEFT edge's two corners (TL, BL) toward the horizontal
   * center line, as a fraction of the table's own half-height. Mirrors
   * geometry.ts's perspectiveLeftFrac/perspectiveRightFrac naming and
   * bound (0 = no inset; must stay below 1, which would collapse the
   * edge to a point). */
  perspectiveLeftEdgeFrac: number;
  /** Inset of the RIGHT edge's two corners (TR, BR), independent of the
   * left edge — see perspectiveLeftEdgeFrac. */
  perspectiveRightEdgeFrac: number;
}

/**
 * Order of operations (mirrors geometry.ts's computeDestQuad exactly,
 * with the inset axis swapped — see this module's header):
 *  1. Start from the axis-aligned rect TL=(-w/2,-h/2) TR=(w/2,-h/2)
 *     BR=(w/2,h/2) BL=(-w/2,h/2), sized (tableW, tableH).
 *  2. Perspective: push the LEFT two corners (TL, BL) vertically toward
 *     the horizontal center line by perspectiveLeftEdgeFrac (fraction of
 *     half-height); independently push the RIGHT two corners (TR, BR) by
 *     perspectiveRightEdgeFrac.
 *  3. Translate by (centerXFrac*canvasWidth, centerYFrac*canvasHeight).
 * No rotation step — the broadcast table is always axis-aligned within
 * the frame (only keystoned), unlike a per-card placement.
 *
 * Returns [TL, TR, BR, BL] — same clockwise-from-top-left convention as
 * geometry.ts's computeDestQuad and benchmark/types.ts's Quad.corners.
 */
export function computeTableDestQuad(canvasWidth: number, canvasHeight: number, placement: TableQuadPlacement): [Point, Point, Point, Point] {
  const tableW = placement.tableWidthFrac * canvasWidth;
  const tableH = placement.tableHeightFrac * canvasHeight;
  const halfW = tableW / 2;
  const halfH = tableH / 2;

  const tl: Point = { x: -halfW, y: -halfH + placement.perspectiveLeftEdgeFrac * halfH };
  const bl: Point = { x: -halfW, y: halfH - placement.perspectiveLeftEdgeFrac * halfH };
  const tr: Point = { x: halfW, y: -halfH + placement.perspectiveRightEdgeFrac * halfH };
  const br: Point = { x: halfW, y: halfH - placement.perspectiveRightEdgeFrac * halfH };

  const cx = placement.centerXFrac * canvasWidth;
  const cy = placement.centerYFrac * canvasHeight;
  const translate = (p: Point): Point => ({ x: p.x + cx, y: p.y + cy });

  return [translate(tl), translate(tr), translate(br), translate(bl)];
}

/**
 * Transforms every label's corners (already in the source table image's
 * own local pixel space, e.g. mergeBroadcastTableRenders's output) through
 * the homography that maps the table image's native (0,0)-(w,h) rect onto
 * `dstQuad` — the EXACT same (srcRect, dstQuad) pair warpToQuad derives
 * its own pixel-mapping homography from, so a card's label and its
 * rendered pixels can never silently diverge (see this module's header).
 * Everything else on the label (printingId, tags, visibleFraction, region)
 * passes through unchanged — only `corners` move. Never clamps (amodal).
 */
export function transformTableLabelsThroughHomography(
  tableImageWidth: number,
  tableImageHeight: number,
  dstQuad: [Point, Point, Point, Point],
  labels: CompositeCardLabel[],
): CompositeCardLabel[] {
  const srcRect: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: tableImageWidth, y: 0 },
    { x: tableImageWidth, y: tableImageHeight },
    { x: 0, y: tableImageHeight },
  ];
  const H = solveHomography(srcRect, dstQuad);
  return labels.map((label) => ({
    ...label,
    corners: label.corners.map((p) => applyHomography(H, p)) as [Point, Point, Point, Point],
  }));
}
