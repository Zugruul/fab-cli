import { describe, it, expect } from "vitest";
import { solveHomography, applyHomography, invertMat3 } from "../src/composites/homography.js";
import type { Point } from "../src/composites/types.js";

// APP-026: warp.ts needs a TRUE projective (4-point) homography — not an
// affine shear approximation — so that a card's post-transform corners
// (geometry.ts) and its rendered pixels can never silently diverge. These
// tests check round-trip correctness (forward map reproduces the exact
// correspondences given to the solver) rather than hand-deriving matrix
// entries, since that's robust to internal implementation choices.

const SRC: [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function closePoint(actual: Point, expected: Point, precision = 4) {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
}

describe("solveHomography — identity and affine subsets", () => {
  it("solves the identity mapping (src === dst)", () => {
    const H = solveHomography(SRC, SRC);
    for (const p of SRC) closePoint(applyHomography(H, p), p);
  });

  it("solves a pure translation", () => {
    const dst: [Point, Point, Point, Point] = SRC.map((p) => ({ x: p.x + 5, y: p.y + 3 })) as [Point, Point, Point, Point];
    const H = solveHomography(SRC, dst);
    for (let i = 0; i < 4; i++) closePoint(applyHomography(H, SRC[i]), dst[i]);
  });

  it("solves a pure scale", () => {
    const dst: [Point, Point, Point, Point] = SRC.map((p) => ({ x: p.x * 2, y: p.y * 2 })) as [Point, Point, Point, Point];
    const H = solveHomography(SRC, dst);
    for (let i = 0; i < 4; i++) closePoint(applyHomography(H, SRC[i]), dst[i]);
  });

  it("solves a 90-degree rotation", () => {
    // rect rotated 90deg about its own center (5,5)
    const dst: [Point, Point, Point, Point] = [
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    const H = solveHomography(SRC, dst);
    for (let i = 0; i < 4; i++) closePoint(applyHomography(H, SRC[i]), dst[i]);
  });
});

describe("solveHomography — true perspective (non-affine) quads", () => {
  it("solves a trapezoid (top edge narrower than bottom) exactly at the 4 correspondences", () => {
    const dst: [Point, Point, Point, Point] = [
      { x: 2, y: 0 },
      { x: 8, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const H = solveHomography(SRC, dst);
    for (let i = 0; i < 4; i++) closePoint(applyHomography(H, SRC[i]), dst[i]);
  });

  it("solves an asymmetric quad (independent corner displacement, not a shear)", () => {
    const dst: [Point, Point, Point, Point] = [
      { x: 3, y: 1 },
      { x: 9, y: -1 },
      { x: 11, y: 9 },
      { x: -1, y: 11 },
    ];
    const H = solveHomography(SRC, dst);
    for (let i = 0; i < 4; i++) closePoint(applyHomography(H, SRC[i]), dst[i]);

    // a true homography is non-affine here: opposite "sides" are not
    // parallel, which an affine transform could never produce.
    const topVec = { x: dst[1].x - dst[0].x, y: dst[1].y - dst[0].y };
    const bottomVec = { x: dst[2].x - dst[3].x, y: dst[2].y - dst[3].y };
    const cross = topVec.x * bottomVec.y - topVec.y * bottomVec.x;
    expect(Math.abs(cross)).toBeGreaterThan(0.01);
  });

  it("interpolates a midpoint plausibly inside the destination quad (sanity check, not just corners)", () => {
    const dst: [Point, Point, Point, Point] = [
      { x: 2, y: 0 },
      { x: 8, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const H = solveHomography(SRC, dst);
    const center = applyHomography(H, { x: 5, y: 5 });
    expect(center.x).toBeGreaterThan(0);
    expect(center.x).toBeLessThan(10);
    expect(center.y).toBeGreaterThan(0);
    expect(center.y).toBeLessThan(10);
  });
});

describe("invertMat3", () => {
  it("H * invert(H) round-trips dst back to src", () => {
    const dst: [Point, Point, Point, Point] = [
      { x: 3, y: 1 },
      { x: 9, y: -1 },
      { x: 11, y: 9 },
      { x: -1, y: 11 },
    ];
    const H = solveHomography(SRC, dst);
    const Hinv = invertMat3(H);
    for (let i = 0; i < 4; i++) closePoint(applyHomography(Hinv, dst[i]), SRC[i], 3);
  });
});
