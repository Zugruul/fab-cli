/**
 * Synthetic-composite generator config (SPEC-APP.md §8.7b, APP-026 AC:
 * "generator config committed" with schema validation — not hardcoded
 * constants scattered in code). The committed default lives at
 * pipeline/config/composites-generation.json; validateGeneratorConfig
 * collects every violation rather than stopping at the first (mirrors
 * benchmark/validate.ts's style).
 */
import { BACKGROUND_TYPES } from "./types.js";
import type { BackgroundType } from "./types.js";

export interface RangeConfig {
  min: number;
  max: number;
}

export interface LightingConfig {
  brightnessDelta: RangeConfig;
  contrastDelta: RangeConfig;
}

export interface GeneratorConfig {
  /** Seed for the whole run's parameter stream (behavior/rng.ts's
   * createRng) — the single source of determinism (APP-026 AC). */
  seed: number;
  outputSize: { width: number; height: number };
  compositesPerRun: number;
  /** Inclusive integer bounds on how many cards are pasted per composite. */
  cardsPerComposite: RangeConfig;
  /** Fixed layout constant: a card's rendered height as a fraction of
   * canvas height BEFORE the per-card `scale` multiplier — not
   * randomized, unlike every other knob here. */
  baseCardHeightFraction: number;
  /** Per-card multiplier on baseCardHeightFraction. */
  scale: RangeConfig;
  rotationDeg: RangeConfig;
  overlapProbability: number;
  /** Distance (as a fraction of the previous card's own cardHeightFrac)
   * an overlapping card is offset from the previous card's center. */
  overlapOffsetFraction: RangeConfig;
  perspectiveProbability: number;
  /** Per-corner inset, as a fraction of the card's half-width — must stay
   * below 1 (an inset of 1 would collapse the top edge to a point). */
  perspectiveStrength: RangeConfig;
  glareProbability: number;
  sleeveProbability: number;
  lighting: LightingConfig;
  /** Non-empty subset of BACKGROUND_TYPES this run draws from. */
  backgroundTypes: BackgroundType[];
  /** Documented future-extension hook (APP-026 brief): a directory of
   * user-supplied real background images, used instead of a procedural
   * background with probability `externalBackgroundProbability` when
   * non-null and non-empty. Never vendored/committed — see background.ts's
   * loadExternalBackgroundRefs and cli.ts's doc comment. */
  backgroundsDir: string | null;
  externalBackgroundProbability: number;
  /** Minimum fraction of a card's own full geometric footprint that must
   * survive un-occluded AND on-canvas for that card to be INCLUDED in a
   * composite's label (#252) — see composites/types.ts's
   * CompositeCardLabel doc for the exact visibleFraction definition and
   * the "combine clipping + occlusion into one number" decision. Cards
   * below this are still rendered (pixels stay); only their ground-truth
   * label entry is dropped, so the detector never trains on a "ghost"
   * label with near-zero legible signal (the exact bug #252 reported: a
   * fully-hidden card still carrying a full amodal label).
   *
   * Inclusive at the boundary: a card at EXACTLY minVisibleFraction is
   * included (`visibleFraction >= minVisibleFraction`).
   *
   * Default 0.15 (config/composites-generation.json): a defensible
   * starting point, not an empirically tuned value for this specific
   * dataset — common detection-dataset practice excludes instances below
   * roughly 10-20% visible area as too occluded/truncated to provide
   * reliable training signal (in the same spirit as COCO-style
   * truncation/crowd handling). Revisit once real training runs give
   * evidence either way. */
  minVisibleFraction: number;
}

export type ValidateConfigResult = { valid: true; config: GeneratorConfig } | { valid: false; errors: string[] };

function isRange(v: unknown): v is RangeConfig {
  return typeof v === "object" && v !== null && typeof (v as RangeConfig).min === "number" && typeof (v as RangeConfig).max === "number";
}

function checkRange(errors: string[], name: string, v: unknown, opts: { minAllowed?: number; maxAllowed?: number; exclusiveMax?: boolean } = {}): void {
  if (!isRange(v)) {
    errors.push(`"${name}" must be an object {min: number, max: number}`);
    return;
  }
  const { min, max } = v;
  if (min > max) errors.push(`"${name}.min" must be <= "${name}.max" (got min=${min}, max=${max})`);
  if (opts.minAllowed !== undefined && min < opts.minAllowed) errors.push(`"${name}.min" must be >= ${opts.minAllowed}`);
  if (opts.maxAllowed !== undefined) {
    const violates = opts.exclusiveMax ? max >= opts.maxAllowed : max > opts.maxAllowed;
    if (violates) errors.push(`"${name}.max" must be ${opts.exclusiveMax ? "<" : "<="} ${opts.maxAllowed}`);
  }
}

