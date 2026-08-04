/**
 * Broadcast-only augmentation parameter stream (#256 Phase C.3/C.4):
 * sleeve tags, card-stack thickness, dice, a hand, the card-preview panel
 * pick, and the table-level keystone strength — everything `--mode
 * broadcast` adds on TOP of the ordinary near/far zone-layout plans
 * (planZoneLayout.ts, unchanged).
 *
 * This is its OWN independently-seeded rng stream (createRng(config.seed)
 * — a config.seed distinct from the zone-layout config's own seed, via a
 * large documented offset at the call site, mirroring
 * generateZoneRun.ts's TWO_PLAYER_NEAR_SEED_OFFSET/TWO_PLAYER_FAR_SEED_OFFSET
 * precedent exactly), so broadcast augmentation can NEVER reshuffle the
 * near/far zone-layout plans it's layered on top of, and vice versa.
 *
 * Per-composite draw order (FIXED — every knob is ALWAYS drawn, exactly
 * once, in this order, regardless of which probability rolls actually
 * fire, mirroring paramStream.ts's/planZoneLayout.ts's own "always draw,
 * maybe discard" discipline — the unconditional-draw shape invariant
 * #256's brief calls a merge blocker if violated):
 *   1. one sleeveRoll per zone in `zoneMap.zones`, visited in id-sorted
 *      order (same fixed order planZoneLayout.ts itself uses) — applied
 *      to that zone's card on EITHER mat (the two mats share the same
 *      zone map, so one roll covers both players' matching zone
 *      symmetrically; #256 scope decision, see this module's header for
 *      why a per-mat-independent roll wasn't worth the extra complexity)
 *   2. one stackExtraLayers draw per entry in `config.stackZoneKinds`,
 *      visited in ARRAY order (config-authored, not re-sorted — a fixed
 *      order once the config is fixed)
 *   3. per dice slot (config.diceSlots, always the same fixed count):
 *      includeRoll, sideRoll, xFrac, yFrac, rotationDeg, faceDraw,
 *      paletteIndexDraw — 7 draws per slot, always
 *   4. one hand: includeRoll, sideRoll, xFrac, yFrac, rotationDeg,
 *      skinTonePaletteDraw — 6 draws, always
 *   5. previewCardDraw — 1 draw, always
 *   6. keystoneLeftFrac, keystoneRightFrac — 2 draws, always
 */
import { createRng } from "../../behavior/rng.js";
import type { RangeConfig } from "../config.js";
import type { ZoneMap } from "./zoneMap.js";

export interface BroadcastAugmentationConfig {
  seed: number;
  /** Range for the table-level keystone insets (computeTableDestQuad's
   * perspectiveLeftEdgeFrac/perspectiveRightEdgeFrac) — each drawn
   * independently from this same range. */
  keystoneStrength: RangeConfig;
  sleeveProbability: number;
  /** Zone kinds eligible for a "stack of cards" thickness treatment
   * (extra shim occluder layers) — e.g. deck/graveyard/pitch. Must be
   * non-empty (a broadcast rig with zero stack-eligible zones would never
   * render the REQUIRED stack-thickness realism cue). */
  stackZoneKinds: string[];
  /** Inclusive integer range of EXTRA shim layers drawn per stack-eligible
   * zone per composite (0 = no visible extra thickness that round). */
  stackExtraLayers: RangeConfig;
  /** Fixed number of dice "slots" considered every composite — NOT the
   * number of dice that actually appear (each slot independently rolls
   * against diceProbability); this is what keeps the draw count fixed
   * regardless of how many dice end up included. */
  diceSlots: number;
  diceProbability: number;
  handProbability: number;
}

export type ValidateBroadcastAugmentationConfigResult =
  | { valid: true; config: BroadcastAugmentationConfig }
  | { valid: false; errors: string[] };

function isRange(v: unknown): v is RangeConfig {
  return typeof v === "object" && v !== null && typeof (v as RangeConfig).min === "number" && typeof (v as RangeConfig).max === "number";
}

function checkProbability(errors: string[], name: string, v: unknown): void {
  if (typeof v !== "number" || v < 0 || v > 1) errors.push(`"${name}" must be a number in [0, 1] (got ${JSON.stringify(v)})`);
}

export function validateBroadcastAugmentationConfig(raw: unknown): ValidateBroadcastAugmentationConfigResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["broadcast-augmentation config is not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (!Number.isInteger(r.seed)) errors.push('"seed" must be an integer');
  if (!isRange(r.keystoneStrength)) errors.push('"keystoneStrength" must be an object {min: number, max: number}');
  checkProbability(errors, "sleeveProbability", r.sleeveProbability);
  if (!Array.isArray(r.stackZoneKinds) || r.stackZoneKinds.length === 0) errors.push('"stackZoneKinds" must be a non-empty array');
  if (!isRange(r.stackExtraLayers)) errors.push('"stackExtraLayers" must be an object {min: number, max: number}');
  if (!Number.isInteger(r.diceSlots) || (r.diceSlots as number) <= 0) errors.push('"diceSlots" must be a positive integer');
  checkProbability(errors, "diceProbability", r.diceProbability);
  checkProbability(errors, "handProbability", r.handProbability);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, config: r as unknown as BroadcastAugmentationConfig };
}

