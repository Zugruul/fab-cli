/**
 * Applies one planned BroadcastCompositeAugmentation (the pure param
 * stream from planBroadcastAugmentation.ts) onto a pair of near/far
 * zone-layout plans (planZoneLayout.ts's planZoneLayoutRun output,
 * UNCHANGED by this module — #256 Phase C's "reuse what you can from the
 * existing zone-layout machinery rather than forking it"), producing:
 *
 *  - the same two plans, with `sleeved` tags added to matching cards and
 *    extra `isOccluder: true` CardPlacement entries for stack shims / dice
 *    / a hand woven in (see compositor.ts's occluder handling — pixels
 *    rendered + occlusion bookkeeping, never labeled);
 *  - an `occluderSpecs` list, one entry per occluder CardPlacement
 *    (matched 1:1 by printingId), describing exactly what
 *    broadcastOccluders.ts image to synthesize for it — the render step
 *    (generateBroadcastRun.ts) turns each spec into a real RawImage and
 *    feeds it into renderComposite's loadedCards, keyed by that same
 *    printingId.
 *
 * `nearestZoneId` ties a CardPlacement back to the zone it was planned
 * for (planZoneLayout.ts's own output doesn't carry zone identity —
 * jitterPositionFraction is bounded strictly under 0.5 of a zone's own
 * size, so nearest-rect-center is an unambiguous, robust match).
 */
import type { CompositeParams, CardPlacement } from "../paramStream.js";
import type { ZoneMap } from "./zoneMap.js";
import type { BroadcastCompositeAugmentation, DicePlan, HandPlan, BroadcastSide } from "./planBroadcastAugmentation.js";

// Fixed source-image pixel dimensions for procedural occluders (#256 scope
// decision: not derived per-placement, just documented constants — see
// broadcastOccluders.ts's generators, which take arbitrary width/height).
const SHIM_SOURCE_SIZE = { width: 100, height: 140 }; // card-like aspect
const DICE_SOURCE_SIZE = { width: 80, height: 80 };
const HAND_SOURCE_SIZE = { width: 100, height: 160 };

const SHIM_COLOR: [number, number, number] = [35, 35, 40];

const DICE_PALETTES: { body: [number, number, number]; pip: [number, number, number] }[] = [
  { body: [245, 245, 245], pip: [25, 25, 25] },
  { body: [30, 30, 30], pip: [240, 240, 240] },
  { body: [190, 25, 25], pip: [245, 245, 245] },
];

const SKIN_TONE_PALETTE: [number, number, number][] = [
  [230, 190, 160],
  [200, 150, 110],
  [150, 100, 70],
  [90, 60, 40],
];

function pickFromPalette<T>(palette: T[], index: number): T {
  return palette[((index % palette.length) + palette.length) % palette.length];
}

export type OccluderImageSpec =
  | { printingId: string; kind: "shim"; width: number; height: number; color: [number, number, number] }
  | { printingId: string; kind: "dice"; width: number; height: number; bodyColor: [number, number, number]; pipColor: [number, number, number]; face: number }
  | { printingId: string; kind: "hand"; width: number; height: number; skinTone: [number, number, number] };

export interface ApplyBroadcastAugmentationResult {
  leftPlan: CompositeParams;
  rightPlan: CompositeParams;
  occluderSpecs: OccluderImageSpec[];
}

/** Finds the zone whose rect center is closest (squared Euclidean
 * distance, in frac space) to `card`'s own center — a robust match since
 * zone-layout jitter is bounded strictly under half a zone's own size
 * (validateZoneLayoutConfig's own guard), so a jittered card's center can
 * never be closer to a NEIGHBORING zone's center than its own. */
export function nearestZoneId(card: CardPlacement, zoneMap: ZoneMap): string {
  let bestId = zoneMap.zones[0].id;
  let bestDist = Infinity;
  for (const zone of zoneMap.zones) {
    const zcx = zone.rect.xFrac + zone.rect.wFrac / 2;
    const zcy = zone.rect.yFrac + zone.rect.hFrac / 2;
    const dx = card.centerXFrac - zcx;
    const dy = card.centerYFrac - zcy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = zone.id;
    }
  }
  return bestId;
}

function applySleeves(cards: CardPlacement[], zoneMap: ZoneMap, sleeveZoneIds: Set<string>): CardPlacement[] {
  return cards.map((c) => {
    if (!sleeveZoneIds.has(nearestZoneId(c, zoneMap))) return c;
    if (c.tags.includes("sleeved")) return c;
    return { ...c, tags: [...c.tags, "sleeved"] as CardPlacement["tags"] };
  });
}