function checkProbability(errors: string[], name: string, v: unknown): void {
  if (typeof v !== "number" || v < 0 || v > 1) errors.push(`"${name}" must be a number in [0, 1] (got ${JSON.stringify(v)})`);
}

/**
 * Validates a parsed config JSON object. Collects every violation rather
 * than stopping at the first, same style as benchmark/validate.ts.
 */
export function validateGeneratorConfig(raw: unknown): ValidateConfigResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["config is not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;

  if (!Number.isInteger(r.seed)) errors.push('"seed" must be an integer');

  if (typeof r.outputSize !== "object" || r.outputSize === null) {
    errors.push('"outputSize" must be an object {width, height}');
  } else {
    const os = r.outputSize as Record<string, unknown>;
    if (typeof os.width !== "number" || os.width <= 0) errors.push('"outputSize.width" must be a positive number');
    if (typeof os.height !== "number" || os.height <= 0) errors.push('"outputSize.height" must be a positive number');
  }

  if (typeof r.compositesPerRun !== "number" || r.compositesPerRun <= 0 || !Number.isInteger(r.compositesPerRun)) {
    errors.push('"compositesPerRun" must be a positive integer');
  }

  checkRange(errors, "cardsPerComposite", r.cardsPerComposite, { minAllowed: 1 });
  if (isRange(r.cardsPerComposite) && (!Number.isInteger(r.cardsPerComposite.min) || !Number.isInteger(r.cardsPerComposite.max))) {
    errors.push('"cardsPerComposite" bounds must be integers');
  }

  if (typeof r.baseCardHeightFraction !== "number" || r.baseCardHeightFraction <= 0 || r.baseCardHeightFraction >= 1) {
    errors.push('"baseCardHeightFraction" must be a number in (0, 1)');
  }

  // maxAllowed=3 (PR #238 review round 1, advisory): a card at 3x the
  // base rendered size is already generous headroom for augmentation
  // variety — this just stops a config typo (e.g. a stray extra digit)
  // from requesting an absurd scale, not a tight creative constraint.
  checkRange(errors, "scale", r.scale, { minAllowed: 0, maxAllowed: 3 });
  checkRange(errors, "rotationDeg", r.rotationDeg);
  checkProbability(errors, "overlapProbability", r.overlapProbability);
  checkRange(errors, "overlapOffsetFraction", r.overlapOffsetFraction, { minAllowed: 0 });
  checkProbability(errors, "perspectiveProbability", r.perspectiveProbability);
  checkRange(errors, "perspectiveStrength", r.perspectiveStrength, { minAllowed: 0, maxAllowed: 1, exclusiveMax: true });
  checkProbability(errors, "glareProbability", r.glareProbability);
  checkProbability(errors, "sleeveProbability", r.sleeveProbability);

  if (typeof r.lighting !== "object" || r.lighting === null) {
    errors.push('"lighting" must be an object {brightnessDelta, contrastDelta}');
  } else {
    const lighting = r.lighting as Record<string, unknown>;
    checkRange(errors, "lighting.brightnessDelta", lighting.brightnessDelta, { minAllowed: -1, maxAllowed: 1 });
    checkRange(errors, "lighting.contrastDelta", lighting.contrastDelta, { minAllowed: -1, maxAllowed: 1 });
  }

  if (!Array.isArray(r.backgroundTypes) || r.backgroundTypes.length === 0) {
    errors.push('"backgroundTypes" must be a non-empty array');
  } else {
    r.backgroundTypes.forEach((t, i) => {
      if (!(BACKGROUND_TYPES as readonly string[]).includes(t as string)) {
        errors.push(`"backgroundTypes[${i}]" must be one of ${BACKGROUND_TYPES.join("|")} (got ${JSON.stringify(t)})`);
      }
    });
  }

  if (r.backgroundsDir !== null && typeof r.backgroundsDir !== "string") {
    errors.push('"backgroundsDir" must be a string or null');
  }

  checkProbability(errors, "externalBackgroundProbability", r.externalBackgroundProbability);
  checkProbability(errors, "minVisibleFraction", r.minVisibleFraction);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, config: r as unknown as GeneratorConfig };
}