export type BroadcastSide = "left" | "right";

export interface DicePlan {
  side: BroadcastSide;
  /** Fraction of the OWN mat (not the combined table) — 0..1. */
  xFrac: number;
  yFrac: number;
  rotationDeg: number;
  face: number;
  paletteIndex: number;
}

export interface HandPlan {
  side: BroadcastSide;
  xFrac: number;
  yFrac: number;
  rotationDeg: number;
  paletteIndex: number;
}

export interface BroadcastCompositeAugmentation {
  sleeveZoneIds: Set<string>;
  /** zone KIND -> extra shim layer count (0 = no extra thickness). Kind,
   * not zone id — see planOneComposite's doc comment on why resolution
   * to an actual zone id is deferred to application time. */
  stackShimsByZoneKind: Map<string, number>;
  dice: DicePlan[];
  hand: HandPlan | null;
  previewCardDraw: number;
  keystoneLeftFrac: number;
  keystoneRightFrac: number;
}

function inRange(rng: () => number, range: RangeConfig): number {
  return range.min + rng() * (range.max - range.min);
}

function intInRange(rng: () => number, range: RangeConfig): number {
  return Math.floor(inRange(rng, { min: range.min, max: range.max + 1 }));
}

function planOneComposite(config: BroadcastAugmentationConfig, sortedZoneIds: string[], rng: () => number): BroadcastCompositeAugmentation {
  const sleeveZoneIds = new Set<string>();
  for (const zoneId of sortedZoneIds) {
    // Always drawn, one per zone, regardless of sleeveProbability.
    const roll = rng();
    if (roll < config.sleeveProbability) sleeveZoneIds.add(zoneId);
  }

  const stackShimsByZoneKind = new Map<string, number>();
  for (const kind of config.stackZoneKinds) {
    // Always drawn, one per configured kind — kind-to-zone-id resolution
    // happens at APPLICATION time (applyBroadcastAugmentation.ts), not
    // here, since this module never reads a real zoneMap's per-zone kind
    // beyond the fixed sorted id list above (kept minimal on purpose).
    const layers = intInRange(rng, config.stackExtraLayers);
    stackShimsByZoneKind.set(kind, layers);
  }

  const dice: DicePlan[] = [];
  for (let d = 0; d < config.diceSlots; d++) {
    const includeRoll = rng();
    const sideRoll = rng();
    const xFrac = rng();
    const yFrac = rng();
    const rotationDeg = rng() * 360;
    const faceDraw = rng();
    const paletteDraw = rng();
    if (includeRoll < config.diceProbability) {
      dice.push({
        side: sideRoll < 0.5 ? "left" : "right",
        xFrac,
        yFrac,
        rotationDeg,
        face: Math.floor(faceDraw * 6) + 1,
        paletteIndex: Math.floor(paletteDraw * 1000),
      });
    }
  }

  const handIncludeRoll = rng();
  const handSideRoll = rng();
  const handX = rng();
  const handY = rng();
  const handRotationDeg = rng() * 40 - 20; // a hand entering roughly level, not upside-down
  const handPaletteDraw = rng();
  const hand: HandPlan | null =
    handIncludeRoll < config.handProbability
      ? { side: handSideRoll < 0.5 ? "left" : "right", xFrac: handX, yFrac: handY, rotationDeg: handRotationDeg, paletteIndex: Math.floor(handPaletteDraw * 1000) }
      : null;

  const previewCardDraw = rng();
  const keystoneLeftFrac = inRange(rng, config.keystoneStrength);
  const keystoneRightFrac = inRange(rng, config.keystoneStrength);

  return { sleeveZoneIds, stackShimsByZoneKind, dice, hand, previewCardDraw, keystoneLeftFrac, keystoneRightFrac };
}

/**
 * Plans `compositesPerRun` broadcast augmentations, deterministically from
 * `config.seed`. `zoneMap` supplies the fixed, id-sorted zone list the
 * sleeve draw loop walks — the SAME zone map used to plan the near/far
 * mats (both players share one physical layout), but this function never
 * mutates or reads anything else from it.
 *
 * NOTE: `stackShimsByZoneKind` is keyed by zone KIND here (config.stackZoneKinds'
 * own strings), not by a specific zone ID — resolving kind -> the actual
 * zone id present in `zoneMap` (there is at most one zone per kind in the
 * reference map) is applyBroadcastAugmentation.ts's job, which has direct
 * access to the per-mat CardPlacement list this stream is layered onto.
 */
export function planBroadcastAugmentationRun(config: BroadcastAugmentationConfig, zoneMap: ZoneMap, compositesPerRun: number): BroadcastCompositeAugmentation[] {
  const sortedZoneIds = [...zoneMap.zones].map((z) => z.id).sort();
  const rng = createRng(config.seed);
  const plans: BroadcastCompositeAugmentation[] = [];
  for (let i = 0; i < compositesPerRun; i++) {
    plans.push(planOneComposite(config, sortedZoneIds, rng));
  }
  return plans;
}
