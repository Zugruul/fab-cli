import { describe, it, expect } from "vitest";
import { stackHorizontally, mergeBroadcastTableRenders, blankTopBandRawImage } from "../src/composites/zones/twoPlayer.js";
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
//
// First attempt at a fix (superseded, see git history): crop each mat's
// top band before rotating. That shrank matHeight, which changes the
// merged table's own aspect ratio (2*matHeight/matWidth) — a real-run
// re-measurement caught it reintroducing a smaller version of the EXACT
// squish #256's original geometry fix eliminated (table card aspect mean
// dropped 0.672 -> 0.577 against a real card's 0.716). Corrected fix:
// OVERPAINT the band in place (blankTopBandRawImage) instead of removing
// it — dimensions never change, so no aspect side effect and no card-quad
// shift is needed at all (nothing moved, only recolored). Safe (never
// overpaints a REAL card) only because the band depth is provably below
// the shallowest any card can ever reach — see
// composites.zones.broadcastTableTopCropSafety.test.ts.
describe("blankTopBandRawImage", () => {
  it("overwrites the top N rows with a copy of row N, leaving row N and below untouched", () => {
    const source = img(3, 5, (x, y) => [y, 0, 0, 255]); // row y has R=y
    const blanked = blankTopBandRawImage(source, 2);
    expect(blanked.width).toBe(3);
    expect(blanked.height).toBe(5); // dimensions UNCHANGED (this is the point)
    // rows 0 and 1 now read as row 2's content (R=2); rows 2-4 untouched.
    expect(blanked.data[(0 * 3 + 0) * 4]).toBe(2);
    expect(blanked.data[(1 * 3 + 0) * 4]).toBe(2);
    expect(blanked.data[(2 * 3 + 0) * 4]).toBe(2);
    expect(blanked.data[(3 * 3 + 0) * 4]).toBe(3);
    expect(blanked.data[(4 * 3 + 0) * 4]).toBe(4);
  });

  it("bandPx=0 is a byte-identical no-op", () => {
    const source = img(4, 4, (x, y) => [x, y, 1, 255]);
    const blanked = blankTopBandRawImage(source, 0);
    expect(Array.from(blanked.data)).toEqual(Array.from(source.data));
  });

  it("throws on a band depth that would cover the entire image (or more)", () => {
    const source = img(3, 5, () => [0, 0, 0, 255]);
    expect(() => blankTopBandRawImage(source, 5)).toThrow();
    expect(() => blankTopBandRawImage(source, 6)).toThrow();
  });
});

describe("mergeBroadcastTableRenders — topBandFrac removes the duplicate-banner seam WITHOUT changing dimensions (#256 correction)", () => {
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

  it("WITHOUT a band (topBandFrac=0, pre-correction default), the banner color survives into the merged table — reproducing the reported bug", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const right = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const merged = mergeBroadcastTableRenders(left, right, "x", 0);
    expect(hasColor(merged.image, BANNER)).toBe(true);
  });

  it("WITH topBandFrac covering the banner rows, the banner color is fully gone from the merged table", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const right = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const merged = mergeBroadcastTableRenders(left, right, "x", 4 / 20);
    expect(hasColor(merged.image, BANNER)).toBe(false);
    expect(hasColor(merged.image, TABLE)).toBe(true);
  });

  it("leaves the merged canvas dimensions EXACTLY the same regardless of topBandFrac — the whole point of overpainting instead of cropping", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20) });
    const right = renderResult({ image: matWithBanner(4, 20, 20) });
    const withoutBand = mergeBroadcastTableRenders(left, right, "x", 0);
    const withBand = mergeBroadcastTableRenders(left, right, "x", 4 / 20);
    expect(withBand.image.width).toBe(withoutBand.image.width); // 2 * matHeight(20) = 40
    expect(withBand.image.height).toBe(withoutBand.image.height);
    expect(withBand.label.width).toBe(withoutBand.label.width);
    expect(withBand.label.height).toBe(withoutBand.label.height);
  });

  it("a card's quad is UNCHANGED by topBandFrac (nothing moved, only background pixels were recolored) — same rotation as the pre-correction signature", () => {
    const card: CompositeCardLabel = {
      printingId: "c",
      corners: [{ x: 1, y: 8 }, { x: 5, y: 8 }, { x: 5, y: 12 }, { x: 1, y: 12 }],
      tags: [],
      visibleFraction: 1,
      region: "table",
    };
    const left = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [card] } });
    const right = renderResult({ image: matWithBanner(4, 20, 20), label: { ...renderResult().label, cards: [] } });
    const withoutBand = mergeBroadcastTableRenders(left, right, "x", 0);
    const withBand = mergeBroadcastTableRenders(left, right, "x", 4 / 20);
    const foundWithout = withoutBand.label.cards.find((c) => c.printingId === "c")!;
    const foundWith = withBand.label.cards.find((c) => c.printingId === "c")!;
    expect(foundWith.corners).toEqual(foundWithout.corners);
  });

  it("topBandFrac=0 is byte-identical to the pre-correction signature (no behavior change for existing callers)", () => {
    const left = renderResult({ image: matWithBanner(4, 20, 20) });
    const right = renderResult({ image: matWithBanner(4, 20, 20) });
    const withDefault = mergeBroadcastTableRenders(left, right, "x");
    const withExplicitZero = mergeBroadcastTableRenders(left, right, "x", 0);
    expect(Array.from(withDefault.image.data)).toEqual(Array.from(withExplicitZero.image.data));
    expect(withDefault.label).toEqual(withExplicitZero.label);
  });
});
