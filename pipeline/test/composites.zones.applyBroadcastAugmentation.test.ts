import { describe, it, expect } from "vitest";
import { applyBroadcastAugmentation, nearestZoneId } from "../src/composites/zones/applyBroadcastAugmentation.js";
import type { BroadcastCompositeAugmentation } from "../src/composites/zones/planBroadcastAugmentation.js";
import type { CompositeParams, CardPlacement } from "../src/composites/paramStream.js";
import type { ZoneMap } from "../src/composites/zones/zoneMap.js";

// #256 Phase C.3/C.4: applies a planned BroadcastCompositeAugmentation
// (planBroadcastAugmentation.ts's pure param stream) onto the near/far
// zone-layout plans (planZoneLayout.ts, unchanged) — sleeve tags, stack
// shims (isOccluder placements inserted BEFORE the matched real card, so
// they render "underneath"/peeking out), dice + hand (isOccluder
// placements appended at the END, rendered topmost). Every occluder
// placement's printingId matches a returned OccluderImageSpec 1:1, so the
// render step can synthesize exactly the RawImages needed via
// broadcastOccluders.ts, keyed by printingId.

const ZONE_MAP: ZoneMap = {
  name: "test rig",
  zones: [
    { id: "chest", kind: "chest", rect: { xFrac: 0.0, yFrac: 0.0, wFrac: 0.2, hFrac: 0.2 } },
    { id: "deck", kind: "deck", rect: { xFrac: 0.6, yFrac: 0.0, wFrac: 0.2, hFrac: 0.2 } },
  ],
};

function placement(overrides: Partial<CardPlacement> = {}): CardPlacement {
  return {
    printingId: "card-a",
    imagePath: "/images/card-a.png",
    centerXFrac: 0.1,
    centerYFrac: 0.1,
    rotationDeg: 0,
    cardHeightFrac: 0.18,
    perspectiveLeftFrac: 0,
    perspectiveRightFrac: 0,
    glarePositionFrac: 0.5,
    tags: [],
    ...overrides,
  };
}

function plan(overrides: Partial<CompositeParams> = {}): CompositeParams {
  return {
    compositeId: "left",
    width: 100,
    height: 100,
    background: { type: "external", fileName: "bg.png", contentHash: "hash" },
    lighting: { brightnessDelta: 0, contrastDelta: 0 },
    blur: null,
    cards: [],
    ...overrides,
  };
}

function noAugmentation(overrides: Partial<BroadcastCompositeAugmentation> = {}): BroadcastCompositeAugmentation {
  return {
    rigIndexDraw: 0,
    sleeveZoneIds: new Set(),
    stackShimsByZoneKind: new Map(),
    dice: [],
    hand: null,
    previewCardDraw: 0.5,
    keystoneLeftFrac: 0,
    keystoneRightFrac: 0,
    ...overrides,
  };
}

describe("nearestZoneId", () => {
  it("returns the id of the zone whose rect center is closest to the placement's own center", () => {
    const chestPlacement = placement({ centerXFrac: 0.1, centerYFrac: 0.1 }); // chest center is (0.1,0.1)
    expect(nearestZoneId(chestPlacement, ZONE_MAP)).toBe("chest");
    const deckPlacement = placement({ centerXFrac: 0.7, centerYFrac: 0.1 }); // deck center is (0.7,0.1)
    expect(nearestZoneId(deckPlacement, ZONE_MAP)).toBe("deck");
  });
});

describe("applyBroadcastAugmentation — sleeve tags", () => {
  it("tags the matching card 'sleeved' when its nearest zone id is in sleeveZoneIds, on both sides independently", () => {
    const left = plan({ cards: [placement({ printingId: "left-card" })] });
    const right = plan({ compositeId: "right", cards: [placement({ printingId: "right-card" })] });
    const augmentation = noAugmentation({ sleeveZoneIds: new Set(["chest"]) });

    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    expect(result.leftPlan.cards.find((c) => c.printingId === "left-card")!.tags).toContain("sleeved");
    expect(result.rightPlan.cards.find((c) => c.printingId === "right-card")!.tags).toContain("sleeved");
  });

  it("does not tag a card whose nearest zone is not in sleeveZoneIds", () => {
    const left = plan({ cards: [placement({ printingId: "left-card" })] });
    const right = plan({ compositeId: "right", cards: [] });
    const augmentation = noAugmentation({ sleeveZoneIds: new Set(["deck"]) }); // card is at chest's position, not deck's
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    expect(result.leftPlan.cards[0].tags).not.toContain("sleeved");
  });
});

