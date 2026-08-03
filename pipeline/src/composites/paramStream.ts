/**
 * Seeded parameter stream for one generation run (SPEC-APP.md §8.7b,
 * APP-026 AC: "deterministic given seed"). Every random decision for the
 * entire run — background choice, per-card placement/rotation/scale/
 * perspective/lighting/glare/sleeve rolls — is drawn HERE, in one fixed
 * order, from behavior/rng.ts's seeded createRng (mulberry32). No other
 * file in composites/ calls into randomness at all (enforced by
 * test/composites.rngGuard.test.ts's static grep for Math.random): every
 * downstream module (geometry, background, warp, compositor) is a pure
 * function of the CompositeParams this module produces, which is why
 * "same seed + same config -> byte-identical output" holds for the whole
 * pipeline, not just this file.
 *
 * Per-composite draw order (fixed, so re-running with an unchanged config
 * always consumes the rng identically):
 *   1. card count (uniform int in cardsPerComposite range, clamped to the
 *      number of available cards)
 *   2. that many distinct cards, sampled without replacement (reusing
 *      behavior/rng.ts's sampleWithoutReplacement)
 *   3. background type index, colorA (3 draws), colorB (3 draws),
 *      angleDeg, noiseSeed
 *   4. lighting brightnessDelta, contrastDelta (once per composite, a
 *      scene-wide adjustment)
 *   5. per card, in order: rotationDeg, scale, a FRESH position
 *      (centerXFrac, centerYFrac) always drawn (even when about to be
 *      discarded in favor of an overlap position) so the stream's shape
 *      doesn't depend on which branch downstream config knobs select,
 *      then the overlap roll + offset angle/distance, then the
 *      perspective roll + left/right insets, then sleeve roll, then
 *      glare roll + position.
 */
import { createRng, sampleWithoutReplacement } from "../behavior/rng.js";
import type { BackgroundType } from "./types.js";
import type { QuadTag } from "./types.js";
import type { GeneratorConfig, RangeConfig } from "./config.js";

export interface CardImageRef {
  printingId: string;
  imagePath: string;
}

export interface CardPlacement {
  printingId: string;
  imagePath: string;
  centerXFrac: number;
  centerYFrac: number;
  rotationDeg: number;
  cardHeightFrac: number;
  perspectiveLeftFrac: number;
  perspectiveRightFrac: number;
  /** Meaningful only when tags includes "glare". */
  glarePositionFrac: number;
  tags: QuadTag[];
}

export interface BackgroundParams {
  type: BackgroundType;
  colorA: [number, number, number];
  colorB: [number, number, number];
  angleDeg: number;
  noiseSeed: number;
}

export interface LightingParams {
  brightnessDelta: number;
  contrastDelta: number;
}

export interface CompositeParams {
  compositeId: string;
  width: number;
  height: number;
  background: BackgroundParams;
  lighting: LightingParams;
  cards: CardPlacement[];
}

function inRange(rng: () => number, range: RangeConfig): number {
  return range.min + rng() * (range.max - range.min);
}

function intInRange(rng: () => number, range: RangeConfig): number {
  return Math.floor(inRange(rng, { min: range.min, max: range.max + 1 }));
}

function drawColor(rng: () => number): [number, number, number] {
  return [Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256)];
}

function planOneComposite(
  compositeId: string,
  config: GeneratorConfig,
  availableCards: CardImageRef[],
  rng: () => number,
): CompositeParams {
  const count = Math.min(availableCards.length, Math.max(1, intInRange(rng, config.cardsPerComposite)));
  const chosen = sampleWithoutReplacement(availableCards, count, rng);

  const backgroundTypeIndex = Math.floor(rng() * config.backgroundTypes.length);
  const background: BackgroundParams = {
    type: config.backgroundTypes[backgroundTypeIndex],
    colorA: drawColor(rng),
    colorB: drawColor(rng),
    angleDeg: rng() * 360,
    noiseSeed: Math.floor(rng() * 1_000_000_000),
  };

  const lighting: LightingParams = {
    brightnessDelta: inRange(rng, config.lighting.brightnessDelta),
    contrastDelta: inRange(rng, config.lighting.contrastDelta),
  };

  const cards: CardPlacement[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const ref = chosen[i];
    const rotationDeg = inRange(rng, config.rotationDeg);
    const scale = inRange(rng, config.scale);
    const cardHeightFrac = config.baseCardHeightFraction * scale;

    // Always draw a fresh position, even if the overlap branch below ends
    // up discarding it — keeps the rng consumption shape independent of
    // which branch is taken for a given card index (a config tweak to
    // overlapProbability alone doesn't reshuffle later cards' draws).
    const freshX = rng();
    const freshY = rng();
    const overlapRoll = rng();
    const overlapAngle = rng() * 2 * Math.PI;
    const overlapDist = inRange(rng, config.overlapOffsetFraction);

    let centerXFrac: number;
    let centerYFrac: number;
    const prev = cards[i - 1];
    if (i > 0 && overlapRoll < config.overlapProbability && prev) {
      const offset = overlapDist * prev.cardHeightFrac;
      centerXFrac = prev.centerXFrac + Math.cos(overlapAngle) * offset;
      centerYFrac = prev.centerYFrac + Math.sin(overlapAngle) * offset;
    } else {
      centerXFrac = freshX;
      centerYFrac = freshY;
    }

    const perspectiveRoll = rng();
    const perspectiveLeftDraw = inRange(rng, config.perspectiveStrength);
    const perspectiveRightDraw = inRange(rng, config.perspectiveStrength);
    const hasPerspective = perspectiveRoll < config.perspectiveProbability;

    const sleeveRoll = rng();
    const glareRoll = rng();
    const glarePositionFrac = rng();

    const tags: QuadTag[] = [];
    if (sleeveRoll < config.sleeveProbability) tags.push("sleeved");
    if (glareRoll < config.glareProbability) tags.push("glare");

    cards.push({
      printingId: ref.printingId,
      imagePath: ref.imagePath,
      centerXFrac,
      centerYFrac,
      rotationDeg,
      cardHeightFrac,
      perspectiveLeftFrac: hasPerspective ? perspectiveLeftDraw : 0,
      perspectiveRightFrac: hasPerspective ? perspectiveRightDraw : 0,
      glarePositionFrac,
      tags,
    });
  }

  return {
    compositeId,
    width: config.outputSize.width,
    height: config.outputSize.height,
    background,
    lighting,
    cards,
  };
}

/** Plans a full run's worth of composites, deterministically from
 * `config.seed`. Throws when `availableCards` is empty — there is nothing
 * to compose (see cli.ts's caller: this reflects "no downloaded card
 * images found", a real precondition failure, never silently skipped). */
export function planRun(config: GeneratorConfig, availableCards: CardImageRef[]): CompositeParams[] {
  if (availableCards.length === 0) {
    throw new Error("planRun: no available card images to compose (availableCards is empty)");
  }

  const rng = createRng(config.seed);
  const plans: CompositeParams[] = [];
  for (let i = 0; i < config.compositesPerRun; i++) {
    const compositeId = `composite-${String(i).padStart(4, "0")}`;
    plans.push(planOneComposite(compositeId, config, availableCards, rng));
  }
  return plans;
}
