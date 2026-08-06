/**
 * Zone-aware placement planning (#253): the zone-layout analog of
 * paramStream.ts's planRun, producing the SAME CompositeParams/
 * CardPlacement shape so it flows unchanged into the existing
 * renderComposite (compositor.ts) — no new rendering code is needed for
 * this generation mode.
 *
 * Determinism contract (mirrors paramStream.ts exactly): ONE seeded rng
 * (behavior/rng.ts's createRng) drives the ENTIRE run, in one fixed order,
 * so "same input -> byte-identical CompositeParams[]" holds here too (this
 * file lives under composites/, so it's swept by
 * composites.rngGuard.test.ts's static Math.random grep like every other
 * file in the module).
 *
 * Per-composite draw order (fixed): zones are visited in a fixed order
 * (sorted by zone id, independent of the zone map's own JSON authoring
 * order), and EVERY zone draws exactly 5 rng() calls regardless of its
 * kind or whether it ends up included — includeRoll, pickFrac, jitterX,
 * jitterY, jitterRotation — same "always draw, maybe discard" discipline
 * paramStream.ts documents for its own per-card draws, so toggling
 * arsenalFaceUpProbability (the only kind whose inclusion is ever
 * conditional) never reshuffles any other zone's pick/jitter within the
 * same composite.
 *
 * #268 PR #269 review round 1 BLOCKER 2: `coverageTrackersByKind` (optional,
 * one CoverageTracker per zone kind, sized to THAT kind's own eligible
 * pool — see coverageReport.ts's sibling doc) switches card selection for
 * a given kind from `pickDeterministic` (uniform-random) to
 * `coverageTracker.pickOneWithDraw(pickFrac)` — the SAME already-drawn
 * `pickFrac` value either path consumes, so this never adds or removes an
 * rng() call and the "5 rng() calls per zone, always" invariant above
 * holds unchanged whether or not a given kind (or any kind) has a tracker.
 * Coverage is a constraint WITHIN a kind's own bucket only — a tracker for
 * "weapon" can never influence which pool a "head" zone draws from, since
 * each kind's tracker only ever indexes into that SAME kind's own
 * `eligibleByKind[kind]` array (see planOneZoneComposite below).
 */
import { createRng } from "../../behavior/rng.js";
import { pickDeterministic } from "./semanticSelection.js";
import type { EligibleCard, SelectableZoneKind } from "./semanticSelection.js";
import { MANDATORY_ZONE_KINDS } from "./zoneMap.js";
import type { ZoneKind, ZoneMap, ZoneDefinition } from "./zoneMap.js";
import type { CardPlacement, CompositeParams } from "../paramStream.js";
import type { RangeConfig } from "../config.js";
import type { CoverageTracker } from "../coverageTracker.js";

export type { EligibleCard };

export interface ZoneLayoutConfig {
  seed: number;
  /** Card height as a fraction of the ZONE's own height (not canvas
   * height, unlike GeneratorConfig's baseCardHeightFraction) — zones are
   * fixed physical boxes with a roughly card-shaped aspect ratio, so
   * "mostly fills its own box" is the natural default (#253 decision). */
  cardHeightFraction: number;
  /** Signed offset range, as a fraction of the zone's own width/height —
   * see the magnitude-bound validation below for why |min|,|max| < 0.5. */
  jitterPositionFraction: RangeConfig;
  jitterRotationDeg: RangeConfig;
  arsenalFaceUpProbability: number;
  /** 0-based indices, within THIS call's returned array (not a global run
   * index), that force arsenal inclusion regardless of the probability
   * roll — how the demo run guarantees at least one face-up-arsenal
   * example without relying on a probabilistic draw. */
  guaranteedArsenalFaceUpIndices: number[];
  minVisibleFraction: number;
}

export type ValidateZoneLayoutConfigResult = { valid: true; config: ZoneLayoutConfig } | { valid: false; errors: string[] };

function isRange(v: unknown): v is RangeConfig {
  return typeof v === "object" && v !== null && typeof (v as RangeConfig).min === "number" && typeof (v as RangeConfig).max === "number";
}

function checkProbability(errors: string[], name: string, v: unknown): void {
  if (typeof v !== "number" || v < 0 || v > 1) errors.push(`"${name}" must be a number in [0, 1] (got ${JSON.stringify(v)})`);
}

/** Validates a parsed ZoneLayoutConfig JSON object, collecting every
 * violation rather than stopping at the first (mirrors config.ts's
 * validateGeneratorConfig style). */