function applyStackShims(
  cards: CardPlacement[],
  zoneMap: ZoneMap,
  side: BroadcastSide,
  stackShimsByZoneKind: Map<string, number>,
  occluderSpecs: OccluderImageSpec[],
): CardPlacement[] {
  if (stackShimsByZoneKind.size === 0) return cards;
  const out: CardPlacement[] = [];
  for (const card of cards) {
    const zoneId = nearestZoneId(card, zoneMap);
    const zone = zoneMap.zones.find((z) => z.id === zoneId);
    const layers = zone ? (stackShimsByZoneKind.get(zone.kind) ?? 0) : 0;
    for (let i = 0; i < layers; i++) {
      const offset = (i + 1) * 0.006;
      const printingId = `__occluder_shim_${side}_${zoneId}_${i}__`;
      out.push({
        printingId,
        imagePath: `procedural:shim:${printingId}`,
        centerXFrac: card.centerXFrac + offset,
        centerYFrac: card.centerYFrac + offset,
        rotationDeg: card.rotationDeg,
        cardHeightFrac: card.cardHeightFrac,
        perspectiveLeftFrac: 0,
        perspectiveRightFrac: 0,
        glarePositionFrac: 0.5,
        tags: [],
        isOccluder: true,
      });
      occluderSpecs.push({ printingId, kind: "shim", width: SHIM_SOURCE_SIZE.width, height: SHIM_SOURCE_SIZE.height, color: SHIM_COLOR });
    }
    out.push(card); // the real (or card-back) placement always ends up LAST — on top of its own shims
  }
  return out;
}

function dicePlacement(index: number, plan: DicePlan, occluderSpecs: OccluderImageSpec[]): CardPlacement {
  const printingId = `__occluder_dice_${index}__`;
  const palette = pickFromPalette(DICE_PALETTES, plan.paletteIndex);
  occluderSpecs.push({ printingId, kind: "dice", width: DICE_SOURCE_SIZE.width, height: DICE_SOURCE_SIZE.height, bodyColor: palette.body, pipColor: palette.pip, face: plan.face });
  return {
    printingId,
    imagePath: `procedural:dice:${printingId}`,
    centerXFrac: plan.xFrac,
    centerYFrac: plan.yFrac,
    rotationDeg: plan.rotationDeg,
    cardHeightFrac: 0.06,
    perspectiveLeftFrac: 0,
    perspectiveRightFrac: 0,
    glarePositionFrac: 0.5,
    tags: [],
    isOccluder: true,
  };
}

function handPlacement(plan: HandPlan, occluderSpecs: OccluderImageSpec[]): CardPlacement {
  const printingId = "__occluder_hand__";
  const skinTone = pickFromPalette(SKIN_TONE_PALETTE, plan.paletteIndex);
  occluderSpecs.push({ printingId, kind: "hand", width: HAND_SOURCE_SIZE.width, height: HAND_SOURCE_SIZE.height, skinTone });
  return {
    printingId,
    imagePath: `procedural:hand:${printingId}`,
    centerXFrac: plan.xFrac,
    centerYFrac: plan.yFrac,
    rotationDeg: plan.rotationDeg,
    cardHeightFrac: 0.32,
    perspectiveLeftFrac: 0,
    perspectiveRightFrac: 0,
    glarePositionFrac: 0.5,
    tags: [],
    isOccluder: true,
  };
}

export function applyBroadcastAugmentation(
  leftPlan: CompositeParams,
  rightPlan: CompositeParams,
  zoneMap: ZoneMap,
  augmentation: BroadcastCompositeAugmentation,
): ApplyBroadcastAugmentationResult {
  const occluderSpecs: OccluderImageSpec[] = [];

  let leftCards = applySleeves(leftPlan.cards, zoneMap, augmentation.sleeveZoneIds);
  let rightCards = applySleeves(rightPlan.cards, zoneMap, augmentation.sleeveZoneIds);

  leftCards = applyStackShims(leftCards, zoneMap, "left", augmentation.stackShimsByZoneKind, occluderSpecs);
  rightCards = applyStackShims(rightCards, zoneMap, "right", augmentation.stackShimsByZoneKind, occluderSpecs);

  augmentation.dice.forEach((d, i) => {
    const placement = dicePlacement(i, d, occluderSpecs);
    if (d.side === "left") leftCards = [...leftCards, placement];
    else rightCards = [...rightCards, placement];
  });

  if (augmentation.hand) {
    const placement = handPlacement(augmentation.hand, occluderSpecs);
    if (augmentation.hand.side === "left") leftCards = [...leftCards, placement];
    else rightCards = [...rightCards, placement];
  }

  return {
    leftPlan: { ...leftPlan, cards: leftCards },
    rightPlan: { ...rightPlan, cards: rightCards },
    occluderSpecs,
  };
}
