import { describe, it, expect } from "vitest";
import { validateZoneMap, zoneRectsOverlap, ZONE_KINDS, MANDATORY_ZONE_KINDS } from "../src/composites/zones/zoneMap.js";
import type { ZoneMap, ZoneRectFrac } from "../src/composites/zones/zoneMap.js";

// #253: zone-map format (hand-authored per playmat, committed config — the
// source playmat IMAGE itself is never committed, only this geometry).
// zoneRectsOverlap + validateZoneMap's pairwise check are the direct
// implementation of lesson "no-guard-code-is-an-unstated-invariant": zone
// overlaps in the hand-authored map (e.g. DECK vs GRAVEYARD sharing a
// column) must be caught explicitly, not left as a silent footgun.

function rect(overrides: Partial<ZoneRectFrac> = {}): ZoneRectFrac {
  return { xFrac: 0.1, yFrac: 0.1, wFrac: 0.2, hFrac: 0.2, ...overrides };
}

function validMap(overrides: Partial<ZoneMap> = {}): ZoneMap {
  return {
    name: "test playmat",
    zones: [
      { id: "head", kind: "head", rect: rect({ xFrac: 0.0, yFrac: 0.0, wFrac: 0.2, hFrac: 0.2 }) },
      { id: "chest", kind: "chest", rect: rect({ xFrac: 0.0, yFrac: 0.3, wFrac: 0.2, hFrac: 0.2 }) },
    ],
    ...overrides,
  };
}

describe("zoneRectsOverlap", () => {
  it("returns false for two disjoint rects (gap between them)", () => {
    expect(zoneRectsOverlap(rect({ xFrac: 0, yFrac: 0, wFrac: 0.1, hFrac: 0.1 }), rect({ xFrac: 0.2, yFrac: 0, wFrac: 0.1, hFrac: 0.1 }))).toBe(false);
  });

  it("returns false for two rects that only touch edge-to-edge (no gap, no overlap)", () => {
    expect(zoneRectsOverlap(rect({ xFrac: 0, yFrac: 0, wFrac: 0.1, hFrac: 0.1 }), rect({ xFrac: 0.1, yFrac: 0, wFrac: 0.1, hFrac: 0.1 }))).toBe(false);
  });

  it("returns true for two rects that genuinely overlap", () => {
    expect(zoneRectsOverlap(rect({ xFrac: 0, yFrac: 0, wFrac: 0.15, hFrac: 0.15 }), rect({ xFrac: 0.1, yFrac: 0.1, wFrac: 0.15, hFrac: 0.15 }))).toBe(true);
  });

  it("returns true when one rect fully contains another", () => {
    expect(zoneRectsOverlap(rect({ xFrac: 0, yFrac: 0, wFrac: 0.5, hFrac: 0.5 }), rect({ xFrac: 0.1, yFrac: 0.1, wFrac: 0.1, hFrac: 0.1 }))).toBe(true);
  });
});

describe("validateZoneMap — structural validity", () => {
  it("accepts a well-formed zone map", () => {
    const result = validateZoneMap(validMap());
    expect(result.valid).toBe(true);
  });

  it("rejects a non-object", () => {
    const result = validateZoneMap(null);
    expect(result.valid).toBe(false);
  });

  it("rejects a map with no zones (empty array)", () => {
    const result = validateZoneMap(validMap({ zones: [] }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/zones/i);
  });

  it("rejects a zone with an unknown kind", () => {
    const result = validateZoneMap({ name: "x", zones: [{ id: "a", kind: "not-a-real-kind", rect: rect() }] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/kind/i);
  });

  it("rejects duplicate zone ids", () => {
    const m = validMap();
    const result = validateZoneMap({ ...m, zones: [m.zones[0], { ...m.zones[1], id: m.zones[0].id }] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/duplicate/i);
  });

  it("rejects a rect with a negative xFrac or yFrac", () => {
    const result = validateZoneMap({ name: "x", zones: [{ id: "a", kind: "head", rect: rect({ xFrac: -0.01 }) }] });
    expect(result.valid).toBe(false);
  });

  it("rejects a rect with zero or negative width/height", () => {
    const result = validateZoneMap({ name: "x", zones: [{ id: "a", kind: "head", rect: rect({ wFrac: 0 }) }] });
    expect(result.valid).toBe(false);
  });

  it("rejects a rect that extends past the right/bottom canvas edge (xFrac + wFrac > 1)", () => {
    const result = validateZoneMap({ name: "x", zones: [{ id: "a", kind: "head", rect: rect({ xFrac: 0.9, wFrac: 0.2 }) }] });
    expect(result.valid).toBe(false);
  });

  it("accepts a rect that exactly touches the canvas edge (xFrac + wFrac === 1)", () => {
    const result = validateZoneMap({ name: "x", zones: [{ id: "a", kind: "head", rect: rect({ xFrac: 0.8, wFrac: 0.2 }) }] });
    expect(result.valid).toBe(true);
  });

  it("rejects two zones whose rects overlap (e.g. a hand-authoring mistake putting DECK on top of GRAVEYARD)", () => {
    const result = validateZoneMap({
      name: "x",
      zones: [
        { id: "graveyard", kind: "graveyard", rect: rect({ xFrac: 0.8, yFrac: 0.1, wFrac: 0.1, hFrac: 0.2 }) },
        { id: "deck", kind: "deck", rect: rect({ xFrac: 0.8, yFrac: 0.15, wFrac: 0.1, hFrac: 0.2 }) },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/overlap/i);
  });

  it("collects multiple violations in one pass rather than stopping at the first (mirrors config.ts's validate style)", () => {
    const result = validateZoneMap({
      name: "x",
      zones: [
        { id: "a", kind: "bogus-kind", rect: rect({ wFrac: -1 }) },
        { id: "a", kind: "head", rect: rect() },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe("ZONE_KINDS / MANDATORY_ZONE_KINDS", () => {
  it("includes every kind the #253 brief mandates", () => {
    for (const k of ["head", "chest", "arms", "legs", "weapon", "offHand", "hero", "pitch", "deck", "graveyard", "banished", "arsenal"]) {
      expect(ZONE_KINDS).toContain(k);
    }
  });

  it("mandatory kinds are every enumerated kind except arsenal (arsenal is the documented optional/occasional zone)", () => {
    expect(MANDATORY_ZONE_KINDS).not.toContain("arsenal");
    for (const k of ["head", "chest", "arms", "legs", "weapon", "offHand", "hero", "pitch", "deck", "graveyard", "banished"]) {
      expect(MANDATORY_ZONE_KINDS).toContain(k);
    }
  });
});

describe("the committed reference zone map (config/zone-maps/combat-chain-playmat.json)", () => {
  it("is valid and covers all 12 zones with no overlaps, measured against the real reference playmat image", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raw = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "config", "zone-maps", "combat-chain-playmat.json"), "utf8"));
    const result = validateZoneMap(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.map.zones).toHaveLength(12);
      const kinds = result.map.zones.map((z) => z.kind).sort();
      expect(kinds).toEqual(
        ["arms", "arsenal", "banished", "chest", "deck", "graveyard", "head", "hero", "legs", "offHand", "pitch", "weapon"].sort(),
      );
    }
  });
});
