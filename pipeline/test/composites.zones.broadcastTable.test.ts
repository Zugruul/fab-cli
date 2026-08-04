import { describe, it, expect } from "vitest";
import { stackHorizontally, mergeBroadcastTableRenders, cropTopRawImage } from "../src/composites/zones/twoPlayer.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { RenderResult } from "../src/composites/compositor.js";
import type { CompositeCardLabel } from "../src/composites/types.js";

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
  // CORRECTED 2026-08-04 (human-reported squish): each mat is rotated a
  // QUARTER TURN before stacking (left cw, right ccw), so a 20x10 landscape
  // mat becomes 10x20 portrait and the pair is 20x20 — not the 40x10 this
  // test previously asserted. That old expectation encoded the bug: two
  // unrotated landscape mats produced an over-wide canvas that could only be
  // fitted into the play-area rect by squashing it, which is what drove every
  // table card's label aspect to 0.259 instead of 63/88 = 0.716. cw/ccw keeps
  // the players facing each other (ccw === cw + 180°).
  // See composites.zones.broadcastTableRotation.test.ts for the full lock.
  it("each mat is quarter-turned before stacking: left cw, right ccw-then-translated by the rotated half width", () => {
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
    // Each 20x10 mat becomes 10x20 after its quarter turn; two side by side
    // is 20 wide x 20 tall.
    expect(merged.image.width).toBe(20);
    expect(merged.image.height).toBe(20);
    expect(merged.label.width).toBe(20);
    expect(merged.label.height).toBe(20);
    expect(merged.label.compositeId).toBe("broadcast-table-0000");

    const leftCard = merged.label.cards.find((c) => c.printingId === "left-card")!;
    // cw about a 20x10 mat: (x,y) -> (matHeight - y, x) = (10-y, x)
    // (1,1)->(9,1); (5,1)->(9,5); (5,5)->(5,5); (1,5)->(5,1)
    expect(leftCard.corners).toEqual([{ x: 9, y: 1 }, { x: 9, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 1 }]);

    const rightCard = merged.label.cards.find((c) => c.printingId === "right-card")!;
    // ccw about a 20x10 mat: (x,y) -> (y, matWidth - x) = (y, 20-x),
    // THEN translate by the rotated half width (+10, 0):
    // (1,1)->(1,19)->(11,19); (5,1)->(1,15)->(11,15); (5,5)->(5,15)->(15,15); (1,5)->(5,19)->(15,19)
    expect(rightCard.corners).toEqual([{ x: 11, y: 19 }, { x: 11, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 19 }]);
  });

  it("preserves each card's edge lengths — a quarter turn is rigid, so no squish is possible", () => {
    // The regression this whole correction exists for: a 4x4 card in mat
    // space must still measure 4x4 after merging. Under the old unrotated
    // stack the canvas was over-wide and downstream fitting squashed cards to
    // ~0.26 of their true aspect.
    const card = {
      printingId: "c",
      corners: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }],
      tags: [],
      visibleFraction: 1,
      region: "table",
    } as unknown as CompositeCardLabel;
    const left = renderResult({ label: { ...renderResult().label, cards: [card] } });
    const right = renderResult({ label: { ...renderResult().label, cards: [{ ...card, printingId: "c2" }] } });
    const merged = mergeBroadcastTableRenders(left, right, "x");
    const side = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    for (const c of merged.label.cards) {
      const q = c.corners;
      expect((side(q[0], q[1]) + side(q[3], q[2])) / 2).toBeCloseTo(4, 6);
      expect((side(q[1], q[2]) + side(q[0], q[3])) / 2).toBeCloseTo(4, 6);
    }
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

// #256 correction (human-upgraded to blocking): the render showed TWO
// separate mats butted together — visible as two back-to-back "COMBAT
// CHAIN" decorative-banner strips down the middle, because EACH mat's own
// top-edge banner lands right at the seam after the quarter-turn (cw maps
// original y=0 to the rotated image's RIGHTMOST column = inner/seam edge
// for the left mat; ccw maps original y=0 to the LEFTMOST column = inner/
// seam edge for the right mat — both mats' banners end up adjacent).
// Fix: crop each mat's own decorative top band BEFORE rotating (equivalent,
// by the same coordinate map, to cropping the rotated image's inner-edge
// columns — cropping pre-rotation is simpler since it's a single axis-
// aligned strip, and every remaining card quad only needs a uniform
// upward shift, not a rotated-frame clip). This is safe (never clips a
// REAL card) only because the crop depth is provably below the shallowest
// any card can ever reach — see composites.zones.broadcastTableRotation
// or the dedicated "banner crop is provably below every card's reach"
// test guarding this bound against future config drift.
describe("cropTopRawImage", () => {
  it("removes exactly the top N rows, shifting everything else up by N", () => {
    const source = img(3, 5, (x, y) => [y, 0, 0, 255]); // row y has R=y
    const cropped = cropTopRawImage(source, 2);
    expect(cropped.width).toBe(3);
    expect(cropped.height).toBe(3);
    // new row 0 == old row 2, new row 2 == old row 4
    expect(cropped.data[(0 * 3 + 0) * 4]).toBe(2);
    expect(cropped.data[(2 * 3 + 0) * 4]).toBe(4);
  });

  it("cropPx=0 is a byte-identical no-op", () => {
    const source = img(4, 4, (x, y) => [x, y, 1, 255]);
    const cropped = cropTopRawImage(source, 0);
    expect(Array.from(cropped.data)).toEqual(Array.from(source.data));
  });

  it("throws on a crop depth that would remove the entire image (or more)", () => {
    const source = img(3, 5, () => [0, 0, 0, 255]);
    expect(() => cropTopRawImage(source, 5)).toThrow();
    expect(() => cropTopRawImage(source, 6)).toThrow();
  });
});

