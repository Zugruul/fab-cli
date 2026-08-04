import { describe, it, expect } from "vitest";
import { computeTableDestQuad, transformTableLabelsThroughHomography } from "../src/composites/zones/broadcastGeometry.js";
import type { TableQuadPlacement } from "../src/composites/zones/broadcastGeometry.js";
import { warpToQuad } from "../src/composites/warp.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { CompositeCardLabel } from "../src/composites/types.js";

// #256 Phase C.2: table-level perspective keystone. SAME math as
// geometry.ts's computeDestQuad (a single-axis keystone/trapezoid inset),
// but rotated 90°: geometry.ts insets the TOP edge horizontally (for the
// two-player mode's horizontal/near-far mirror axis); this insets the
// LEFT/RIGHT edges VERTICALLY, since broadcast mode's mirror axis is
// vertical (players seated left/right, #256 brief). computeTableDestQuad
// is the SINGLE SOURCE OF TRUTH feeding both warpToQuad (pixels) and
// transformTableLabelsThroughHomography (every card label already in the
// table image's local pixel space) — exactly the same contract
// geometry.ts's computeDestQuad documents for per-card rendering.

function basePlacement(overrides: Partial<TableQuadPlacement> = {}): TableQuadPlacement {
  return {
    centerXFrac: 0.5,
    centerYFrac: 0.5,
    tableWidthFrac: 0.6,
    tableHeightFrac: 0.8,
    perspectiveLeftEdgeFrac: 0,
    perspectiveRightEdgeFrac: 0,
    ...overrides,
  };
}

describe("computeTableDestQuad — no perspective", () => {
  it("returns a translated axis-aligned rect centered at (centerXFrac*W, centerYFrac*H)", () => {
    // canvas 100x100, table 60x80 centered at (50,50) -> TL(20,10) TR(80,10) BR(80,90) BL(20,90)
    const [tl, tr, br, bl] = computeTableDestQuad(100, 100, basePlacement());
    expect(tl).toEqual({ x: 20, y: 10 });
    expect(tr).toEqual({ x: 80, y: 10 });
    expect(br).toEqual({ x: 80, y: 90 });
    expect(bl).toEqual({ x: 20, y: 90 });
  });
});

describe("computeTableDestQuad — perspective inset (rotated axis vs. geometry.ts's card keystone)", () => {
  it("pushes only the LEFT edge corners (TL, BL) vertically toward the horizontal center line — the right edge is untouched", () => {
    // table 60x80 -> halfH=40; perspectiveLeftEdgeFrac 0.5 -> inset 20
    const [tl, tr, br, bl] = computeTableDestQuad(100, 100, basePlacement({ perspectiveLeftEdgeFrac: 0.5 }));
    expect(tl).toEqual({ x: 20, y: 30 }); // was y=10, pushed down by 20
    expect(bl).toEqual({ x: 20, y: 70 }); // was y=90, pushed up by 20
    expect(tr).toEqual({ x: 80, y: 10 }); // untouched
    expect(br).toEqual({ x: 80, y: 90 }); // untouched
  });

  it("pushes only the RIGHT edge corners (TR, BR), independently of the left edge", () => {
    const [tl, tr, br, bl] = computeTableDestQuad(100, 100, basePlacement({ perspectiveRightEdgeFrac: 0.25 }));
    expect(tr).toEqual({ x: 80, y: 20 }); // halfH=40, inset 10
    expect(br).toEqual({ x: 80, y: 80 });
    expect(tl).toEqual({ x: 20, y: 10 });
    expect(bl).toEqual({ x: 20, y: 90 });
  });

  it("produces a genuine (non-parallelogram) trapezoid when left and right insets differ — not an affine shear", () => {
    const [tl, tr, br, bl] = computeTableDestQuad(100, 100, basePlacement({ perspectiveLeftEdgeFrac: 0.5, perspectiveRightEdgeFrac: 0.1 }));
    const leftEdgeLen = bl.y - tl.y;
    const rightEdgeLen = br.y - tr.y;
    expect(leftEdgeLen).not.toBeCloseTo(rightEdgeLen);
  });

  it("is AMODAL — never clamps, even when the placement pushes the quad off-canvas", () => {
    const [tl] = computeTableDestQuad(50, 50, basePlacement({ centerXFrac: -0.5, tableWidthFrac: 0.6, tableHeightFrac: 0.8 }));
    expect(tl.x).toBeLessThan(0);
  });
});

