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
 *      angleDeg, noiseSeed — ALWAYS drawn (procedural background params),
 *      even on a composite that ends up using an external background
 *      instead (#244) — same "always draw, maybe discard" discipline as
 *      the per-card position draws below, so a backgroundsDir/
 *      externalBackgroundProbability config change never reshuffles any
 *      other draw's position
 *   4. external-background roll + index draw (#244) — ALWAYS drawn too,
 *      regardless of whether any backgrounds are configured/available
 *   5. lighting brightnessDelta, contrastDelta (once per composite, a
 *      scene-wide adjustment)
 *   6. per card, in order: rotationDeg, scale, a FRESH position
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

export interface ProceduralBackgroundParams {
  type: BackgroundType;
  colorA: [number, number, number];
  colorB: [number, number, number];
  angleDeg: number;
  noiseSeed: number;
}

/** A real external background photo (#244), selected from the sorted
 * `availableBackgrounds` list passed to planRun. `fileName` is the file
 * name WITHIN config.backgroundsDir only — never a full path, since this
 * module stays pure (resolving it to a real file is generate.ts's job, an
 * I/O boundary concern). `contentHash` is simply fileName's stem: the
 * importer (importBackgrounds.ts) names every file `<hash16>.<ext>`, so
 * this is a pure string derivation, not a re-hash. */
export interface ExternalBackgroundParams {
  type: "external";
  fileName: string;
  contentHash: string;
}

/** Reuses the existing `type` field as the discriminant (BackgroundType's
 * 4 procedural values, or the literal "external") rather than adding a
 * new `kind` field — keeps every pre-#244 procedural background literal
 * (e.g. `{ type: "solid", colorA, colorB, angleDeg, noiseSeed }`)
 * structurally valid with no changes. */
export type BackgroundParams = ProceduralBackgroundParams | ExternalBackgroundParams;

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
  availableBackgrounds: string[],
  rng: () => number,
): CompositeParams {
  const count = Math.min(availableCards.length, Math.max(1, intInRange(rng, config.cardsPerComposite)));
  const chosen = sampleWithoutReplacement(availableCards, count, rng);

  // Procedural background params: ALWAYS drawn (see this module's header),
  // even when this composite ends up selecting an external background
  // below instead.
  const backgroundTypeIndex = Math.floor(rng() * config.backgroundTypes.length);
  const proceduralType = config.backgroundTypes[backgroundTypeIndex];
  const colorA = drawColor(rng);
  const colorB = drawColor(rng);
  const angleDeg = rng() * 360;
  const noiseSeed = Math.floor(rng() * 1_000_000_000);

  // External-background selection (#244): also always drawn (2 rng calls),
  // regardless of config.backgroundsDir / availableBackgrounds — see this
  // module's header comment.
  const externalRoll = rng();
  const externalIndexDraw = rng();
  const useExternal = availableBackgrounds.length > 0 && externalRoll < config.externalBackgroundProbability;

  const background: BackgroundParams = useExternal
    ? (() => {
        const fileName = availableBackgrounds[Math.floor(externalIndexDraw * availableBackgrounds.length)];
        return { type: "external" as const, fileName, contentHash: fileName.replace(/\.[^.]+$/, "") };
      })()
    : { type: proceduralType, colorA, colorB, angleDeg, noiseSeed };

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
 * images found", a real precondition failure, never silently skipped).
 *
 * `availableBackgrounds` (#244) is the SORTED list of external background
 * file names to draw from — omit (or pass `[]`) for procedural-only runs;
 * this module never touches fs itself (cli.ts resolves the real list from
 * config.backgroundsDir). Selection is deterministic given seed + this
 * list; adding/removing a file changes the stream from that point on for
 * any composite whose external-index draw lands past the change — that's
 * an expected consequence of changing the run's inputs, not a bug. */
export function planRun(config: GeneratorConfig, availableCards: CardImageRef[], availableBackgrounds: string[] = []): CompositeParams[] {
  if (availableCards.length === 0) {
    throw new Error("planRun: no available card images to compose (availableCards is empty)");
  }

  const rng = createRng(config.seed);
  const plans: CompositeParams[] = [];
  for (let i = 0; i < config.compositesPerRun; i++) {
    const compositeId = `composite-${String(i).padStart(4, "0")}`;
    plans.push(planOneComposite(compositeId, config, availableCards, availableBackgrounds, rng));
  }
  return plans;
}
