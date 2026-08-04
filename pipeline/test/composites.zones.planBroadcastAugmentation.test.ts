import { describe, it, expect } from "vitest";
import { validateBroadcastAugmentationConfig, planBroadcastAugmentationRun } from "../src/composites/zones/planBroadcastAugmentation.js";
import type { BroadcastAugmentationConfig } from "../src/composites/zones/planBroadcastAugmentation.js";
import type { ZoneMap } from "../src/composites/zones/zoneMap.js";

// #256 Phase C.3/C.4: the broadcast-only augmentation parameter stream
// (sleeve/stack/dice/hand/preview/keystone draws) — its OWN independently
// seeded rng (mirrors generateZoneRun.ts's TWO_PLAYER_NEAR_SEED_OFFSET
// precedent: a large, documented offset keeps this stream fully decoupled
// from the near/far zone-layout stream, so broadcast augmentation NEVER
// reshuffles the underlying zone-layout plans, and vice versa). Per
// planZoneLayout.ts's own "always draw, maybe discard" discipline: every
// composite draws a FIXED count of rng() calls in a FIXED order,
// regardless of which probability rolls actually fire — the
// unconditional-draw shape invariant issue #256 calls out as a merge
// blocker if violated.

const ZONE_MAP: ZoneMap = {
  name: "test rig",
  zones: [
    { id: "arms", kind: "arms", rect: { xFrac: 0, yFrac: 0, wFrac: 0.1, hFrac: 0.1 } },
    { id: "arsenal", kind: "arsenal", rect: { xFrac: 0.2, yFrac: 0, wFrac: 0.1, hFrac: 0.1 } },
    { id: "chest", kind: "chest", rect: { xFrac: 0.4, yFrac: 0, wFrac: 0.1, hFrac: 0.1 } },
    { id: "deck", kind: "deck", rect: { xFrac: 0.6, yFrac: 0, wFrac: 0.1, hFrac: 0.1 } },
    { id: "graveyard", kind: "graveyard", rect: { xFrac: 0.8, yFrac: 0, wFrac: 0.1, hFrac: 0.1 } },
    { id: "pitch", kind: "pitch", rect: { xFrac: 0, yFrac: 0.5, wFrac: 0.1, hFrac: 0.1 } },
  ],
};

function config(overrides: Partial<BroadcastAugmentationConfig> = {}): BroadcastAugmentationConfig {
  return {
    seed: 7,
    keystoneStrength: { min: 0, max: 0.2 },
    sleeveProbability: 0.3,
    stackZoneKinds: ["deck", "graveyard", "pitch"],
    stackExtraLayers: { min: 0, max: 3 },
    diceSlots: 2,
    diceProbability: 0.2,
    handProbability: 0.25,
    ...overrides,
  };
}

describe("validateBroadcastAugmentationConfig", () => {
  it("accepts a well-formed config", () => {
    expect(validateBroadcastAugmentationConfig(config()).valid).toBe(true);
  });

  it("rejects a non-integer seed", () => {
    expect(validateBroadcastAugmentationConfig({ ...config(), seed: 1.5 }).valid).toBe(false);
  });

  it("rejects probabilities outside [0,1]", () => {
    expect(validateBroadcastAugmentationConfig({ ...config(), sleeveProbability: 1.5 }).valid).toBe(false);
    expect(validateBroadcastAugmentationConfig({ ...config(), diceProbability: -0.1 }).valid).toBe(false);
    expect(validateBroadcastAugmentationConfig({ ...config(), handProbability: 2 }).valid).toBe(false);
  });

  it("rejects a non-positive-integer diceSlots", () => {
    expect(validateBroadcastAugmentationConfig({ ...config(), diceSlots: 0 }).valid).toBe(false);
    expect(validateBroadcastAugmentationConfig({ ...config(), diceSlots: 1.5 }).valid).toBe(false);
  });

  it("rejects an empty stackZoneKinds array", () => {
    expect(validateBroadcastAugmentationConfig({ ...config(), stackZoneKinds: [] }).valid).toBe(false);
  });
});

describe("planBroadcastAugmentationRun — determinism", () => {
  it("the same seed produces byte-identical (JSON-equal, after Map/Set serialization) plans", () => {
    const a = planBroadcastAugmentationRun(config(), ZONE_MAP, 5);
    const b = planBroadcastAugmentationRun(config(), ZONE_MAP, 5);
    const serialize = (plans: ReturnType<typeof planBroadcastAugmentationRun>) =>
      plans.map((p) => ({ ...p, sleeveZoneIds: [...p.sleeveZoneIds].sort(), stackShimsByZoneId: [...p.stackShimsByZoneId.entries()].sort() }));
    expect(serialize(a)).toEqual(serialize(b));
  });

  it("a different seed produces a different stream", () => {
    const a = planBroadcastAugmentationRun(config({ seed: 1 }), ZONE_MAP, 5);
    const b = planBroadcastAugmentationRun(config({ seed: 2 }), ZONE_MAP, 5);
    expect(a.map((p) => p.previewCardDraw)).not.toEqual(b.map((p) => p.previewCardDraw));
  });

  it("produces exactly compositesPerRun entries", () => {
    expect(planBroadcastAugmentationRun(config(), ZONE_MAP, 8)).toHaveLength(8);
  });
});

