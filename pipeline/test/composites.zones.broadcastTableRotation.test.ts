import { describe, it, expect } from "vitest";
import {
  rotate90RawImage,
  rotateQuad90AboutMat,
  mergeBroadcastTableRenders,
} from "../src/composites/zones/twoPlayer.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { RenderResult } from "../src/composites/compositor.js";
import type { CompositeCardLabel, Point } from "../src/composites/types.js";

/**
 * #256 correction (human-reported 2026-08-04: "the image is really distorted,
 * squished even ... it is missing a 90 degree rotation").
 *
 * ROOT CAUSE this file locks down: each player's playmat was stacked in its
 * NATIVE LANDSCAPE orientation. Two landscape mats side by side produce a
 * canvas of aspect ~2*(matW/matH) — for the real 1728x1008 Combat Chain mat
 * that is 3.43 — which was then fitted into the landscape play-area rect
 * (aspect ~1.16) with a NON-UNIFORM scale. The measured consequence on the
 * first real run: every one of 249 `region: table` card labels came out at
 * aspect ~0.259 instead of a real card's 63/88 = 0.716 — a ~2.8x horizontal
 * squeeze, matching 3.43/1.16 = 2.95 almost exactly.
 *
 * The fix is a rotation, NOT a corrective rescale: each mat is rotated 90°
 * before stacking, so each becomes portrait (1008x1728) and the two together
 * are 2016x1728 (aspect 1.166) — which fits the play area under a UNIFORM
 * scale. Compensating for a wrong rotation with a scale factor would leave
 * the geometry wrong and the labels subtly wrong, which is exactly the kind
 * of bad training data that looks plausible.
 *
 * The relative 180° between the two players is PRESERVED (they still face
 * each other): left is rotated 90° cw, right 90° ccw, and ccw === cw+180°.
 */

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

const px = (im: RawImage, x: number, y: number): number => im.data[(y * im.width + x) * 4];

function cardLabel(corners: [Point, Point, Point, Point]): CompositeCardLabel {
  return { printingId: "p", corners, visibleFraction: 1, region: "table" } as unknown as CompositeCardLabel;
}

function render(image: RawImage, cards: CompositeCardLabel[]): RenderResult {
  return {
    image,
    label: {
      compositeId: "c",
      fileName: "c.png",
      width: image.width,
      height: image.height,
      backgroundType: "external",
      backgroundHash: "h",
      cards,
      excludedCards: 0,
      cardBacksPlaced: 0,
    },
  } as unknown as RenderResult;
}

describe("rotate90RawImage", () => {
  it("swaps the canvas dimensions", () => {
    const src = img(4, 2, () => [1, 1, 1, 255]);
    expect(rotate90RawImage(src, "cw").width).toBe(2);
    expect(rotate90RawImage(src, "cw").height).toBe(4);
    expect(rotate90RawImage(src, "ccw").width).toBe(2);
    expect(rotate90RawImage(src, "ccw").height).toBe(4);
  });

  it("moves the top-left pixel to the top-right when rotating clockwise", () => {
    // Distinct marker at source (0,0); everything else 0.
    const src = img(4, 2, (x, y) => (x === 0 && y === 0 ? [200, 0, 0, 255] : [0, 0, 0, 255]));
    const out = rotate90RawImage(src, "cw"); // 2 wide, 4 tall
    expect(px(out, out.width - 1, 0)).toBe(200);
  });

  it("moves the top-left pixel to the bottom-left when rotating counter-clockwise", () => {
    const src = img(4, 2, (x, y) => (x === 0 && y === 0 ? [200, 0, 0, 255] : [0, 0, 0, 255]));
    const out = rotate90RawImage(src, "ccw"); // 2 wide, 4 tall
    expect(px(out, 0, out.height - 1)).toBe(200);
  });

  it("is lossless: rotating cw then ccw returns the original pixels", () => {
    const src = img(3, 5, (x, y) => [x * 10 + y, 0, 0, 255]);
    const round = rotate90RawImage(rotate90RawImage(src, "cw"), "ccw");
    expect(round.width).toBe(src.width);
    expect(round.height).toBe(src.height);
    expect(Array.from(round.data)).toEqual(Array.from(src.data));
  });
});

