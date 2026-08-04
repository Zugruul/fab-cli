import { describe, it, expect } from "vitest";
import { renderComposite } from "../src/composites/compositor.js";
import type { LoadedCard } from "../src/composites/compositor.js";
import { computeDestQuad } from "../src/composites/geometry.js";
import type { CompositeParams, CardPlacement } from "../src/composites/paramStream.js";
import type { RawImage } from "../src/composites/rawImage.js";

function solidCard(printingId: string, width: number, height: number, color: [number, number, number]): LoadedCard {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { printingId, image: { width, height, data } };
}

function placement(overrides: Partial<CardPlacement> = {}): CardPlacement {
  return {
    printingId: "card-a",
    imagePath: "/images/card-a.png",
    centerXFrac: 0.5,
    centerYFrac: 0.5,
    rotationDeg: 0,
    cardHeightFrac: 0.2,
    perspectiveLeftFrac: 0,
    perspectiveRightFrac: 0,
    glarePositionFrac: 0.5,
    tags: [],
    ...overrides,
  };
}

function params(overrides: Partial<CompositeParams> = {}): CompositeParams {
  return {
    compositeId: "composite-0000",
    width: 100,
    height: 100,
    background: { type: "solid", colorA: [50, 50, 50], colorB: [200, 200, 200], angleDeg: 0, noiseSeed: 0 },
    lighting: { brightnessDelta: 0, contrastDelta: 0 },
    cards: [placement()],
    ...overrides,
  };
}

describe("renderComposite — label fidelity (single card)", () => {
  it("the label's quad corners exactly match geometry.computeDestQuad's independent computation", () => {
    const card = solidCard("card-a", 40, 60, [255, 0, 0]);
    const p = params({ cards: [placement({ rotationDeg: 12, perspectiveLeftFrac: 0.1 })] });
    const { label } = renderComposite(p, [card]);

    const expected = computeDestQuad(p.width, p.height, 40 / 60, {
      centerXFrac: p.cards[0].centerXFrac,
      centerYFrac: p.cards[0].centerYFrac,
      rotationDeg: p.cards[0].rotationDeg,
      cardHeightFrac: p.cards[0].cardHeightFrac,
      perspectiveLeftFrac: p.cards[0].perspectiveLeftFrac,
      perspectiveRightFrac: p.cards[0].perspectiveRightFrac,
    });

    expect(label.cards).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      expect(label.cards[0].corners[i].x).toBeCloseTo(expected[i].x, 6);
      expect(label.cards[0].corners[i].y).toBeCloseTo(expected[i].y, 6);
    }
  });

  it("carries printingId, tags, backgroundType, and dimensions through to the label", () => {
    const card = solidCard("card-a", 40, 60, [255, 0, 0]);
    const p = params({ cards: [placement({ tags: ["sleeved", "glare"] })], background: { type: "gradient", colorA: [0, 0, 0], colorB: [1, 1, 1], angleDeg: 0, noiseSeed: 0 } });
    const { label } = renderComposite(p, [card]);
    expect(label.cards[0].printingId).toBe("card-a");
    expect(label.cards[0].tags).toEqual(["sleeved", "glare"]);
    // #244: procedural backgrounds are now labeled "procedural:<type>"
    // (widened from bare BackgroundType) — see composites.compositor.test.ts's
    // "external background" describe block for the "external" counterpart.
    expect(label.backgroundType).toBe("procedural:gradient");
    expect(label.backgroundHash).toBeNull();
    expect(label.width).toBe(100);
    expect(label.height).toBe(100);
    expect(label.compositeId).toBe(p.compositeId);
  });

  it("renders an image buffer sized exactly to the composite's width/height", () => {
    const card = solidCard("card-a", 40, 60, [255, 0, 0]);
    const { image } = renderComposite(params(), [card]);
    expect(image.width).toBe(100);
    expect(image.height).toBe(100);
    expect(image.data.length).toBe(100 * 100 * 4);
  });

  it("throws a clear error when a placement references a printingId with no loaded image", () => {
    expect(() => renderComposite(params({ cards: [placement({ printingId: "missing" })] }), [])).toThrow(/missing/);
  });
});