describe("planBroadcastAugmentationRun — UNCONDITIONAL-DRAW SHAPE INVARIANT (#256 merge blocker)", () => {
  it("changing handProbability alone does not change dice/preview/keystone draws for the same seed (later draws unaffected by an earlier branch's config)", () => {
    const low = planBroadcastAugmentationRun(config({ handProbability: 0 }), ZONE_MAP, 3);
    const high = planBroadcastAugmentationRun(config({ handProbability: 1 }), ZONE_MAP, 3);
    // hand itself legitimately differs (that's the point of the config
    // change) — but nothing drawn AFTER hand in the fixed order should shift.
    expect(low.map((p) => p.previewCardDraw)).toEqual(high.map((p) => p.previewCardDraw));
    expect(low.map((p) => p.keystoneLeftFrac)).toEqual(high.map((p) => p.keystoneLeftFrac));
    expect(low.map((p) => p.keystoneRightFrac)).toEqual(high.map((p) => p.keystoneRightFrac));
  });

  it("changing diceProbability alone does not reshuffle sleeve/stack draws (drawn BEFORE dice in the fixed order)", () => {
    const low = planBroadcastAugmentationRun(config({ diceProbability: 0 }), ZONE_MAP, 3);
    const high = planBroadcastAugmentationRun(config({ diceProbability: 1 }), ZONE_MAP, 3);
    const serializeSleeve = (p: ReturnType<typeof planBroadcastAugmentationRun>[number]) => [...p.sleeveZoneIds].sort();
    expect(low.map(serializeSleeve)).toEqual(high.map(serializeSleeve));
    const serializeStack = (p: ReturnType<typeof planBroadcastAugmentationRun>[number]) => [...p.stackShimsByZoneId.entries()].sort();
    expect(low.map(serializeStack)).toEqual(high.map(serializeStack));
  });
});

describe("planBroadcastAugmentationRun — structural correctness", () => {
  it("sleeveZoneIds is always a subset of the zone map's own zone ids", () => {
    const plans = planBroadcastAugmentationRun(config({ sleeveProbability: 1 }), ZONE_MAP, 3);
    const allIds = new Set(ZONE_MAP.zones.map((z) => z.id));
    for (const p of plans) for (const id of p.sleeveZoneIds) expect(allIds.has(id)).toBe(true);
  });

  it("with sleeveProbability 1, every zone gets sleeved; with 0, none do", () => {
    const all = planBroadcastAugmentationRun(config({ sleeveProbability: 1 }), ZONE_MAP, 1)[0];
    expect(all.sleeveZoneIds.size).toBe(ZONE_MAP.zones.length);
    const none = planBroadcastAugmentationRun(config({ sleeveProbability: 0 }), ZONE_MAP, 1)[0];
    expect(none.sleeveZoneIds.size).toBe(0);
  });

  it("stackShimsByZoneId only ever keys zones matching stackZoneKinds", () => {
    const plans = planBroadcastAugmentationRun(config(), ZONE_MAP, 5);
    const stackZoneIds = new Set(ZONE_MAP.zones.filter((z) => config().stackZoneKinds.includes(z.kind)).map((z) => z.id));
    for (const p of plans) for (const id of p.stackShimsByZoneId.keys()) expect(stackZoneIds.has(id)).toBe(true);
  });

  it("dice array never exceeds diceSlots entries", () => {
    const plans = planBroadcastAugmentationRun(config({ diceProbability: 1, diceSlots: 2 }), ZONE_MAP, 3);
    for (const p of plans) expect(p.dice.length).toBeLessThanOrEqual(2);
  });

  it("with diceProbability 1, every slot fires (exactly diceSlots entries)", () => {
    const plans = planBroadcastAugmentationRun(config({ diceProbability: 1, diceSlots: 2 }), ZONE_MAP, 1);
    expect(plans[0].dice).toHaveLength(2);
  });

  it("with diceProbability 0, no dice ever appear", () => {
    const plans = planBroadcastAugmentationRun(config({ diceProbability: 0 }), ZONE_MAP, 3);
    for (const p of plans) expect(p.dice).toHaveLength(0);
  });

  it("hand is null when handProbability is 0, non-null when 1", () => {
    const none = planBroadcastAugmentationRun(config({ handProbability: 0 }), ZONE_MAP, 1)[0];
    expect(none.hand).toBeNull();
    const always = planBroadcastAugmentationRun(config({ handProbability: 1 }), ZONE_MAP, 1)[0];
    expect(always.hand).not.toBeNull();
  });

  it("every dice/hand entry declares a side of 'left' or 'right'", () => {
    const plans = planBroadcastAugmentationRun(config({ diceProbability: 1, handProbability: 1 }), ZONE_MAP, 3);
    for (const p of plans) {
      for (const d of p.dice) expect(["left", "right"]).toContain(d.side);
      expect(["left", "right"]).toContain(p.hand!.side);
    }
  });

  it("keystoneLeftFrac/keystoneRightFrac stay within the configured range", () => {
    const plans = planBroadcastAugmentationRun(config({ keystoneStrength: { min: 0.05, max: 0.15 } }), ZONE_MAP, 5);
    for (const p of plans) {
      expect(p.keystoneLeftFrac).toBeGreaterThanOrEqual(0.05);
      expect(p.keystoneLeftFrac).toBeLessThanOrEqual(0.15);
      expect(p.keystoneRightFrac).toBeGreaterThanOrEqual(0.05);
      expect(p.keystoneRightFrac).toBeLessThanOrEqual(0.15);
    }
  });
});
