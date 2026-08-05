import { describe, it, expect } from "vitest";
import { validateZoneLayoutConfig, planZoneLayoutRun } from "../src/composites/zones/planZoneLayout.js";
import type { ZoneLayoutConfig, PlanZoneLayoutInput, EligibleCard } from "../src/composites/zones/planZoneLayout.js";
import type { ZoneMap } from "../src/composites/zones/zoneMap.js";
import { CoverageTracker } from "../src/composites/coverageTracker.js";

function validConfig(overrides: Partial<ZoneLayoutConfig> = {}): ZoneLayoutConfig {
  return {
    seed: 42,
    cardHeightFraction: 0.9,
    jitterPositionFraction: { min: -0.08, max: 0.08 },
    jitterRotationDeg: { min: -5, max: 5 },
    arsenalFaceUpProbability: 0,
    guaranteedArsenalFaceUpIndices: [],
    minVisibleFraction: 0.15,
    ...overrides,
  };
}

describe("validateZoneLayoutConfig", () => {
  it("accepts a well-formed config", () => {
    expect(validateZoneLayoutConfig(validConfig()).valid).toBe(true);
  });

  it("rejects a non-integer seed", () => {
    expect(validateZoneLayoutConfig(validConfig({ seed: 1.5 })).valid).toBe(false);
  });

  it("rejects cardHeightFraction of 0 or > 1", () => {
    expect(validateZoneLayoutConfig(validConfig({ cardHeightFraction: 0 })).valid).toBe(false);
    expect(validateZoneLayoutConfig(validConfig({ cardHeightFraction: 1.2 })).valid).toBe(false);
  });

  it("accepts cardHeightFraction of exactly 1 (card exactly fills its zone height)", () => {
    expect(validateZoneLayoutConfig(validConfig({ cardHeightFraction: 1 })).valid).toBe(true);
  });

  // Boundary decision (mirrors #252's decide-before-first-test discipline):
  // jitter magnitude must stay strictly under half a zone's own width/
  // height, or a jittered card's center could drift more than halfway
  // into a neighboring zone.
  it("rejects a jitterPositionFraction whose magnitude reaches or exceeds 0.5", () => {
    expect(validateZoneLayoutConfig(validConfig({ jitterPositionFraction: { min: -0.5, max: 0.1 } })).valid).toBe(false);
    expect(validateZoneLayoutConfig(validConfig({ jitterPositionFraction: { min: -0.1, max: 0.5 } })).valid).toBe(false);
  });

  it("accepts a jitterPositionFraction just under the 0.5 magnitude bound", () => {
    expect(validateZoneLayoutConfig(validConfig({ jitterPositionFraction: { min: -0.4999, max: 0.4999 } })).valid).toBe(true);
  });

  it("rejects arsenalFaceUpProbability outside [0,1]", () => {
    expect(validateZoneLayoutConfig(validConfig({ arsenalFaceUpProbability: 1.5 })).valid).toBe(false);
    expect(validateZoneLayoutConfig(validConfig({ arsenalFaceUpProbability: -0.1 })).valid).toBe(false);
  });

  it("rejects minVisibleFraction outside [0,1]", () => {
    expect(validateZoneLayoutConfig(validConfig({ minVisibleFraction: 2 })).valid).toBe(false);
  });

  it("rejects a non-integer or negative guaranteedArsenalFaceUpIndices entry", () => {
    expect(validateZoneLayoutConfig(validConfig({ guaranteedArsenalFaceUpIndices: [1.5] })).valid).toBe(false);
    expect(validateZoneLayoutConfig(validConfig({ guaranteedArsenalFaceUpIndices: [-1] })).valid).toBe(false);
  });

  it("collects multiple violations in one pass", () => {
    const result = validateZoneLayoutConfig(validConfig({ seed: 1.5, arsenalFaceUpProbability: 5, minVisibleFraction: -1 }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(1);
  });
});

// --- planZoneLayoutRun ------------------------------------------------

function zone(id: string, kind: string, x: number) {
  return { id, kind: kind as never, rect: { xFrac: x, yFrac: 0.1, wFrac: 0.06, hFrac: 0.3 } };
}

/** One zone per mandatory kind (id === kind, so tests can map a placement
 * back to its source zone by printingId convention below), laid out in a
 * non-overlapping row. */
function fullZoneMap(includeArsenal = false): ZoneMap {
  const kinds = ["head", "chest", "arms", "legs", "weapon", "offHand", "hero", "pitch", "graveyard", "banished", "deck"];
  if (includeArsenal) kinds.push("arsenal");
  return { name: "test", zones: kinds.map((k, i) => zone(k, k, i * 0.08)) };
}

function eligibleCard(printingId: string): EligibleCard {
  return { printingId, printCode: "T001", cardName: printingId, setId: "TST", imageUrl: `https://x/${printingId}.png`, imagePath: `/cache/${printingId}.png` };
}

function fullEligibleByKind(includeArsenal = false): PlanZoneLayoutInput["eligibleByKind"] {
  const out: PlanZoneLayoutInput["eligibleByKind"] = {
    head: [eligibleCard("head-card")],
    chest: [eligibleCard("chest-card")],
    arms: [eligibleCard("arms-card")],
    legs: [eligibleCard("legs-card")],
    weapon: [eligibleCard("weapon-card")],
    offHand: [eligibleCard("offHand-card")],
    hero: [eligibleCard("hero-card")],
    pitch: [eligibleCard("pitch-card")],
    graveyard: [eligibleCard("graveyard-card")],
    banished: [eligibleCard("banished-card")],
  };
  if (includeArsenal) out.arsenal = [eligibleCard("arsenal-card")];
  return out;
}

function baseInput(overrides: Partial<PlanZoneLayoutInput> = {}): PlanZoneLayoutInput {
  return {
    config: validConfig(),
    zoneMap: fullZoneMap(),
    eligibleByKind: fullEligibleByKind(),
    cardBack: { printingId: "__card_back__", imagePath: "/cache/cardback.png" },
    matWidth: 1000,
    matHeight: 800,
    background: { fileName: "abc123.png", contentHash: "abc123" },
    compositesPerRun: 3,
    ...overrides,
  };
}

describe("planZoneLayoutRun — mandatory-zone coverage (loud error, never silent skip)", () => {
  it("throws naming the kind and zone id when a mandatory kind's eligible pool is missing", () => {
    const input = baseInput({ eligibleByKind: { ...fullEligibleByKind(), head: undefined } });
    expect(() => planZoneLayoutRun(input)).toThrow(/head/);
  });

  it("throws naming the kind when a mandatory kind's eligible pool is present but empty", () => {
    const input = baseInput({ eligibleByKind: { ...fullEligibleByKind(), hero: [] } });
    expect(() => planZoneLayoutRun(input)).toThrow(/hero/);
  });

  it("eagerly requires an arsenal pool whenever an arsenal zone is present, even if arsenalFaceUpProbability is 0 (never a probabilistic surprise)", () => {
    const input = baseInput({ zoneMap: fullZoneMap(true), eligibleByKind: fullEligibleByKind(false), config: validConfig({ arsenalFaceUpProbability: 0 }) });
    expect(() => planZoneLayoutRun(input)).toThrow(/arsenal/);
  });

  it("does not require a pool for a zone kind that has no zone in this particular zone map", () => {
    const minimal: ZoneMap = { name: "t", zones: [zone("hero", "hero", 0)] };
    const input = baseInput({ zoneMap: minimal, eligibleByKind: { hero: [eligibleCard("hero-card")] } });
    expect(() => planZoneLayoutRun(input)).not.toThrow();
  });
});

describe("planZoneLayoutRun — determinism", () => {
  it("the same input produces byte-identical (JSON-equal) plans", () => {
    const a = planZoneLayoutRun(baseInput());
    const b = planZoneLayoutRun(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a different seed produces a different jitter/rotation stream", () => {
    const a = planZoneLayoutRun(baseInput({ config: validConfig({ seed: 1 }) }));
    const b = planZoneLayoutRun(baseInput({ config: validConfig({ seed: 2 }) }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("planZoneLayoutRun — containment (boundary convention, mirrors #252's decide-before-first-test)", () => {
  it("every non-deck card's pre-jitter center is its zone's own center, and jitter never exceeds the configured bound", () => {
    const jitterMax = 0.1;
    const input = baseInput({ config: validConfig({ jitterPositionFraction: { min: -jitterMax, max: jitterMax } }), compositesPerRun: 5 });
    const plans = planZoneLayoutRun(input);
    const zonesById = new Map(input.zoneMap.zones.map((z) => [z.id, z]));

    for (const plan of plans) {
      for (const c of plan.cards) {
        if (c.isCardBack) continue;
        // printingId convention in this fixture: "<kind>-card" === zone id
        const zoneId = c.printingId.replace(/-card$/, "");
        const z = zonesById.get(zoneId);
        expect(z).toBeDefined();
        if (!z) continue;
        const zoneCenterX = z.rect.xFrac + z.rect.wFrac / 2;
        const zoneCenterY = z.rect.yFrac + z.rect.hFrac / 2;
        expect(Math.abs(c.centerXFrac - zoneCenterX)).toBeLessThanOrEqual(z.rect.wFrac * jitterMax + 1e-9);
        expect(Math.abs(c.centerYFrac - zoneCenterY)).toBeLessThanOrEqual(z.rect.hFrac * jitterMax + 1e-9);
      }
    }
  });

  it("cardHeightFrac is derived from the ZONE's own height fraction, not a fixed canvas-wide constant", () => {
    const input = baseInput({ config: validConfig({ cardHeightFraction: 0.5 }) });
    const plans = planZoneLayoutRun(input);
    const heroZone = input.zoneMap.zones.find((z) => z.id === "hero")!;
    const heroCard = plans[0].cards.find((c) => c.printingId === "hero-card")!;
    expect(heroCard.cardHeightFrac).toBeCloseTo(0.5 * heroZone.rect.hFrac, 9);
  });
});

describe("planZoneLayoutRun — deck zone (card back)", () => {
  it("places the provided card-back ref on the deck zone, tagged isCardBack, never drawing from any catalog pool", () => {
    const input = baseInput();
    const plans = planZoneLayoutRun(input);
    const deckCard = plans[0].cards.find((c) => c.printingId === input.cardBack.printingId);
    expect(deckCard).toBeDefined();
    expect(deckCard?.imagePath).toBe(input.cardBack.imagePath);
    expect(deckCard?.isCardBack).toBe(true);
  });
});

describe("planZoneLayoutRun — arsenal (optional, occasional, guaranteed-index override)", () => {
  it("arsenal never appears when probability is 0 and no index is guaranteed", () => {
    const input = baseInput({ zoneMap: fullZoneMap(true), eligibleByKind: fullEligibleByKind(true), config: validConfig({ arsenalFaceUpProbability: 0 }), compositesPerRun: 6 });
    const plans = planZoneLayoutRun(input);
    for (const p of plans) expect(p.cards.some((c) => c.printingId === "arsenal-card")).toBe(false);
  });

  it("a guaranteed index forces arsenal inclusion at that index even with probability 0, and nowhere else", () => {
    const input = baseInput({
      zoneMap: fullZoneMap(true),
      eligibleByKind: fullEligibleByKind(true),
      config: validConfig({ arsenalFaceUpProbability: 0, guaranteedArsenalFaceUpIndices: [2] }),
      compositesPerRun: 5,
    });
    const plans = planZoneLayoutRun(input);
    plans.forEach((p, i) => {
      const hasArsenal = p.cards.some((c) => c.printingId === "arsenal-card");
      expect(hasArsenal).toBe(i === 2);
    });
  });

  it("probability 1 includes arsenal in every composite", () => {
    const input = baseInput({ zoneMap: fullZoneMap(true), eligibleByKind: fullEligibleByKind(true), config: validConfig({ arsenalFaceUpProbability: 1 }), compositesPerRun: 4 });
    const plans = planZoneLayoutRun(input);
    for (const p of plans) expect(p.cards.some((c) => c.printingId === "arsenal-card")).toBe(true);
  });

  it("toggling arsenalFaceUpProbability never reshuffles another zone's own pick/jitter in the same composite (always-draw discipline)", () => {
    const zeroProb = planZoneLayoutRun(
      baseInput({ zoneMap: fullZoneMap(true), eligibleByKind: fullEligibleByKind(true), config: validConfig({ arsenalFaceUpProbability: 0 }) }),
    );
    const fullProb = planZoneLayoutRun(
      baseInput({ zoneMap: fullZoneMap(true), eligibleByKind: fullEligibleByKind(true), config: validConfig({ arsenalFaceUpProbability: 1 }) }),
    );
    const heroFromZero = zeroProb[0].cards.find((c) => c.printingId === "hero-card")!;
    const heroFromFull = fullProb[0].cards.find((c) => c.printingId === "hero-card")!;
    expect(heroFromZero.centerXFrac).toBe(heroFromFull.centerXFrac);
    expect(heroFromZero.centerYFrac).toBe(heroFromFull.centerYFrac);
    expect(heroFromZero.rotationDeg).toBe(heroFromFull.rotationDeg);
  });
});

describe("planZoneLayoutRun — weapon vs offHand pick independently from their own pools", () => {
  it("a weapon zone and an offHand zone each draw from their own distinct catalog pool", () => {
    const zoneMap: ZoneMap = { name: "t", zones: [zone("weapon-main", "weapon", 0), zone("weapon-off", "offHand", 0.5)] };
    const eligibleByKind = { weapon: [eligibleCard("the-weapon")], offHand: [eligibleCard("the-offhand")] };
    const plans = planZoneLayoutRun(baseInput({ zoneMap, eligibleByKind }));
    const printingIds = plans[0].cards.map((c) => c.printingId).sort();
    expect(printingIds).toEqual(["the-offhand", "the-weapon"]);
  });
});

describe("planZoneLayoutRun — no perspective/sleeve/glare augmentation, fixed lighting (scope decision)", () => {
  it("every card placement has zero perspective and no tags", () => {
    const plans = planZoneLayoutRun(baseInput());
    for (const p of plans) {
      for (const c of p.cards) {
        expect(c.perspectiveLeftFrac).toBe(0);
        expect(c.perspectiveRightFrac).toBe(0);
        expect(c.tags).toEqual([]);
      }
    }
  });

  it("lighting is fixed at zero delta (no lighting augmentation in zone-layout mode)", () => {
    const plans = planZoneLayoutRun(baseInput());
    for (const p of plans) {
      expect(p.lighting).toEqual({ brightnessDelta: 0, contrastDelta: 0 });
    }
  });

  it("every composite uses the provided external playmat background", () => {
    const plans = planZoneLayoutRun(baseInput());
    for (const p of plans) {
      expect(p.background).toEqual({ type: "external", fileName: "abc123.png", contentHash: "abc123" });
    }
  });

  it("width/height match the provided single-mat dimensions", () => {
    const plans = planZoneLayoutRun(baseInput({ matWidth: 640, matHeight: 480 }));
    for (const p of plans) {
      expect(p.width).toBe(640);
      expect(p.height).toBe(480);
    }
  });
});

// #268 PR #269 review round 1, BLOCKER 2: coverage-driven selection wired
// into zone-generate's single/two-player planning (planZoneLayoutRun),
// exactly like paramStream.ts's — applied WITHIN each semantic-eligibility
// bucket (a Head zone still only ever gets a Head-eligible card; a
// coverageTracker is a per-KIND resource, never bypasses which pool a zone
// draws from), consuming the ALREADY-drawn `pickFrac` value so the
// header's "every zone always draws exactly 5 rng() calls" invariant holds
// unchanged whether or not coverage mode is active for a given kind.
function multiCard(kind: string, n: number): EligibleCard[] {
  return Array.from({ length: n }, (_, i) => eligibleCard(`${kind}-card-${i}`));
}

describe("planZoneLayoutRun — coverage mode (#268 BLOCKER 2)", () => {
  it("with a generous composite budget, every eligible printing in a tracked kind's pool appears at least once", () => {
    const eligibleByKind = { ...fullEligibleByKind(), weapon: multiCard("weapon", 6) };
    const coverageTrackersByKind = { weapon: new CoverageTracker(6) };
    const input = baseInput({ eligibleByKind, coverageTrackersByKind, compositesPerRun: 40 });

    planZoneLayoutRun(input);

    for (const count of coverageTrackersByKind.weapon.allAppearanceCounts()) {
      expect(count).toBeGreaterThan(0);
    }
  });

  it("DRAW-SHAPE INVARIANT: a coverage tracker on one kind never changes ANY other zone's draws (jitter/rotation/other kinds' picks) for a fixed seed — matches this module's header's 'always 5 rng() calls per zone' contract", () => {
    const eligibleByKind = { ...fullEligibleByKind(), weapon: multiCard("weapon", 6) };
    const withoutCoverage = planZoneLayoutRun(baseInput({ eligibleByKind, compositesPerRun: 10 }));
    const withCoverage = planZoneLayoutRun(baseInput({ eligibleByKind, coverageTrackersByKind: { weapon: new CoverageTracker(6) }, compositesPerRun: 10 }));

    expect(withoutCoverage.length).toBe(withCoverage.length);
    for (let i = 0; i < withoutCoverage.length; i++) {
      const a = withoutCoverage[i];
      const b = withCoverage[i];
      expect(b.background).toEqual(a.background);
      expect(b.lighting).toEqual(a.lighting);
      expect(b.cards.length).toBe(a.cards.length);
      for (let c = 0; c < a.cards.length; c++) {
        const isWeaponCard = a.cards[c].printingId.startsWith("weapon-card");
        const { printingId: _apId, imagePath: _aip, ...aRest } = a.cards[c];
        const { printingId: _bpId, imagePath: _bip, ...bRest } = b.cards[c];
        expect(bRest).toEqual(aRest);
        // Every OTHER kind (single-item pools here) must pick the exact
        // same printingId regardless of coverage mode; only the tracked
        // "weapon" kind is allowed to differ.
        if (!isWeaponCard) expect(b.cards[c].printingId).toBe(a.cards[c].printingId);
      }
    }
  });

  it("never bypasses semantic eligibility — a Head zone still only ever receives a Head-eligible card, even with a coverage tracker active for a DIFFERENT kind", () => {
    const eligibleByKind = { ...fullEligibleByKind(), weapon: multiCard("weapon", 4) };
    const plans = planZoneLayoutRun(baseInput({ eligibleByKind, coverageTrackersByKind: { weapon: new CoverageTracker(4) }, compositesPerRun: 10 }));
    for (const p of plans) {
      const headCard = p.cards.find((c) => c.printingId === "head-card" || c.printingId.startsWith("head-"));
      // The head zone's only eligible card is "head-card" — it must be
      // exactly that, never a weapon-card leaking across buckets.
      const headZoneCard = p.cards.find((c) => c.printingId.startsWith("head"));
      expect(headZoneCard?.printingId).toBe("head-card");
      void headCard;
    }
  });

  it("is deterministic — same seed + same trackers-from-scratch produce byte-identical output across two calls", () => {
    const eligibleByKind = { ...fullEligibleByKind(), weapon: multiCard("weapon", 5) };
    const a = planZoneLayoutRun(baseInput({ eligibleByKind, coverageTrackersByKind: { weapon: new CoverageTracker(5) }, compositesPerRun: 8 }));
    const b = planZoneLayoutRun(baseInput({ eligibleByKind, coverageTrackersByKind: { weapon: new CoverageTracker(5) }, compositesPerRun: 8 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("without any coverageTrackersByKind entry, behavior is unchanged from the pre-#268 uniform-random path", () => {
    const eligibleByKind = { ...fullEligibleByKind(), weapon: multiCard("weapon", 5) };
    const a = planZoneLayoutRun(baseInput({ eligibleByKind, compositesPerRun: 6 }));
    const b = planZoneLayoutRun(baseInput({ eligibleByKind, coverageTrackersByKind: {}, compositesPerRun: 6 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("planZoneLayoutRun — compositeId", () => {
  it("uses a default 'composite-NNNN' id scheme", () => {
    const plans = planZoneLayoutRun(baseInput({ compositesPerRun: 2 }));
    expect(plans[0].compositeId).toBe("composite-0000");
    expect(plans[1].compositeId).toBe("composite-0001");
  });

  it("honors a custom compositeIdPrefix", () => {
    const plans = planZoneLayoutRun(baseInput({ compositeIdPrefix: "near-mat", compositesPerRun: 1 }));
    expect(plans[0].compositeId).toBe("near-mat-0000");
  });
});