export function validateZoneLayoutConfig(raw: unknown): ValidateZoneLayoutConfigResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["zone-layout config is not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;

  if (!Number.isInteger(r.seed)) errors.push('"seed" must be an integer');

  if (typeof r.cardHeightFraction !== "number" || r.cardHeightFraction <= 0 || r.cardHeightFraction > 1) {
    errors.push('"cardHeightFraction" must be a number in (0, 1]');
  }

  if (!isRange(r.jitterPositionFraction)) {
    errors.push('"jitterPositionFraction" must be an object {min: number, max: number}');
  } else {
    const { min, max } = r.jitterPositionFraction;
    if (min > max) errors.push('"jitterPositionFraction.min" must be <= "jitterPositionFraction.max"');
    // Boundary decision (#253, decided before the first test): a jitter
    // magnitude of 0.5 or more could move a card's center more than
    // halfway into a neighboring zone — bounded strictly under that.
    if (Math.abs(min) >= 0.5 || Math.abs(max) >= 0.5) {
      errors.push('"jitterPositionFraction" magnitude must stay strictly under 0.5 (a jittered card must not drift more than half a zone away)');
    }
  }

  if (!isRange(r.jitterRotationDeg)) {
    errors.push('"jitterRotationDeg" must be an object {min: number, max: number}');
  } else if (r.jitterRotationDeg.min > r.jitterRotationDeg.max) {
    errors.push('"jitterRotationDeg.min" must be <= "jitterRotationDeg.max"');
  }

  checkProbability(errors, "arsenalFaceUpProbability", r.arsenalFaceUpProbability);
  checkProbability(errors, "minVisibleFraction", r.minVisibleFraction);

  if (!Array.isArray(r.guaranteedArsenalFaceUpIndices)) {
    errors.push('"guaranteedArsenalFaceUpIndices" must be an array of non-negative integers');
  } else {
    r.guaranteedArsenalFaceUpIndices.forEach((v, i) => {
      if (!Number.isInteger(v) || (v as number) < 0) {
        errors.push(`"guaranteedArsenalFaceUpIndices[${i}]" must be a non-negative integer (got ${JSON.stringify(v)})`);
      }
    });
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, config: r as unknown as ZoneLayoutConfig };
}

export interface PlanZoneLayoutInput {
  config: ZoneLayoutConfig;
  zoneMap: ZoneMap;
  /** Catalog pools, one per zone kind actually present in `zoneMap`
   * (except "deck", which never draws from a pool — see cardBack below).
   * A missing/empty pool for a mandatory kind (or for "arsenal" whenever
   * an arsenal zone is present, regardless of arsenalFaceUpProbability)
   * throws loudly naming the kind and zone id — never a silent skip. */
  eligibleByKind: Partial<Record<SelectableZoneKind, EligibleCard[]>>;
  cardBack: { printingId: string; imagePath: string };
  matWidth: number;
  matHeight: number;
  background: { fileName: string; contentHash: string };
  compositesPerRun: number;
  compositeIdPrefix?: string;
  /** #268 PR #269 review round 1 BLOCKER 2, optional (default: none —
   * byte-identical to pre-#268 uniform-random selection for every kind).
   * A tracker present for kind K MUST be sized to
   * `eligibleByKind[K]!.length` — index i in the tracker corresponds to
   * `eligibleByKind[K]![i]`, exactly like paramStream.ts's
   * availableCards<->CoverageTracker correspondence. Reuse the SAME
   * tracker instance across every planZoneLayoutRun call that shares an
   * eligibleByKind (e.g. generateZoneRun.ts's single + near + far
   * sub-runs) so appearance counts accumulate across the whole run, not
   * reset per sub-run. */
  coverageTrackersByKind?: Partial<Record<SelectableZoneKind, CoverageTracker>>;
}

function inRange(rng: () => number, range: RangeConfig): number {
  return range.min + rng() * (range.max - range.min);
}

/** Every zone kind actually mandatory FOR THIS zone map: mandatory kinds
 * that have a zone present, plus "arsenal" whenever an arsenal zone is
 * present (eager validation — never a probabilistic surprise later). */
function requiredKindsFor(zoneMap: ZoneMap): SelectableZoneKind[] {
  const present = new Set(zoneMap.zones.map((z) => z.kind));
  const required: SelectableZoneKind[] = [];
  for (const kind of MANDATORY_ZONE_KINDS) {
    if (kind !== "deck" && present.has(kind)) required.push(kind as SelectableZoneKind);
  }
  if (present.has("arsenal")) required.push("arsenal");
  return required;
}

function assertEligibilityCoversZoneMap(zoneMap: ZoneMap, eligibleByKind: PlanZoneLayoutInput["eligibleByKind"]): void {
  for (const kind of requiredKindsFor(zoneMap)) {
    const pool = eligibleByKind[kind];
    if (!pool || pool.length === 0) {
      const zoneIds = zoneMap.zones
        .filter((z) => z.kind === kind)
        .map((z) => z.id)
        .join(", ");
      throw new Error(
        `planZoneLayoutRun: zero eligible cards for zone kind "${kind}" (zone id(s): ${zoneIds}) — ` +
          "cannot plan a zone-layout composite without at least one candidate card for this slot",
      );
    }
  }
}

