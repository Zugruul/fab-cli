import { describe, it, expect } from "vitest";
import { renderComposite } from "../src/composites/compositor.js";
import type { LoadedCard } from "../src/composites/compositor.js";
import type { CompositeParams, CardPlacement } from "../src/composites/paramStream.js";

// #253 decision: a card back has no printing identity, so it must NEVER
// appear in label.cards (ground truth), even though its pixels are
// rendered exactly like any other card and it still participates in
// occlusion bookkeeping for OTHER cards. This is pinned as its own
// invariant, independent of (and orthogonal to) #252's visibleFraction
// threshold — a fully-visible, unoccluded card back is still excluded.

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
    blur: null,
    cards: [placement()],
    ...overrides,
  };
}

describe("renderComposite — card-back label exclusion (#253)", () => {
  it("a fully-visible, unoccluded card back is still excluded from label.cards", () => {
    const back = solidCard("__card_back__", 20, 20, [1, 2, 3]);
    const p = params({ cards: [placement({ printingId: "__card_back__", isCardBack: true })] });
    const { label } = renderComposite(p, [back]);
    expect(label.cards).toHaveLength(0);
  });

  it("counts a card back in the new cardBacksPlaced field, separate from excludedCards (a different reason for exclusion)", () => {
    const back = solidCard("__card_back__", 20, 20, [1, 2, 3]);
    const p = params({ cards: [placement({ printingId: "__card_back__", isCardBack: true })] });
    const { label } = renderComposite(p, [back]);
    expect(label.cardBacksPlaced).toBe(1);
    expect(label.excludedCards).toBe(0);
  });

  it("a mix of one real card and one card back: the real card is labeled normally, the card back never is", () => {
    const real = solidCard("card-a", 20, 20, [255, 0, 0]);
    const back = solidCard("__card_back__", 20, 20, [1, 2, 3]);
    const p = params({
      cards: [placement({ printingId: "card-a", centerXFrac: 0.2, centerYFrac: 0.2 }), placement({ printingId: "__card_back__", imagePath: "/x", isCardBack: true, centerXFrac: 0.8, centerYFrac: 0.8 })],
    });
    const { label } = renderComposite(p, [real, back]);
    expect(label.cards).toHaveLength(1);
    expect(label.cards[0].printingId).toBe("card-a");
    expect(label.cardBacksPlaced).toBe(1);
  });

  it("the card back's pixels are still rendered and still occlude a real card pasted UNDER it", () => {
    const real = solidCard("card-a", 20, 20, [255, 0, 0]);
    const back = solidCard("__card_back__", 20, 20, [1, 2, 3]);
    const p = params({
      cards: [
        placement({ printingId: "card-a", centerXFrac: 0.3, centerYFrac: 0.3, cardHeightFrac: 0.2 }),
        placement({ printingId: "__card_back__", imagePath: "/x", isCardBack: true, centerXFrac: 0.3, centerYFrac: 0.3, cardHeightFrac: 0.4 }),
      ],
    });
    const { label } = renderComposite(p, [real, back], 0.5);
    // card-a is fully occluded by the later card-back -> excluded via the
    // ordinary visibleFraction threshold (0 < 0.5), NOT via the card-back
    // mechanism (that only ever applies to the back's OWN label entry).
    expect(label.cards).toHaveLength(0);
    expect(label.excludedCards).toBe(1);
    expect(label.cardBacksPlaced).toBe(1);
  });

  it("cardBacksPlaced is 0 when no placement is a card back — regression safety for the pre-#253 base generator", () => {
    const card = solidCard("card-a", 20, 20, [255, 0, 0]);
    const { label } = renderComposite(params(), [card]);
    expect(label.cardBacksPlaced).toBe(0);
    expect(label.cards).toHaveLength(1);
  });
});