describe("renderComposite — off-canvas / amodal labels (PR #238 review round 1)", () => {
  // A card placed near the frame edge has real corners outside the
  // canvas. The label must carry those coordinates through UNCLAMPED
  // (see geometry.ts's doc comment + pipeline/docs/benchmark-labeling.md's
  // amodal-labeling addendum) while rendering still clips safely to the
  // canvas — no NaN, no crash, no out-of-range pixel values.
  it("keeps a card's label corners outside the canvas when its placement sits near the frame edge, matching geometry's independent computation", () => {
    const card = solidCard("card-a", 40, 40, [10, 200, 10]);
    const p = params({
      width: 100,
      height: 100,
      cards: [placement({ centerXFrac: 0.05, centerYFrac: 0.05, cardHeightFrac: 0.4, rotationDeg: 0 })],
    });
    const { label } = renderComposite(p, [card]);
    const [tl, tr, br, bl] = label.cards[0].corners;
    expect(tl.x).toBeCloseTo(-15);
    expect(tl.y).toBeCloseTo(-15);
    expect(tr.x).toBeCloseTo(25);
    expect(br.x).toBeCloseTo(25);
    expect(bl.y).toBeCloseTo(25);
  });

  it("renders finite, in-range pixels with no NaN/crash even when a card's quad extends off-canvas", () => {
    const card = solidCard("card-a", 40, 40, [10, 200, 10]);
    const p = params({
      width: 100,
      height: 100,
      cards: [placement({ centerXFrac: 0.05, centerYFrac: 0.05, cardHeightFrac: 0.4, rotationDeg: 0 })],
    });
    const { image } = renderComposite(p, [card]);
    expect(image.data.length).toBe(100 * 100 * 4);
    for (const v of image.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

// #244: external (real photo) backgrounds. paramStream.ts's discriminated
// BackgroundParams reuses the existing `type` field as the discriminant
// ("external" alongside "solid"/"gradient"/"noise"/"texture") rather than
// adding a new field, so every existing procedural background literal in
// this file needed zero changes.
function solidRaw(width: number, height: number, color: [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe("renderComposite — external background (#244)", () => {
  it("uses the loaded background image (cover-fit to canvas) as the base layer when background.type is 'external'", () => {
    const bg = solidRaw(10, 10, [1, 2, 3]);
    const p = params({
      width: 20,
      height: 20,
      background: { type: "external", fileName: "abc123.png", contentHash: "abc123" },
      cards: [],
    });
    const { image, label } = renderComposite(p, [], bg);
    expect(image.width).toBe(20);
    expect(image.height).toBe(20);
    const i = (10 * 20 + 10) * 4;
    expect(image.data[i]).toBeCloseTo(1, 0);
    expect(image.data[i + 1]).toBeCloseTo(2, 0);
    expect(image.data[i + 2]).toBeCloseTo(3, 0);
    expect(label.backgroundType).toBe("external");
    expect(label.backgroundHash).toBe("abc123");
  });

  it("records backgroundType as procedural:<type> and backgroundHash null for procedural backgrounds", () => {
    const card = solidCard("card-a", 40, 60, [255, 0, 0]);
    const { label } = renderComposite(
      params({ background: { type: "noise", colorA: [0, 0, 0], colorB: [10, 10, 10], angleDeg: 0, noiseSeed: 1 } }),
      [card],
    );
    expect(label.backgroundType).toBe("procedural:noise");
    expect(label.backgroundHash).toBeNull();
  });

  it("throws a clear error when background.type is 'external' but no loaded background image is provided", () => {
    const p = params({ background: { type: "external", fileName: "missing.png", contentHash: "missing" }, cards: [] });
    expect(() => renderComposite(p, [])).toThrow(/external background/);
  });
});

describe("renderComposite — OVERLAP x ROTATION intersection (each card's own quad is unaffected by later cards)", () => {
  it("the first card's recorded corners are identical whether or not a second, overlapping, rotated card is pasted on top", () => {
    const cardA = solidCard("card-a", 40, 60, [255, 0, 0]);
    const cardB = solidCard("card-b", 40, 60, [0, 0, 255]);

    const placementA = placement({ printingId: "card-a", centerXFrac: 0.5, centerYFrac: 0.5, rotationDeg: 20 });
    const alone = params({ cards: [placementA] });
    const overlapping = params({
      cards: [
        placementA,
        placement({ printingId: "card-b", imagePath: "/images/card-b.png", centerXFrac: 0.52, centerYFrac: 0.52, rotationDeg: -35 }),
      ],
    });

    const resultAlone = renderComposite(alone, [cardA]);
    const resultOverlap = renderComposite(overlapping, [cardA, cardB]);

    expect(resultOverlap.label.cards).toHaveLength(2);
    for (let i = 0; i < 4; i++) {
      expect(resultOverlap.label.cards[0].corners[i].x).toBeCloseTo(resultAlone.label.cards[0].corners[i].x, 6);
      expect(resultOverlap.label.cards[0].corners[i].y).toBeCloseTo(resultAlone.label.cards[0].corners[i].y, 6);
    }
  });

  it("processing order does not matter for a card's own label (only its own placement determines its corners)", () => {
    const cardA = solidCard("card-a", 40, 60, [255, 0, 0]);
    const cardB = solidCard("card-b", 40, 60, [0, 0, 255]);
    const placementA = placement({ printingId: "card-a", rotationDeg: 15, centerXFrac: 0.4 });
    const placementB = placement({ printingId: "card-b", imagePath: "/images/card-b.png", rotationDeg: -22, centerXFrac: 0.45 });

    const first = renderComposite(params({ cards: [placementA, placementB] }), [cardA, cardB]);
    const second = renderComposite(params({ cards: [placementB, placementA] }), [cardB, cardA]);

    const aFromFirst = first.label.cards.find((c) => c.printingId === "card-a")!;
    const aFromSecond = second.label.cards.find((c) => c.printingId === "card-a")!;
    for (let i = 0; i < 4; i++) {
      expect(aFromFirst.corners[i].x).toBeCloseTo(aFromSecond.corners[i].x, 6);
      expect(aFromFirst.corners[i].y).toBeCloseTo(aFromSecond.corners[i].y, 6);
    }
  });
});