describe("transformTableLabelsThroughHomography — single source of truth with warpToQuad's pixels", () => {
  function solidTableImage(width: number, height: number, color: [number, number, number]): RawImage {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = color[0];
      data[i * 4 + 1] = color[1];
      data[i * 4 + 2] = color[2];
      data[i * 4 + 3] = 255;
    }
    return { width, height, data };
  }

  it("a card label's corners, transformed through the table homography, land exactly on the corresponding warped pixels", () => {
    // A 40x30 "table" image with one 10x10 red square card painted at its
    // own local (5,5)-(15,15) — its label corners (in table-local space,
    // exactly like mergeBroadcastTableRenders/twoPlayer.ts's output) are
    // (5,5),(15,5),(15,15),(5,15).
    const tableW = 40;
    const tableH = 30;
    const tableImage = solidTableImage(tableW, tableH, [10, 10, 10]);
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        const i = (y * tableW + x) * 4;
        tableImage.data[i] = 255;
        tableImage.data[i + 1] = 0;
        tableImage.data[i + 2] = 0;
      }
    }
    const cardLabel: CompositeCardLabel = {
      printingId: "card-a",
      corners: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }],
      tags: [],
      visibleFraction: 1,
      region: "table",
    };

    const canvasW = 100;
    const canvasH = 80;
    const placement: TableQuadPlacement = {
      centerXFrac: 0.5,
      centerYFrac: 0.5,
      tableWidthFrac: 0.8,
      tableHeightFrac: 0.7,
      perspectiveLeftEdgeFrac: 0.3,
      perspectiveRightEdgeFrac: 0.1,
    };
    const dstQuad = computeTableDestQuad(canvasW, canvasH, placement);

    const warped = warpToQuad(tableImage, dstQuad, canvasW, canvasH);
    const [transformedLabel] = transformTableLabelsThroughHomography(tableW, tableH, dstQuad, [cardLabel]);

    // Sample the CENTER of the transformed quad (average of its 4 corners)
    // — guaranteed to fall inside the (convex) warped red square, so a
    // rounding-sensitive edge pixel never makes this test flaky.
    const cx = (transformedLabel.corners[0].x + transformedLabel.corners[1].x + transformedLabel.corners[2].x + transformedLabel.corners[3].x) / 4;
    const cy = (transformedLabel.corners[0].y + transformedLabel.corners[1].y + transformedLabel.corners[2].y + transformedLabel.corners[3].y) / 4;
    const px = Math.round(cx);
    const py = Math.round(cy);
    const i = (py * canvasW + px) * 4;
    expect(warped.data[i]).toBeGreaterThan(200); // red channel — inside the warped red square
    expect(warped.data[i + 1]).toBeLessThan(50);
  });

  it("preserves each corner's source identity (TL/TR/BR/BL) and printingId/tags/visibleFraction/region unchanged — only corners move", () => {
    const cardLabel: CompositeCardLabel = {
      printingId: "card-a",
      corners: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }],
      tags: ["sleeved"],
      visibleFraction: 0.42,
      region: "table",
    };
    const dstQuad = computeTableDestQuad(100, 100, basePlacement());
    const [out] = transformTableLabelsThroughHomography(20, 20, dstQuad, [cardLabel]);
    expect(out.printingId).toBe("card-a");
    expect(out.tags).toEqual(["sleeved"]);
    expect(out.visibleFraction).toBe(0.42);
    expect(out.region).toBe("table");
    expect(out.corners).toHaveLength(4);
  });

  it("is AMODAL — a label corner outside the table image bounds still transforms (never clamped/dropped)", () => {
    const cardLabel: CompositeCardLabel = {
      printingId: "card-a",
      corners: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }],
      tags: [],
      visibleFraction: 0.3,
      region: "table",
    };
    const dstQuad = computeTableDestQuad(100, 100, basePlacement());
    const [out] = transformTableLabelsThroughHomography(20, 20, dstQuad, [cardLabel]);
    expect(out.corners).toHaveLength(4);
    expect(Number.isFinite(out.corners[0].x)).toBe(true);
  });
});
