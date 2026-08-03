import { describe, it, expect } from "vitest";
import { computeDestQuad } from "../src/composites/geometry.js";
import type { QuadPlacement } from "../src/composites/geometry.js";

// APP-026: computeDestQuad is the single source of truth for a pasted
// card's post-transform corners — both the emitted ground-truth label AND
// the pixel-warp target are the exact same array (see geometry.ts header).
// These tests hand-verify the math directly, independent of any RNG/config
// wiring — pure, calculable-by-hand expected values.

function basePlacement(overrides: Partial<QuadPlacement> = {}): QuadPlacement {
  return {
    centerXFrac: 0.5,
    centerYFrac: 0.5,
    rotationDeg: 0,
    cardHeightFrac: 0.2,
    perspectiveLeftFrac: 0,
    perspectiveRightFrac: 0,
    ...overrides,
  };
}

describe("computeDestQuad — no rotation, no perspective", () => {
  it("returns a translated axis-aligned rect centered at (centerXFrac*W, centerYFrac*H)", () => {
    // canvas 100x100, aspectRatio 1, cardHeightFrac 0.2 -> card is 20x20,
    // centered at (50,50) -> TL(40,40) TR(60,40) BR(60,60) BL(40,60)
    const [tl, tr, br, bl] = computeDestQuad(100, 100, 1, basePlacement());
    expect(tl.x).toBeCloseTo(40);
    expect(tl.y).toBeCloseTo(40);
    expect(tr.x).toBeCloseTo(60);
    expect(tr.y).toBeCloseTo(40);
    expect(br.x).toBeCloseTo(60);
    expect(br.y).toBeCloseTo(60);
    expect(bl.x).toBeCloseTo(40);
    expect(bl.y).toBeCloseTo(60);
  });

  it("respects aspect ratio (non-square card)", () => {
    // aspectRatio 0.5 -> cardH=20, cardW=10 -> half extents (5,10)
    const [tl, tr, br, bl] = computeDestQuad(100, 100, 0.5, basePlacement());
    expect(tl.x).toBeCloseTo(45);
    expect(tr.x).toBeCloseTo(55);
    expect(br.x).toBeCloseTo(55);
    expect(bl.x).toBeCloseTo(45);
    expect(tl.y).toBeCloseTo(40);
    expect(bl.y).toBeCloseTo(60);
  });

  it("moves with centerXFrac/centerYFrac", () => {
    const [tl] = computeDestQuad(200, 100, 1, basePlacement({ centerXFrac: 0.25, centerYFrac: 0.75 }));
    // center at (50, 75), card 20x20 (cardHeightFrac 0.2 of height=100) -> TL (40,65)
    expect(tl.x).toBeCloseTo(40);
    expect(tl.y).toBeCloseTo(65);
  });
});

describe("computeDestQuad — perspective inset", () => {
  it("pushes only the top-left corner inward by perspectiveLeftFrac * halfWidth", () => {
    const [tl, tr] = computeDestQuad(100, 100, 1, basePlacement({ perspectiveLeftFrac: 0.5 }));
    // halfW=10; TL.x = 40 + 0.5*10 = 45 (unrotated origin at 40, pushed right/inward)
    expect(tl.x).toBeCloseTo(45);
    expect(tl.y).toBeCloseTo(40);
    expect(tr.x).toBeCloseTo(60); // untouched
  });

  it("pushes only the top-right corner inward by perspectiveRightFrac * halfWidth", () => {
    const [tl, tr] = computeDestQuad(100, 100, 1, basePlacement({ perspectiveRightFrac: 0.5 }));
    expect(tl.x).toBeCloseTo(40); // untouched
    expect(tr.x).toBeCloseTo(55); // 60 - 0.5*10
  });

  it("leaves the bottom corners untouched regardless of perspective insets", () => {
    const [, , br, bl] = computeDestQuad(100, 100, 1, basePlacement({ perspectiveLeftFrac: 0.6, perspectiveRightFrac: 0.6 }));
    expect(br.x).toBeCloseTo(60);
    expect(bl.x).toBeCloseTo(40);
  });

  it("produces a genuinely non-rectangular quad (top edge shorter than bottom) when insets differ from zero", () => {
    const [tl, tr, br, bl] = computeDestQuad(100, 100, 1, basePlacement({ perspectiveLeftFrac: 0.3, perspectiveRightFrac: 0.3 }));
    const topWidth = tr.x - tl.x;
    const bottomWidth = br.x - bl.x;
    expect(topWidth).toBeLessThan(bottomWidth);
  });
});

describe("computeDestQuad — rotation", () => {
  it("90 degrees maps the source top-left corner to the source top-right corner's former position", () => {
    const unrotated = computeDestQuad(100, 100, 1, basePlacement());
    const rotated = computeDestQuad(100, 100, 1, basePlacement({ rotationDeg: 90 }));
    // rotated[0] (still "the TL source corner", now moved) should land where
    // unrotated[1] (TR) used to be, since rotating a rigid rect 90 degrees
    // clockwise carries each corner into the next corner's old slot.
    expect(rotated[0].x).toBeCloseTo(unrotated[1].x, 5);
    expect(rotated[0].y).toBeCloseTo(unrotated[1].y, 5);
  });

  it("360 degrees is the identity (up to floating point)", () => {
    const base = computeDestQuad(100, 100, 1, basePlacement());
    const full = computeDestQuad(100, 100, 1, basePlacement({ rotationDeg: 360 }));
    for (let i = 0; i < 4; i++) {
      expect(full[i].x).toBeCloseTo(base[i].x, 5);
      expect(full[i].y).toBeCloseTo(base[i].y, 5);
    }
  });

  it("preserves corner ordering (always returns exactly 4 points) under combined rotation + perspective", () => {
    const quad = computeDestQuad(150, 220, 0.72, basePlacement({ rotationDeg: 37, perspectiveLeftFrac: 0.2, perspectiveRightFrac: 0.05, centerXFrac: 0.4, centerYFrac: 0.6 }));
    expect(quad).toHaveLength(4);
    for (const p of quad) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