describe("rotateQuad90AboutMat", () => {
  it("maps a quad through the same transform the pixels take (cw)", () => {
    // cw: (x, y) -> (matHeight - y, x)
    const q: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 0, y: 4 },
    ];
    const out = rotateQuad90AboutMat(q, 20, 8, "cw");
    expect(out[0]).toEqual({ x: 8, y: 0 });
    expect(out[1]).toEqual({ x: 8, y: 10 });
    expect(out[2]).toEqual({ x: 4, y: 10 });
    expect(out[3]).toEqual({ x: 4, y: 0 });
  });

  it("never clamps out-of-mat corners (amodal convention)", () => {
    const q: [Point, Point, Point, Point] = [
      { x: -5, y: -3 },
      { x: 30, y: -3 },
      { x: 30, y: 12 },
      { x: -5, y: 12 },
    ];
    const out = rotateQuad90AboutMat(q, 20, 8, "cw");
    // matHeight - y for y=-3 -> 11, which is > the rotated width (8): stays.
    expect(out[0]).toEqual({ x: 11, y: -5 });
    expect(out[2]).toEqual({ x: -4, y: 30 });
  });

  it("a card's aspect ratio is preserved through the rotation (w/h swaps, magnitude kept)", () => {
    // A 63x88-proportioned card lying in mat space.
    const q: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 63, y: 0 },
      { x: 63, y: 88 },
      { x: 0, y: 88 },
    ];
    const out = rotateQuad90AboutMat(q, 200, 200, "cw");
    const side = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const w = (side(out[0], out[1]) + side(out[3], out[2])) / 2;
    const h = (side(out[1], out[2]) + side(out[0], out[3])) / 2;
    // 90° rotation is rigid: the 63-long edge stays 63 long, the 88 stays 88.
    expect(w).toBeCloseTo(63, 6);
    expect(h).toBeCloseTo(88, 6);
  });
});

describe("mergeBroadcastTableRenders — 90° rotation (the squish fix)", () => {
  const matW = 8;
  const matH = 4; // landscape mat, like the real Combat Chain playmat

  it("produces a canvas of 2*matHeight x matWidth — NOT 2*matWidth x matHeight", () => {
    const left = render(img(matW, matH, () => [1, 1, 1, 255]), []);
    const right = render(img(matW, matH, () => [9, 9, 9, 255]), []);
    const merged = mergeBroadcastTableRenders(left, right, "b");
    // Each mat is rotated 90° first (becoming matH wide x matW tall), THEN
    // stacked side by side. Without the rotation this was 16x4 (aspect 4.0);
    // with it, 8x8 (aspect 1.0) — far closer to a real play-area rect.
    expect(merged.image.width).toBe(matH * 2);
    expect(merged.image.height).toBe(matW);
    expect(merged.label.width).toBe(matH * 2);
    expect(merged.label.height).toBe(matW);
  });

  it("keeps each mat's pixels on its own side of the table", () => {
    const left = render(img(matW, matH, () => [1, 1, 1, 255]), []);
    const right = render(img(matW, matH, () => [9, 9, 9, 255]), []);
    const merged = mergeBroadcastTableRenders(left, right, "b");
    expect(px(merged.image, 0, 0)).toBe(1);
    expect(px(merged.image, merged.image.width - 1, 0)).toBe(9);
  });

  it("preserves card aspect ratio end-to-end — the actual regression this locks", () => {
    // One card, real 63:88 proportions, in each mat's own space.
    const card: [Point, Point, Point, Point] = [
      { x: 10, y: 10 },
      { x: 10 + 63, y: 10 },
      { x: 10 + 63, y: 10 + 88 },
      { x: 10, y: 10 + 88 },
    ];
    const big = 400;
    const left = render(img(big, big, () => [1, 1, 1, 255]), [cardLabel(card)]);
    const right = render(img(big, big, () => [9, 9, 9, 255]), [cardLabel(card)]);
    const merged = mergeBroadcastTableRenders(left, right, "b");

    const side = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    for (const c of merged.label.cards) {
      const q = c.corners;
      const w = (side(q[0], q[1]) + side(q[3], q[2])) / 2;
      const h = (side(q[1], q[2]) + side(q[0], q[3])) / 2;
      // A rigid rotation must leave the card's own edge lengths untouched.
      // Aspect is measured on the SOURCE-corner convention (index 0..3 stays
      // TL/TR/BR/BL by construction), so w/h stays 63/88 = 0.716.
      expect(w / h).toBeCloseTo(63 / 88, 6);
    }
  });

  it("keeps the two players facing each other (relative 180° preserved)", () => {
    // A marker pixel at each mat's own top-left. After cw (left) and ccw
    // (right) rotations the two markers must land at OPPOSITE corners
    // vertically — that opposition is what "facing each other" means here,
    // and it is what a plain same-direction rotation of both mats would lose.
    const mark = (x: number, y: number): [number, number, number, number] =>
      x === 0 && y === 0 ? [200, 0, 0, 255] : [0, 0, 0, 255];
    const left = render(img(matW, matH, mark), []);
    const right = render(img(matW, matH, mark), []);
    const merged = mergeBroadcastTableRenders(left, right, "b");
    const halfW = matH;
    // left mat rotated cw: its (0,0) goes to that half's top-RIGHT
    expect(px(merged.image, halfW - 1, 0)).toBe(200);
    // right mat rotated ccw: its (0,0) goes to that half's bottom-LEFT
    expect(px(merged.image, halfW, merged.image.height - 1)).toBe(200);
  });
});
