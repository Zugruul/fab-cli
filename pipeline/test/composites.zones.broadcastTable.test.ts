import { describe, it, expect } from "vitest";
import { stackHorizontally, mergeBroadcastTableRenders } from "../src/composites/zones/twoPlayer.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { RenderResult } from "../src/composites/compositor.js";

// #256 Phase C.1: landscape table, VERTICAL mirror axis — 90° off
// `--mode two-player`'s horizontal (near/far, top/bottom) mirror axis.
// Reuses twoPlayer.ts's rotate180RawImage/rotateQuad180AboutMat/
// translateQuad UNCHANGED (a 180° rotation about a mat's own center is the
// same operation regardless of which axis the two mats are arranged
// along) — only a NEW stackHorizontally (the left/right analog of
// stackVertically) and mergeBroadcastTableRenders (the left/right analog
// of mergeTwoPlayerRenders) are added. Left player becomes the LEFT half
// (upright, no translation needed — it already occupies x in
// [0,matWidth)); right player becomes the RIGHT half (rotated 180° about
// its own mat center, then translated by matWidth in x, 0 in y) — mirrors
// mergeTwoPlayerRenders's near=untouched-then-shifted /
// far=rotated-then-unshifted split, just with the shift axis swapped.

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

describe("stackHorizontally", () => {
  it("places `left` in the left half and `right` in the right half of the resulting canvas", () => {
    const left = img(2, 3, () => [1, 1, 1, 255]);
    const right = img(2, 3, () => [9, 9, 9, 255]);
    const stacked = stackHorizontally(left, right);
    expect(stacked.width).toBe(4);
    expect(stacked.height).toBe(3);
    // row 1, column 0 (left half) -> from `left`
    expect(stacked.data[(1 * 4 + 0) * 4]).toBe(1);
    // row 1, column 2 (right half) -> from `right`
    expect(stacked.data[(1 * 4 + 2) * 4]).toBe(9);
  });

  it("throws when the two images have mismatched heights", () => {
    const left = img(2, 3, () => [0, 0, 0, 255]);
    const right = img(2, 5, () => [0, 0, 0, 255]);
    expect(() => stackHorizontally(left, right)).toThrow(/height/);
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

describe("mergeBroadcastTableRenders — left/right labels (landscape, vertical mirror axis)", () => {
  it("left mat's cards are untouched in x, translated by 0 in x/y; right mat's cards are 180-rotated about the mat center, then translated by matWidth in x", () => {
    const left = renderResult({
      label: {
        ...renderResult().label,
        compositeId: "left",
        cards: [{ printingId: "left-card", corners: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }], tags: [], visibleFraction: 1, region: "table" }],
      },
    });
    const right = renderResult({
      label: {
        ...renderResult().label,
        compositeId: "right",
        cards: [{ printingId: "right-card", corners: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }], tags: [], visibleFraction: 1, region: "table" }],
      },
    });

    const merged = mergeBroadcastTableRenders(left, right, "broadcast-table-0000");
    expect(merged.image.width).toBe(40); // 20+20, landscape (wider than tall)
    expect(merged.image.height).toBe(10);
    expect(merged.label.width).toBe(40);
    expect(merged.label.height).toBe(10);
    expect(merged.label.compositeId).toBe("broadcast-table-0000");

    const leftCard = merged.label.cards.find((c) => c.printingId === "left-card")!;
    expect(leftCard.corners).toEqual([{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }]); // untouched

    const rightCard = merged.label.cards.find((c) => c.printingId === "right-card")!;
    // rotate180AboutMat(20,10): (x,y)->(20-x,10-y), THEN translate by (+20,0):
    // (1,1)->(19,9)->(39,9); (5,1)->(15,9)->(35,9); (5,5)->(15,5)->(35,5); (1,5)->(19,5)->(39,5)
    expect(rightCard.corners).toEqual([{ x: 39, y: 9 }, { x: 35, y: 9 }, { x: 35, y: 5 }, { x: 39, y: 5 }]);
  });

  it("sums excludedCards and cardBacksPlaced across both mats", () => {
    const left = renderResult({ label: { ...renderResult().label, excludedCards: 2, cardBacksPlaced: 1 } });
    const right = renderResult({ label: { ...renderResult().label, excludedCards: 3, cardBacksPlaced: 1 } });
    const merged = mergeBroadcastTableRenders(left, right, "broadcast-table-0000");
    expect(merged.label.excludedCards).toBe(5);
    expect(merged.label.cardBacksPlaced).toBe(2);
  });

  it("throws when the two mat images have mismatched dimensions", () => {
    const left = renderResult();
    const right = renderResult({ image: img(10, 10, () => [0, 0, 0, 255]) });
    expect(() => mergeBroadcastTableRenders(left, right, "x")).toThrow();
  });
});
