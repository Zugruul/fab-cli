import { describe, it, expect } from "vitest";
import { renderComposite } from "../src/composites/compositor.js";
import type { LoadedCard } from "../src/composites/compositor.js";
import type { CompositeParams, CardPlacement } from "../src/composites/paramStream.js";

// #256 Phase C: generalizes #253's card-back exclusion pattern (pixels
// rendered + occlusion bookkeeping participation, but NEVER labeled) to
// broadcast-mode OCCLUDERS — hands, dice, stack-thickness shims. This is
// the concrete mechanism issue #256 calls out by name: "verify a
// hand-covered card actually drops out." An occluder is modeled exactly
// like a card-back placement (isOccluder: true, backed by a real loaded
// RawImage — a procedural shape, see broadcastOccluders.ts, but that's
// irrelevant to this module: renderComposite only cares about the flag).
//
// Also covers the #256 label-schema change: CardPlacement.region flows
// straight through into CompositeCardLabel.region ("table" | "preview"),
// defaulting to "table" when omitted so every pre-#256 placement (which
// never sets it) keeps producing "table" labels unchanged.

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

describe("renderComposite — occluder exclusion (#256)", () => {
  it("a fully-visible occluder is never labeled, and does not affect excludedCards/cardBacksPlaced", () => {
    const hand = solidCard("__occluder_hand__", 20, 20, [200, 170, 140]);
    const p = params({ cards: [placement({ printingId: "__occluder_hand__", isOccluder: true })] });
    const { label } = renderComposite(p, [hand]);
    expect(label.cards).toHaveLength(0);
    expect(label.excludedCards).toBe(0);
    expect(label.cardBacksPlaced).toBe(0);
  });

  // The literal brief callout: "verify a hand-covered card actually drops
  // out." A real card pasted UNDER a later hand-occluder must have its
  // visibleFraction reduced exactly as if the hand were an ordinary card,
  // and drop out of the label once below minVisibleFraction.
  it("REGRESSION LOCK: a real card fully covered by a later hand-occluder drops from the label (visibleFraction 0, excluded)", () => {
    const real = solidCard("card-a", 20, 20, [255, 0, 0]);
    const hand = solidCard("__occluder_hand__", 20, 20, [200, 170, 140]);
    const p = params({
      cards: [
        placement({ printingId: "card-a", centerXFrac: 0.3, centerYFrac: 0.3, cardHeightFrac: 0.2 }),
        placement({ printingId: "__occluder_hand__", imagePath: "/x", isOccluder: true, centerXFrac: 0.3, centerYFrac: 0.3, cardHeightFrac: 0.4 }),
      ],
    });
    const { label } = renderComposite(p, [real, hand], 0.5);
    const cardLabel = label.cards.find((c) => c.printingId === "card-a");
    expect(cardLabel).toBeUndefined();
    expect(label.excludedCards).toBe(1);
    // the hand itself never appears, under any accounting field
    expect(label.cards.find((c) => c.printingId === "__occluder_hand__")).toBeUndefined();
    expect(label.cardBacksPlaced).toBe(0);
  });

  it("a real card only PARTIALLY covered by a hand-occluder keeps a correctly reduced (not zeroed) visibleFraction", () => {
    const real = solidCard("card-a", 20, 20, [255, 0, 0]);
    const hand = solidCard("__occluder_hand__", 20, 20, [200, 170, 140]);
    const p = params({
      cards: [
        placement({ printingId: "card-a", centerXFrac: 0.3, centerYFrac: 0.3, cardHeightFrac: 0.2 }),
        placement({ printingId: "__occluder_hand__", imagePath: "/x", isOccluder: true, centerXFrac: 0.4, centerYFrac: 0.4, cardHeightFrac: 0.2 }),
      ],
    });
    const { label } = renderComposite(p, [real, hand], 0);
    const cardLabel = label.cards.find((c) => c.printingId === "card-a")!;
    expect(cardLabel.visibleFraction).toBe(0.75); // same hand-computable geometry as #252's card-on-card partial-overlap test
  });

  it("an occluder painted UNDER a real card (occluder pasted first) never reduces that card's visibility — paste order still governs, exactly like #252's card-vs-card rule", () => {
    const real = solidCard("card-a", 20, 20, [255, 0, 0]);
    const hand = solidCard("__occluder_hand__", 20, 20, [200, 170, 140]);
    const p = params({
      cards: [
        placement({ printingId: "__occluder_hand__", imagePath: "/x", isOccluder: true, centerXFrac: 0.3, centerYFrac: 0.3, cardHeightFrac: 0.4 }),
        placement({ printingId: "card-a", centerXFrac: 0.3, centerYFrac: 0.3, cardHeightFrac: 0.2 }),
      ],
    });
    const { label } = renderComposite(p, [hand, real], 0);
    const cardLabel = label.cards.find((c) => c.printingId === "card-a")!;
    expect(cardLabel.visibleFraction).toBe(1);
  });
});

describe("renderComposite — region discriminator (#256 label-schema change)", () => {
  it("defaults an unset region to 'table'", () => {
    const card = solidCard("card-a", 20, 20, [255, 0, 0]);
    const { label } = renderComposite(params(), [card]);
    expect(label.cards[0].region).toBe("table");
  });

  it("carries an explicit region: 'preview' straight through to the label", () => {
    const card = solidCard("card-a", 20, 20, [255, 0, 0]);
    const p = params({ cards: [placement({ region: "preview" })] });
    const { label } = renderComposite(p, [card]);
    expect(label.cards[0].region).toBe("preview");
  });
});
