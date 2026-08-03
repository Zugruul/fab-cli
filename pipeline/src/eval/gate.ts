/**
 * Release-gate signals (SPEC-APP.md §8.5 / §13 invariant 8). APP-023 wires
 * the actual enforcement policy (blocking release, human-audit workflow);
 * this module only PRODUCES the three signals from an EvalRunSummary —
 * (a) near-zero incorrect on adjudication-critical, (b) per-suite
 * minimum-correct floor, (c) regression vs the previous release — and a
 * combined exit-nonzero decision the harness's own `eval run` CLI command
 * uses for itself.
 */
import { correctRate, incorrectRate } from "./scoring.js";
import { detectRegressions, type PreviousSuiteScore, type RegressionResult } from "./regression.js";
import { EVAL_SUITE_IDS, type EvalGateConfig, type EvalRunSummary, type EvalSuiteId } from "./types.js";

export class InvalidGateConfigError extends Error {}

/**
 * RUNTIME GUARD on committed config, not just a TS type: `EvalGateConfig`
 * is read from JSON (pipeline/config/eval-harness.json), so TypeScript's
 * `Record<EvalSuiteId, number>` shape offers zero protection against a
 * config file that's missing an entry, or whose penalty weights invert
 * §8.3's "incorrect ≫ abstain" asymmetry. Both are checked here, loudly,
 * every time the config is loaded — never silently defaulted.
 */
export function assertValidGateConfig(config: EvalGateConfig): void {
  const missing = EVAL_SUITE_IDS.filter((id) => !(id in config.perSuiteMinCorrectRate));
  if (missing.length > 0) {
    throw new InvalidGateConfigError(`eval-harness config: perSuiteMinCorrectRate is missing entries for: ${missing.join(", ")}`);
  }
  for (const [suiteId, floor] of Object.entries(config.perSuiteMinCorrectRate)) {
    if (!(floor >= 0 && floor <= 1)) {
      throw new InvalidGateConfigError(`eval-harness config: perSuiteMinCorrectRate["${suiteId}"] must be in [0, 1], got ${floor}`);
    }
  }
  if (!(config.adjudicationCriticalMaxIncorrectRate >= 0 && config.adjudicationCriticalMaxIncorrectRate <= 1)) {
    throw new InvalidGateConfigError(
      `eval-harness config: adjudicationCriticalMaxIncorrectRate must be in [0, 1], got ${config.adjudicationCriticalMaxIncorrectRate}`,
    );
  }
  const { correct, incorrect, abstained } = config.penalties;
  // §8.3: "incorrect ≫ abstain" — incorrect must be a strictly worse
  // (lower) penalty than abstaining, which must in turn not exceed the
  // reward for a correct answer. A config that got these backwards would
  // train/grade the harness into REWARDING confident wrong answers over
  // honest abstention — exactly the failure mode §13 invariant 1 exists
  // to prevent — so it's refused outright rather than silently accepted.
  if (!(incorrect < abstained)) {
    throw new InvalidGateConfigError(
      `eval-harness config: penalties.incorrect (${incorrect}) must be strictly less than penalties.abstained (${abstained}) — SPEC-APP.md §8.3 requires "incorrect ≫ abstain"`,
    );
  }
  if (!(abstained <= correct)) {
    throw new InvalidGateConfigError(
      `eval-harness config: penalties.abstained (${abstained}) must not exceed penalties.correct (${correct})`,
    );
  }
}

export interface GateBreach {
  clause: "8.5a" | "8.5b" | "8.5c";
  suiteId: EvalSuiteId;
  message: string;
}

export function checkAdjudicationCriticalBreach(summary: EvalRunSummary, config: EvalGateConfig): GateBreach[] {
  const suite = summary.suites.find((s) => s.suiteId === "adjudication-critical");
  if (!suite) return [];
  const rate = incorrectRate(suite.counts);
  if (rate > config.adjudicationCriticalMaxIncorrectRate) {
    return [
      {
        clause: "8.5a",
        suiteId: "adjudication-critical",
        message: `adjudication-critical incorrect rate ${rate.toFixed(4)} exceeds the configured near-zero threshold ${config.adjudicationCriticalMaxIncorrectRate}`,
      },
    ];
  }
  return [];
}

export function checkMinCorrectFloorBreaches(summary: EvalRunSummary, config: EvalGateConfig): GateBreach[] {
  const breaches: GateBreach[] = [];
  for (const suite of summary.suites) {
    const floor = config.perSuiteMinCorrectRate[suite.suiteId];
    const rate = correctRate(suite.counts);
    if (rate < floor) {
      breaches.push({
        clause: "8.5b",
        suiteId: suite.suiteId,
        message: `suite "${suite.suiteId}" correct rate ${rate.toFixed(4)} is below the configured minimum-correct floor ${floor}`,
      });
    }
  }
  return breaches;
}

export function checkRegressionBreaches(
  summary: EvalRunSummary,
  previous: readonly PreviousSuiteScore[],
): { breaches: GateBreach[]; regressions: RegressionResult[] } {
  const regressions = detectRegressions(summary.suites, previous);
  const breaches: GateBreach[] = regressions
    .filter((r) => r.regressed)
    .map((r) => ({
      clause: "8.5c" as const,
      suiteId: r.suiteId,
      message: `suite "${r.suiteId}" regressed: ${r.currentScore} < previous release's ${r.previousScore}`,
    }));
  return { breaches, regressions };
}

export interface GateCheckResult {
  breaches: GateBreach[];
  regressions: RegressionResult[];
  passed: boolean;
}

export function checkGate(
  summary: EvalRunSummary,
  config: EvalGateConfig,
  previous: readonly PreviousSuiteScore[] = [],
): GateCheckResult {
  assertValidGateConfig(config);
  const { breaches: regressionBreaches, regressions } = checkRegressionBreaches(summary, previous);
  const breaches = [
    ...checkAdjudicationCriticalBreach(summary, config),
    ...checkMinCorrectFloorBreaches(summary, config),
    ...regressionBreaches,
  ];
  return { breaches, regressions, passed: breaches.length === 0 };
}