describe("applyBroadcastAugmentation — stack shims", () => {
  it("inserts N occluder shim placements immediately BEFORE the matched card, one per side", () => {
    const left = plan({ cards: [placement({ printingId: "left-deck", isCardBack: true, centerXFrac: 0.7, centerYFrac: 0.1 })] });
    const right = plan({ compositeId: "right", cards: [placement({ printingId: "right-deck", isCardBack: true, centerXFrac: 0.7, centerYFrac: 0.1 })] });
    const augmentation = noAugmentation({ stackShimsByZoneKind: new Map([["deck", 2]]) });

    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    expect(result.leftPlan.cards).toHaveLength(3); // 2 shims + the real card-back
    expect(result.leftPlan.cards[2].printingId).toBe("left-deck"); // real card stays LAST (on top)
    expect(result.leftPlan.cards[0].isOccluder).toBe(true);
    expect(result.leftPlan.cards[1].isOccluder).toBe(true);
    expect(result.rightPlan.cards).toHaveLength(3);
  });

  it("adds zero extra placements when the layer count is 0", () => {
    const left = plan({ cards: [placement({ printingId: "left-deck", isCardBack: true, centerXFrac: 0.7, centerYFrac: 0.1 })] });
    const right = plan({ compositeId: "right", cards: [] });
    const augmentation = noAugmentation({ stackShimsByZoneKind: new Map([["deck", 0]]) });
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    expect(result.leftPlan.cards).toHaveLength(1);
  });

  it("every shim placement has a corresponding OccluderImageSpec with a matching printingId", () => {
    const left = plan({ cards: [placement({ printingId: "left-deck", isCardBack: true, centerXFrac: 0.7, centerYFrac: 0.1 })] });
    const right = plan({ compositeId: "right", cards: [] });
    const augmentation = noAugmentation({ stackShimsByZoneKind: new Map([["deck", 2]]) });
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    const shimPlacements = result.leftPlan.cards.filter((c) => c.isOccluder);
    for (const p of shimPlacements) {
      expect(result.occluderSpecs.some((s) => s.printingId === p.printingId && s.kind === "shim")).toBe(true);
    }
  });
});

describe("applyBroadcastAugmentation — dice", () => {
  it("appends a dice occluder placement to the correct side, at the END of that side's cards (topmost)", () => {
    const left = plan({ cards: [placement({ printingId: "left-card" })] });
    const right = plan({ compositeId: "right", cards: [] });
    const augmentation = noAugmentation({ dice: [{ side: "left", xFrac: 0.5, yFrac: 0.5, rotationDeg: 10, face: 3, paletteIndex: 1 }] });

    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    expect(result.leftPlan.cards).toHaveLength(2);
    const dicePlacement = result.leftPlan.cards[1];
    expect(dicePlacement.isOccluder).toBe(true);
    expect(dicePlacement.centerXFrac).toBe(0.5);
    expect(dicePlacement.centerYFrac).toBe(0.5);
    expect(result.rightPlan.cards).toHaveLength(0);
    expect(result.occluderSpecs.some((s) => s.printingId === dicePlacement.printingId && s.kind === "dice")).toBe(true);
  });

  it("with zero dice planned, neither side gains any occluder placement", () => {
    const left = plan({ cards: [] });
    const right = plan({ compositeId: "right", cards: [] });
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, noAugmentation());
    expect(result.leftPlan.cards).toHaveLength(0);
    expect(result.rightPlan.cards).toHaveLength(0);
    expect(result.occluderSpecs).toHaveLength(0);
  });
});

describe("applyBroadcastAugmentation — hand", () => {
  it("appends a hand occluder placement to the declared side, at the very end (rendered on top of dice too)", () => {
    const left = plan({
      cards: [placement({ printingId: "left-card" })],
    });
    const right = plan({ compositeId: "right", cards: [] });
    const augmentation = noAugmentation({
      dice: [{ side: "left", xFrac: 0.2, yFrac: 0.2, rotationDeg: 0, face: 1, paletteIndex: 0 }],
      hand: { side: "left", xFrac: 0.5, yFrac: 0.5, rotationDeg: 5, paletteIndex: 2, blurStrength: 0.5 },
    });
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    expect(result.leftPlan.cards).toHaveLength(3); // real card + dice + hand
    const last = result.leftPlan.cards[2];
    expect(last.isOccluder).toBe(true);
    expect(result.occluderSpecs.some((s) => s.printingId === last.printingId && s.kind === "hand")).toBe(true);
  });

  // #256 correction: REQUIRED hand motion blur (Pro Tour Las Vegas shows it
  // prominently) — the planned blurStrength must reach the render step.
  it("carries the planned blurStrength through to the hand's OccluderImageSpec", () => {
    const left = plan({ cards: [] });
    const right = plan({ compositeId: "right", cards: [] });
    const augmentation = noAugmentation({
      hand: { side: "left", xFrac: 0.5, yFrac: 0.5, rotationDeg: 5, paletteIndex: 2, blurStrength: 0.73 },
    });
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, augmentation);
    const handSpec = result.occluderSpecs.find((s) => s.kind === "hand");
    expect(handSpec).toBeDefined();
    expect(handSpec!.kind === "hand" && handSpec!.blurStrength).toBe(0.73);
  });

  it("hand is absent (null) -> no hand placement on either side", () => {
    const left = plan({ cards: [] });
    const right = plan({ compositeId: "right", cards: [] });
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, noAugmentation());
    expect(result.occluderSpecs.filter((s) => s.kind === "hand")).toHaveLength(0);
  });
});

describe("applyBroadcastAugmentation — pass-through", () => {
  it("leaves plan.width/height/background/lighting/compositeId untouched", () => {
    const left = plan({ compositeId: "left-x", width: 55, height: 66 });
    const right = plan({ compositeId: "right-x", width: 55, height: 66 });
    const result = applyBroadcastAugmentation(left, right, ZONE_MAP, noAugmentation());
    expect(result.leftPlan.compositeId).toBe("left-x");
    expect(result.leftPlan.width).toBe(55);
    expect(result.leftPlan.height).toBe(66);
    expect(result.rightPlan.compositeId).toBe("right-x");
  });
});
