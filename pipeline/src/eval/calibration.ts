/**
 * Per-embedder-version calibration (SPEC-APP.md §9.7's retrieval-
 * confidence abstention floor, §10.9's stricter OOD fast-path threshold)
 * from eval-set score distributions — never hardcoded. Pure function of
 * (embedderVersion, samples, config); the CLI records the result as a
 * versioned artifact (writeCalibrationArtifact).
 *
 * Method: `retrievalFloor` is the `floorPercentile`-th percentile of
 * retrieval scores among items the model answered CORRECTLY — the lowest
 * confidence level still empirically associated with a right answer, with
 * `floorPercentile` a safety margin below the very bottom of that
 * distribution (not its minimum, which would be one outlier away from
 * being too permissive). `oodThreshold` is `retrievalFloor *
 * oodMarginRatio` (`oodMarginRatio` in (0, 1)) — strictly below the floor
 * by construction, matching §10.9's "well below the abstention floor" and
 * the SAME invariant @fab/manifest-schema's KnowledgePackManifestSchema
 * already enforces at the schema level (oodThreshold < retrievalFloor) —
 * this calibrator is expected to feed that exact field pair.
 */

export interface ScoreSample {
  /** Retrieval-confidence score for one eval item (e.g. top-hit
   * cosine/BM25-hybrid score — the harness treats this as an opaque
   * number; the retrieval engine, §9.7, is out of this task's scope). */
  score: number;
  /** Whether the model under eval answered this item correctly. */
  correct: boolean;
}

export interface CalibrationConfig {
  /** 0..1 — percentile of CORRECT items' scores used as the abstention
   * floor (e.g. 0.1 = 10th percentile: only 10% of genuinely-correct
   * answers scored below this, so abstaining below it costs little
   * recall). */
  floorPercentile: number;
  /** 0..1, exclusive of both ends — retrievalFloor * this ratio =
   * oodThreshold. Must be < 1 so oodThreshold lands strictly below
   * retrievalFloor. */
  oodMarginRatio: number;
}

export interface CalibrationArtifact {
  embedderVersion: string;
  retrievalFloor: number;
  oodThreshold: number;
  computedAt: string;
  sampleSize: number;
  method: string;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const frac = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * frac;
}

export function calibrate(
  embedderVersion: string,
  samples: readonly ScoreSample[],
  config: CalibrationConfig,
  now: () => string = () => new Date().toISOString(),
): CalibrationArtifact {
  if (embedderVersion.trim().length === 0) {
    throw new Error("calibrate: embedderVersion must be a non-empty string");
  }
  if (!(config.floorPercentile >= 0 && config.floorPercentile <= 1)) {
    throw new Error(`calibrate: floorPercentile must be in [0, 1], got ${config.floorPercentile}`);
  }
  if (!(config.oodMarginRatio > 0 && config.oodMarginRatio < 1)) {
    throw new Error(`calibrate: oodMarginRatio must be strictly between 0 and 1, got ${config.oodMarginRatio}`);
  }

  const correctScores = samples.filter((s) => s.correct).map((s) => s.score).sort((a, b) => a - b);
  if (correctScores.length === 0) {
    throw new Error(
      "calibrate: no correctly-answered eval samples to calibrate against — cannot derive a retrieval floor from zero data points (never falls back to a hardcoded default, per SPEC-APP.md §9.7)",
    );
  }

  const retrievalFloor = percentile(correctScores, config.floorPercentile);
  const oodThreshold = retrievalFloor * config.oodMarginRatio;

  // RUNTIME GUARD, not just a type: §10.9 requires oodThreshold STRICTLY
  // below retrievalFloor. oodMarginRatio < 1 guarantees this algebraically
  // when retrievalFloor > 0, but a floor of exactly 0 (or negative, if a
  // caller ever feeds negative similarity scores) would make
  // oodThreshold === retrievalFloor === 0 and silently violate the
  // invariant — refuse to emit an artifact that would fail
  // KnowledgePackManifestSchema's own oodThreshold-vs-retrievalFloor check
  // downstream, rather than let a bad artifact get written and discovered
  // later at manifest-build time.
  if (!(oodThreshold < retrievalFloor)) {
    throw new Error(
      `calibrate: computed oodThreshold (${oodThreshold}) is not strictly below retrievalFloor (${retrievalFloor}) — refusing to emit an invalid calibration artifact (SPEC-APP.md §10.9)`,
    );
  }

  return {
    embedderVersion,
    retrievalFloor,
    oodThreshold,
    computedAt: now(),
    sampleSize: samples.length,
    method: `floorPercentile=${config.floorPercentile},oodMarginRatio=${config.oodMarginRatio}`,
  };
}
