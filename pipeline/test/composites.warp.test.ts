import { describe, it, expect } from "vitest";
import { warpToQuad, countCardFootprintPixels } from "../src/composites/warp.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { Point } from "../src/composites/types.js";

function pixel(img: RawImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/** 10x10 source: red everywhere except a 2x2 blue square at the top-left
 * corner (source pixels (0,0),(1,0),(0,1),(1,1)). */
function makeMarkedSource(): RawImage {
  const width = 10;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBlue = x < 2 && y < 2;
      const i = (y * width + x) * 4;
      if (isBlue) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 255;
      } else {
        data[i] = 255;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("warpToQuad — pure translation (identity homography)", () => {
  const source = makeMarkedSource();
  // dstQuad = source rect translated by (20,20) on a 50x50 canvas — no
  // rotation/perspective, so this is a straightforward correspondence test.
  const dstQuad: [Point, Point, Point, Point] = [
    { x: 20, y: 20 },
    { x: 30, y: 20 },
    { x: 30, y: 30 },
    { x: 20, y: 30 },
  ];

  it("places the source's marked (blue) corner at the corresponding destination location", () => {
    const out = warpToQuad(source, dstQuad, 50, 50);
    expect(out.width).toBe(50);
    expect(out.height).toBe(50);
    // dest pixel (20,20) samples source pixel-center (0.5,0.5) — inside the blue mark.
    expect(pixel(out, 20, 20)).toEqual([0, 0, 255, 255]);
  });

  it("is red (unmarked source region) away from the marked corner", () => {
    const out = warpToQuad(source, dstQuad, 50, 50);
    // dest pixel (29,29) samples source pixel-center (9.5,9.5) — far from the mark.
    expect(pixel(out, 29, 29)).toEqual([255, 0, 0, 255]);
  });

  it("leaves everything outside the destination quad's bounding box fully transparent", () => {
    const out = warpToQuad(source, dstQuad, 50, 50);
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, 49, 49)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, 35, 20)).toEqual([0, 0, 0, 0]); // just right of the 20-30 box
  });
});

describe("warpToQuad — scaled quad", () => {
  it("samples a larger destination region by stretching the source (nearest interior pixel still matches expected corner)", () => {
    const source = makeMarkedSource();
    // scale source 10x10 up to a 20x20 destination box at (5,5)-(25,25)
    const dstQuad: [Point, Point, Point, Point] = [
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 25 },
      { x: 5, y: 25 },
    ];
    const out = warpToQuad(source, dstQuad, 40, 40);
    // dest pixel (5,5) -> source pixel-center maps to (0.25, 0.25) — inside blue mark.
    expect(pixel(out, 5, 5)).toEqual([0, 0, 255, 255]);
    // dest pixel (24,24) -> source maps near (9.75, 9.75) — red region.
    expect(pixel(out, 24, 24)).toEqual([255, 0, 0, 255]);
  });
});

describe("warpToQuad — degenerate/perspective quad does not crash and stays bounded", () => {
  it("produces a canvas-sized image with only finite, in-range pixel values for a trapezoid quad", () => {
    const source = makeMarkedSource();
    const dstQuad: [Point, Point, Point, Point] = [
      { x: 12, y: 10 },
      { x: 28, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ];
    const out = warpToQuad(source, dstQuad, 40, 40);
    expect(out.width).toBe(40);
    expect(out.height).toBe(40);
    for (const v of out.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

// #252: countCardFootprintPixels is visibleFraction's DENOMINATOR — the
// card's own full, un-clamped, un-occluded pixel count, computed with the
// exact same homography + bilinearSample sampling as warpToQuad's real
// paint loop (just without clamping the iterated bbox to any canvas). See
// composites/types.ts's CompositeCardLabel doc for the full definition.
describe("countCardFootprintPixels — visibleFraction's denominator (#252)", () => {
  it("counts exactly the source's own pixel count for an axis-aligned, unrotated, unscaled quad", () => {
    const source = makeMarkedSource(); // 10x10, fully opaque
    const dstQuad: [Point, Point, Point, Point] = [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
    ];
    expect(countCardFootprintPixels(source, dstQuad)).toBe(100);
  });

  it("matches warpToQuad's actual painted alpha>0 pixel count exactly, for a card fully on-canvas and unoccluded (#252: guarantees visibleFraction resolves to exactly 1.0, not merely close, for the common unoccluded case)", () => {
    const source = makeMarkedSource();
    const dstQuad: [Point, Point, Point, Point] = [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
    ];
    const painted = warpToQuad(source, dstQuad, 50, 50);
    let paintedCount = 0;
    for (let i = 3; i < painted.data.length; i += 4) {
      if (painted.data[i] > 0) paintedCount++;
    }
    expect(countCardFootprintPixels(source, dstQuad)).toBe(paintedCount);
  });

  it("counts the FULL card footprint even when the quad sits entirely outside any real canvas bounds — this function has no canvas parameter at all, by design (#252: the un-clamped denominator)", () => {
    const source = makeMarkedSource();
    const onscreenQuad: [Point, Point, Point, Point] = [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
    ];
    const farOffscreenQuad: [Point, Point, Point, Point] = [
      { x: -2000, y: -2000 },
      { x: -1990, y: -2000 },
      { x: -1990, y: -1990 },
      { x: -2000, y: -1990 },
    ];
    expect(countCardFootprintPixels(source, farOffscreenQuad)).toBe(countCardFootprintPixels(source, onscreenQuad));
  });

  it("counts fewer pixels than the full bounding-box area when the source image itself has a transparent region — footprint reflects the source's real alpha, not bare bounding-box area (bilinear blending at the transparent/opaque boundary means this is a bound, not an exact subtraction — the exactness guarantee for a uniform-alpha source is the 'matches warpToQuad's actual painted count' test above)", () => {
    const width = 10;
    const height = 10;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const transparent = x < 3 && y < 3; // a 3x3 fully-transparent corner
        data[i + 3] = transparent ? 0 : 255;
      }
    }
    const source: RawImage = { width, height, data };
    const dstQuad: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const count = countCardFootprintPixels(source, dstQuad);
    expect(count).toBeLessThan(100);
    expect(count).toBeGreaterThan(80);
  });
});
