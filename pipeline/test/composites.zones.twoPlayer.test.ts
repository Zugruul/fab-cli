import { describe, it, expect } from "vitest";
import { rotate180RawImage, stackVertically, rotateQuad180AboutMat, translateQuad, mergeTwoPlayerRenders } from "../src/composites/zones/twoPlayer.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { RenderResult } from "../src/composites/compositor.js";

function img(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

describe("rotate180RawImage", () => {
  it("maps pixel (0,0) to (w-1,h-1) and vice versa — a pixel-exact 180 rotation, not a re-render", () => {
    const source = img(3, 2, (x, y) => [x * 10 + y, 0, 0, 255]);
    const rotated = rotate180RawImage(source);
    expect(rotated.width).toBe(3);
    expect(rotated.height).toBe(2);
    // original (0,0) had value 0 -> should now be at (2,1) (last pixel)
    const lastIdx = ((2 * 3 - 1) * 4) as number; // (w*h-1)*4
    expect(rotated.data[lastIdx]).toBe(0);
    // original (2,1) (last pixel, value 2*10+1=21) -> should now be at (0,0)
    expect(rotated.data[0]).toBe(21);
  });

  it("rotating twice returns the original image", () => {
    const source = img(4, 3, (x, y) => [x * 5, y * 7, x + y, 200]);
    const twice = rotate180RawImage(rotate180RawImage(source));
    expect(Array.from(twice.data)).toEqual(Array.from(source.data));
  });
});

describe("stackVertically", () => {
  it("places `top` in the upper half and `bottom` in the lower half of the resulting canvas", () => {
    const top = img(2, 1, () => [1, 1, 1, 255]);
    const bottom = img(2, 1, () => [9, 9, 9, 255]);
    const stacked = stackVertically(top, bottom);
    expect(stacked.width).toBe(2);
    expect(stacked.height).toBe(2);
    expect(stacked.data[0]).toBe(1); // top-left, from `top`
    expect(stacked.data[(1 * 2 + 0) * 4]).toBe(9); // row 1 (bottom), from `bottom`
  });

  it("throws when the two images have mismatched widths", () => {
    const top = img(2, 1, () => [0, 0, 0, 255]);
    const bottom = img(3, 1, () => [0, 0, 0, 255]);
    expect(() => stackVertically(top, bottom)).toThrow(/width/);
  });
});

describe("rotateQuad180AboutMat — 180-rotation quad correctness, pinned exact corners for a known zone", () => {
  it("maps a known non-centered rect's corners under a 180 rotation about the mat's own center", () => {
    // mat 100x60; a card quad at TL=(10,10) TR=(30,10) BR=(30,20) BL=(10,20)
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 20 },
      { x: 10, y: 20 },
    ];
    const rotated = rotateQuad180AboutMat(corners, 100, 60);
    // (x,y) -> (matWidth - x, matHeight - y); tuple ORDER preserved (source
    // corner identity, matching geometry.ts's own rotation convention).
    expect(rotated[0]).toEqual({ x: 90, y: 50 });
    expect(rotated[1]).toEqual({ x: 70, y: 50 });
    expect(rotated[2]).toEqual({ x: 70, y: 40 });
    expect(rotated[3]).toEqual({ x: 90, y: 40 });
  });

  it("a point exactly at the mat's own center is a fixed point of the rotation", () => {
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 50, y: 30 },
      { x: 50, y: 30 },
      { x: 50, y: 30 },
      { x: 50, y: 30 },
    ];
    const rotated = rotateQuad180AboutMat(corners, 100, 60);
    for (const p of rotated) expect(p).toEqual({ x: 50, y: 30 });
  });

  it("preserves amodal (off-mat / negative) coordinates without clamping, consistent with geometry.ts's amodal convention", () => {
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ];
    const rotated = rotateQuad180AboutMat(corners, 100, 60);
    expect(rotated[0]).toEqual({ x: 105, y: 65 });
  });
});

describe("translateQuad", () => {
  it("shifts every corner by (dx, dy), preserving order", () => {
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const translated = translateQuad(corners, 5, 100);
    expect(translated).toEqual([
      { x: 5, y: 100 },
      { x: 15, y: 100 },
      { x: 15, y: 110 },
      { x: 5, y: 110 },
    ]);
  });
});

function renderResult(overrides: Partial<RenderResult> = {}): RenderResult {
  return {
    image: img(20, 10, () => [0, 0, 0, 255]),
    label: {
      compositeId: "mat",
      fileName: "mat.png",
      width: 20,
      height: 10,
      backgroundType: "external",
      backgroundHash: "hash123",
      cards: [],
      excludedCards: 0,
      cardBacksPlaced: 0,
    },
    ...overrides,
  } as RenderResult;
}

describe("mergeTwoPlayerRenders — labels on both sides (test-knob intersection: two-player x labels)", () => {
  it("near mat's cards are translated down by matHeight; far mat's cards are 180-rotated about the mat center, not translated in x", () => {
    const near = renderResult({
      label: {
        compositeId: "near",
        fileName: "near.png",
        width: 20,
        height: 10,
        backgroundType: "external",
        backgroundHash: "hash123",
        cards: [{ printingId: "near-card", corners: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }], tags: [], visibleFraction: 1, region: "table" }],
        excludedCards: 0,
        cardBacksPlaced: 0,
      },
    });
    const far = renderResult({
      label: {
        compositeId: "far",
        fileName: "far.png",
        width: 20,
        height: 10,
        backgroundType: "external",
        backgroundHash: "hash123",
        cards: [{ printingId: "far-card", corners: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }], tags: [], visibleFraction: 1, region: "table" }],
        excludedCards: 0,
        cardBacksPlaced: 0,
      },
    });

    const merged = mergeTwoPlayerRenders(near, far, "two-player-0000");
    expect(merged.image.width).toBe(20);
    expect(merged.image.height).toBe(20);
    expect(merged.label.width).toBe(20);
    expect(merged.label.height).toBe(20);
    expect(merged.label.compositeId).toBe("two-player-0000");

    const nearCard = merged.label.cards.find((c) => c.printingId === "near-card")!;
    expect(nearCard.corners).toEqual([{ x: 1, y: 11 }, { x: 5, y: 11 }, { x: 5, y: 15 }, { x: 1, y: 15 }]);

    const farCard = merged.label.cards.find((c) => c.printingId === "far-card")!;
    // (x,y) -> (20-x, 10-y): (1,1)->(19,9), (5,1)->(15,9), (5,5)->(15,5), (1,5)->(19,5)
    expect(farCard.corners).toEqual([{ x: 19, y: 9 }, { x: 15, y: 9 }, { x: 15, y: 5 }, { x: 19, y: 5 }]);
  });

  it("sums excludedCards and cardBacksPlaced across both mats", () => {
    const near = renderResult({ label: { ...renderResult().label, excludedCards: 2, cardBacksPlaced: 1 } });
    const far = renderResult({ label: { ...renderResult().label, excludedCards: 3, cardBacksPlaced: 1 } });
    const merged = mergeTwoPlayerRenders(near, far, "two-player-0000");
    expect(merged.label.excludedCards).toBe(5);
    expect(merged.label.cardBacksPlaced).toBe(2);
  });

  it("throws when the two mat images have mismatched dimensions", () => {
    const near = renderResult();
    const far = renderResult({ image: img(10, 10, () => [0, 0, 0, 255]) });
    expect(() => mergeTwoPlayerRenders(near, far, "x")).toThrow();
  });
});