function planOneZoneComposite(
  compositeId: string,
  compositeIndex: number,
  input: PlanZoneLayoutInput,
  rng: () => number,
): CompositeParams {
  const { config, cardBack } = input;
  const sortedZones = [...input.zoneMap.zones].sort((a, b) => a.id.localeCompare(b.id));
  const cards: CardPlacement[] = [];

  for (const zone of sortedZones) {
    // Always drawn, regardless of kind or eventual inclusion — see this
    // module's header for why.
    const includeRoll = rng();
    const pickFrac = rng();
    const jitterXFrac = inRange(rng, config.jitterPositionFraction);
    const jitterYFrac = inRange(rng, config.jitterPositionFraction);
    const jitterRotDeg = inRange(rng, config.jitterRotationDeg);

    const arsenalGuaranteed = zone.kind === "arsenal" && config.guaranteedArsenalFaceUpIndices.includes(compositeIndex);
    const include = zone.kind === "arsenal" ? arsenalGuaranteed || includeRoll < config.arsenalFaceUpProbability : true;
    if (!include) continue;

    let printingId: string;
    let imagePath: string;
    let isCardBack = false;
    if (zone.kind === "deck") {
      printingId = cardBack.printingId;
      imagePath = cardBack.imagePath;
      isCardBack = true;
    } else {
      const pool = input.eligibleByKind[zone.kind as SelectableZoneKind];
      if (!pool || pool.length === 0) {
        // Defensive — assertEligibilityCoversZoneMap already validates
        // this eagerly for every kind requiredKindsFor() names, but a
        // caller could still hand-build an input bypassing that (e.g. in
        // a unit test); fail loudly here too rather than reading past the
        // array end.
        throw new Error(`planZoneLayoutRun: zero eligible cards for zone kind "${zone.kind}" (zone id "${zone.id}")`);
      }
      // #268 BLOCKER 2: a tracker for THIS kind indexes ONLY into THIS
      // kind's own pool — coverage can never bypass which bucket a zone
      // draws from. Reuses the SAME pickFrac either branch consumes, so
      // no extra rng() call is ever introduced (see this module's header).
      const tracker = input.coverageTrackersByKind?.[zone.kind as SelectableZoneKind];
      const trackedIdx = tracker ? tracker.pickOneWithDraw(pickFrac) : null;
      const chosen = trackedIdx !== null ? pool[trackedIdx] : pickDeterministic(pool, pickFrac);
      printingId = chosen.printingId;
      imagePath = chosen.imagePath;
    }

    const zoneCenterX = zone.rect.xFrac + zone.rect.wFrac / 2;
    const zoneCenterY = zone.rect.yFrac + zone.rect.hFrac / 2;

    cards.push({
      printingId,
      imagePath,
      centerXFrac: zoneCenterX + jitterXFrac * zone.rect.wFrac,
      centerYFrac: zoneCenterY + jitterYFrac * zone.rect.hFrac,
      rotationDeg: jitterRotDeg,
      cardHeightFrac: config.cardHeightFraction * zone.rect.hFrac,
      // Flat top-down game-state photography, not an augmented card-
      // scatter photo — no keystone/sleeve/glare augmentation in this
      // mode (#253 scope decision, out of the brief).
      perspectiveLeftFrac: 0,
      perspectiveRightFrac: 0,
      glarePositionFrac: 0.5,
      tags: [],
      isCardBack,
    });
  }

  return {
    compositeId,
    width: input.matWidth,
    height: input.matHeight,
    background: { type: "external", fileName: input.background.fileName, contentHash: input.background.contentHash },
    // No lighting augmentation in zone-layout mode (#253 scope decision) —
    // this is a wholly separate planning function with its own fixed draw
    // order, so there is no legacy rng-stream shape to preserve by
    // drawing-and-discarding a value here.
    lighting: { brightnessDelta: 0, contrastDelta: 0 },
    // Same scope decision, #289: no blur augmentation in zone-layout mode
    // either — this planning function's own fixed draw order has never
    // drawn a lighting or blur value, so there's nothing to preserve here.
    blur: null,
    cards,
  };
}

/** Plans `input.compositesPerRun` zone-layout composites, deterministically
 * from `input.config.seed`. See this module's header for the full
 * determinism contract and per-zone draw order. */
export function planZoneLayoutRun(input: PlanZoneLayoutInput): CompositeParams[] {
  assertEligibilityCoversZoneMap(input.zoneMap, input.eligibleByKind);

  const rng = createRng(input.config.seed);
  const prefix = input.compositeIdPrefix ?? "composite";
  const plans: CompositeParams[] = [];
  for (let i = 0; i < input.compositesPerRun; i++) {
    const compositeId = `${prefix}-${String(i).padStart(4, "0")}`;
    plans.push(planOneZoneComposite(compositeId, i, input, rng));
  }
  return plans;
}