describe("mergeBroadcastTableRenders — topCropFrac removes the duplicate-banner seam (#256 correction)", () => {
  const BANNER: [number, number, number] = [200, 180, 50];
  const TABLE: [number, number, number] = [20, 100, 120];

  // A synthetic mat with a distinct "banner" color for its top 4 of 20 rows
  // (matching the real reference playmat's decorative COMBAT CHAIN header)
  // and a distinct "table" color everywhere else.
  function matWithBanner(bannerRows: number, width: number, height: number): RawImage {
    return img(width, height, (_x, y) => (y < bannerRows ? [...BANNER, 255] : [...TABLE, 255]));
  }

  function hasColor(image: RawImage, [r, g, b]: [number, number, number]): boolean {
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i] === r && image.data[i + 1] === g && image.data[i + 2] === b) return true;
    }
    return false;
  }

  it("WITHOUT a crop (topCropFrac=0, pre-correction default), the banner color survives into the merged table — reproducing the reported bug", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const right = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const merged = mergeBroadcastTableRenders(left, right, "x", 0);
    expect(hasColor(merged.image, BANNER)).toBe(true);
  });

  it("WITH topCropFrac covering the banner rows, the banner color is fully gone from the merged table", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const right = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const merged = mergeBroadcastTableRenders(left, right, "x", 4 / 20);
    expect(hasColor(merged.image, BANNER)).toBe(false);
    // every remaining pixel is the table color (or fully transparent black
    // from stackHorizontally's own canvas init — never the case here since
    // every source pixel is opaque table/banner color).
    expect(hasColor(merged.image, TABLE)).toBe(true);
  });

  it("shrinks the merged canvas width by 2*cropPx (each mat loses cropPx from its rotated width) and leaves height unchanged", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20) });
    const right = renderResult({ image: matWithBanner(4, 20, 20) });
    const uncropped = mergeBroadcastTableRenders(left, right, "x", 0);
    const cropped = mergeBroadcastTableRenders(left, right, "x", 4 / 20);
    expect(uncropped.image.width).toBe(40); // 2 * matHeight(20)
    expect(cropped.image.width).toBe(32); // 2 * (matHeight(20) - cropPx(4))
    expect(cropped.image.height).toBe(uncropped.image.height); // matWidth unaffected
    expect(cropped.label.width).toBe(32);
    expect(cropped.label.height).toBe(uncropped.label.height);
  });

  it("shifts every card quad by the SAME crop amount applied to the pixels, then rotates — a card untouched by the crop keeps its true post-rotation position", () => {
    const card: CompositeCardLabel = {
      printingId: "c",
      corners: [{ x: 1, y: 8 }, { x: 5, y: 8 }, { x: 5, y: 12 }, { x: 1, y: 12 }],
      tags: [],
      visibleFraction: 1,
      region: "table",
    };
    const left = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [card] } });
    const right = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const merged = mergeBroadcastTableRenders(left, right, "x", 4 / 20);
    // Pre-crop this card would rotate (cw about a 20x20... wait mat is
    // matWidth=20,matHeight=20 here) via rotateQuad90AboutMat(matWidth=20,
    // matHeight=16 (cropped)): turn(x,y) = (16 - (y-4), x) — the SAME
    // uniform upward shift (y -> y-4) applied before the existing cw turn.
    // (1,8)->y'=4->(12,1); (5,8)->y'=4->(12,5); (5,12)->y'=8->(8,5); (1,12)->y'=8->(8,1)
    const found = merged.label.cards.find((c) => c.printingId === "c")!;
    expect(found.corners).toEqual([{ x: 12, y: 1 }, { x: 12, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 1 }]);
  });

  it("topCropFrac=0 is byte-identical to the pre-correction signature (no behavior change for existing callers)", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20) });
    const right = renderResult({ image: matWithBanner(4, 20, 20) });
    const withDefault = mergeBroadcastTableRenders(left, right, "x");
    const withExplicitZero = mergeBroadcastTableRenders(left, right, "x", 0);
    expect(Array.from(withDefault.image.data)).toEqual(Array.from(withExplicitZero.image.data));
    expect(withDefault.label).toEqual(withExplicitZero.label);
  });
});
