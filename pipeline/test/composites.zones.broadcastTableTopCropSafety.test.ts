import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateZoneMap } from "../src/composites/zones/zoneMap.js";
import { validateZoneLayoutConfig } from "../src/composites/zones/planZoneLayout.js";
import { BROADCAST_TABLE_TOP_CROP_FRAC, minReachableCardYFrac } from "../src/composites/zones/generateBroadcastRun.js";

// #256 correction: BROADCAST_TABLE_TOP_CROP_FRAC crops each mat's top edge
// to remove the duplicate-banner seam (see generateBroadcastRun.ts's own
// doc comment on that constant). That crop is safe ONLY as long as it sits
// strictly below the shallowest y any real card can ever reach under the
// zone-layout config's jitter/rotation ranges — otherwise it would
// silently chop pixels off a labeled card while its quad still claims full
// visibility (a label/render mismatch, the worst kind of bug per this
// pipeline's own geometry.ts contract).
//
// This test recomputes that bound LIVE, against the REAL committed
// config/zone-maps/combat-chain-playmat.json and
// config/zone-layout-generation.json (the same files `composites
// zone-generate` actually loads) — not a value copied from a comment. If
// either config's jitter/rotation range is ever widened enough to reach
// into the crop, this test fails loudly instead of the corruption being
// invisible to any visual sample-sheet check (a partially-cropped card
// still LOOKS fine at a glance; only its label would be wrong).

const REPO_ROOT = path.join(import.meta.dirname, "..");
// The one hardcoded reference playmat this whole broadcast pipeline
// assumes (pipeline/out/zone-reference-playmat.png, gitignored — never
// committed, see importBackgrounds.ts's convention) — its dimensions are
// a documented constant, matching BROADCAST_TABLE_TOP_CROP_FRAC's own doc.
const REFERENCE_MAT_WIDTH = 1728;
const REFERENCE_MAT_HEIGHT = 1008;

describe("BROADCAST_TABLE_TOP_CROP_FRAC — safety margin against the REAL committed configs", () => {
  it("stays strictly below the worst-case reachable card y, for the real zone map + zone-layout-generation.json", () => {
    const rawZoneMap: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config", "zone-maps", "combat-chain-playmat.json"), "utf8"));
    const zoneMapResult = validateZoneMap(rawZoneMap);
    expect(zoneMapResult.valid).toBe(true);
    if (!zoneMapResult.valid) return;

    const rawConfig: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config", "zone-layout-generation.json"), "utf8"));
    const configResult = validateZoneLayoutConfig(rawConfig);
    expect(configResult.valid).toBe(true);
    if (!configResult.valid) return;

    const minYFrac = minReachableCardYFrac(zoneMapResult.map.zones, configResult.config, REFERENCE_MAT_WIDTH, REFERENCE_MAT_HEIGHT);

    // The crop must never reach as far as any real card can — a real
    // margin, not an equality (a card sitting EXACTLY on the crop boundary
    // would be a coin-flip pixel-rounding bug waiting to happen).
    expect(BROADCAST_TABLE_TOP_CROP_FRAC).toBeLessThan(minYFrac);

    // And the margin should be a real one, not an accidental near-miss —
    // guards against a future edit nudging either number by a hair and
    // leaving this test technically green but practically fragile.
    const marginPx = (minYFrac - BROADCAST_TABLE_TOP_CROP_FRAC) * REFERENCE_MAT_HEIGHT;
    expect(marginPx).toBeGreaterThan(2);
  });

  it("minReachableCardYFrac actually moves when jitter/rotation ranges widen (sanity check on the helper itself)", () => {
    const zones = [{ rect: { xFrac: 0.03, yFrac: 0.166667, wFrac: 0.1, hFrac: 0.249 } }];
    const narrow = minReachableCardYFrac(zones, { cardHeightFraction: 0.92, jitterPositionFraction: { min: -0.01, max: 0.01 }, jitterRotationDeg: { min: -1, max: 1 } }, 1728, 1008);
    const wide = minReachableCardYFrac(zones, { cardHeightFraction: 0.92, jitterPositionFraction: { min: -0.3, max: 0.3 }, jitterRotationDeg: { min: -20, max: 20 } }, 1728, 1008);
    expect(wide).toBeLessThan(narrow);
  });
});
