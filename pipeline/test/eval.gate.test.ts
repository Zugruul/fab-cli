import { describe, it, expect } from "vitest";
import {
  assertValidGateConfig,
  checkAdjudicationCriticalBreach,
  checkGate,
  checkMinCorrectFloorBreaches,
  checkRegressionBreaches,
  InvalidGateConfigError,
} from "../src/eval/gate.js";
import { EVAL_SUITE_IDS, type EvalGateConfig, type EvalRunSummary, type EvalSuiteId, type SuiteResult } from "../src/eval/types.js";

function baseConfig(overrides: Partial<EvalGateConfig> = {}): EvalGateConfig {
  const perSuiteMinCorrectRate = Object.fromEntries(EVAL_SUITE_IDS.map((id) => [id, 0.5])) as Record<EvalSuiteId, number>;
  return {
    penalties: { correct: 1.0, abstained: -0.2, incorrect: -3.0 },
    adjudicationCriticalMaxIncorrectRate: 0.02,
    perSuiteMinCorrectRate,
    ...overrides,
  };
}

function suite(suiteId: EvalSuiteId, counts: SuiteResult["counts"], score = 0.5): SuiteResult {
  return { suiteId, counts, score, itemResults: [] };
}

function summaryWithAllSuites(overrides: Partial<Record<EvalSuiteId, SuiteResult["counts"]>> = {}): EvalRunSummary {
  return {
    runAt: "2026-08-02T00:00:00.000Z",
    suites: EVAL_SUITE_IDS.map((id) => suite(id, overrides[id] ?? { correct: 9, incorrect: 0, abstained: 1 })),
  };
}

describe("assertValidGateConfig", () => {
  it("accepts a well-formed config", () => {
    expect(() => assertValidGateConfig(baseConfig())).not.toThrow();
  });

  it("throws when perSuiteMinCorrectRate is missing an entry for one of the eight suites", () => {
    const config = baseConfig();
    const { "lore": _lore, ...rest } = config.perSuiteMinCorrectRate;
    expect(() => assertValidGateConfig({ ...config, perSuiteMinCorrectRate: rest as EvalGateConfig["perSuiteMinCorrectRate"] })).toThrow(
      InvalidGateConfigError,
    );
  });

  it("throws when a perSuiteMinCorrectRate value is out of [0,1]", () => {
    const config = baseConfig();
    expect(() =>
      assertValidGateConfig({ ...config, perSuiteMinCorrectRate: { ...config.perSuiteMinCorrectRate, lore: 1.5 } }),
    ).toThrow(InvalidGateConfigError);
  });

  it("throws when adjudicationCriticalMaxIncorrectRate is out of [0,1]", () => {
    expect(() => assertValidGateConfig(baseConfig({ adjudicationCriticalMaxIncorrectRate: -0.1 }))).toThrow(InvalidGateConfigError);
  });

  // --- RUNTIME GUARD on the §8.3 "incorrect ≫ abstain" asymmetry ---------

  it("throws when a bypassing-TS config inverts the asymmetry (incorrect penalty weaker than abstained)", () => {
    const bad = baseConfig({ penalties: { correct: 1.0, abstained: -3.0, incorrect: -0.2 } as EvalGateConfig["penalties"] });
    expect(() => assertValidGateConfig(bad)).toThrow(InvalidGateConfigError);
    expect(() => assertValidGateConfig(bad)).toThrow(/incorrect.*abstain/i);
  });

  it("throws when incorrect and abstained penalties are equal (not strictly worse)", () => {
    const bad = baseConfig({ penalties: { correct: 1.0, abstained: -1.0, incorrect: -1.0 } });
    expect(() => assertValidGateConfig(bad)).toThrow(InvalidGateConfigError);
  });

  it("throws when abstained penalty exceeds correct penalty", () => {
    const bad = baseConfig({ penalties: { correct: 1.0, abstained: 2.0, incorrect: -3.0 } });
    expect(() => assertValidGateConfig(bad)).toThrow(InvalidGateConfigError);
  });
});

describe("checkAdjudicationCriticalBreach (§8.5a)", () => {
  it("breaches when adjudication-critical incorrect rate exceeds the configured near-zero threshold", () => {
    const summary = summaryWithAllSuites({ "adjudication-critical": { correct: 90, incorrect: 5, abstained: 5 } });
    const breaches = checkAdjudicationCriticalBreach(summary, baseConfig({ adjudicationCriticalMaxIncorrectRate: 0.02 }));
    expect(breaches).toHaveLength(1);
    expect(breaches[0].clause).toBe("8.5a");
  });

  it("passes when adjudication-critical incorrect rate is within the threshold", () => {
    const summary = summaryWithAllSuites({ "adjudication-critical": { correct: 99, incorrect: 1, abstained: 0 } });
    expect(checkAdjudicationCriticalBreach(summary, baseConfig({ adjudicationCriticalMaxIncorrectRate: 0.02 }))).toHaveLength(0);
  });

  it("is a no-op when the adjudication-critical suite is absent from the summary", () => {
    const summary: EvalRunSummary = { runAt: "x", suites: [suite("lore", { correct: 1, incorrect: 0, abstained: 0 })] };
    expect(checkAdjudicationCriticalBreach(summary, baseConfig())).toHaveLength(0);
  });
});

describe("checkMinCorrectFloorBreaches (§8.5b)", () => {
  it("breaches for a suite below its configured floor", () => {
    const summary = summaryWithAllSuites({ lore: { correct: 2, incorrect: 8, abstained: 0 } });
    const breaches = checkMinCorrectFloorBreaches(summary, baseConfig());
    expect(breaches.some((b) => b.suiteId === "lore" && b.clause === "8.5b")).toBe(true);
  });

  it("an always-abstaining suite fails the floor (§8.5b's explicit example)", () => {
    const summary = summaryWithAllSuites({ "ood-rejection": { correct: 0, incorrect: 0, abstained: 20 } });
    // ood-rejection is scored via scoreAbstainExpected which never produces "abstained" —
    // but the gate math itself must still fail a suite with correctRate 0 regardless of
    // which bucket the non-correct items landed in.
    const breaches = checkMinCorrectFloorBreaches(summary, baseConfig());
    expect(breaches.some((b) => b.suiteId === "ood-rejection")).toBe(true);
  });

  it("passes every suite that clears its floor", () => {
    expect(checkMinCorrectFloorBreaches(summaryWithAllSuites(), baseConfig())).toHaveLength(0);
  });
});

describe("checkRegressionBreaches (§8.5c)", () => {
  it("breaches for a regressed suite", () => {
    const summary = summaryWithAllSuites();
    const loreSuite = summary.suites.find((s) => s.suiteId === "lore")!;
    loreSuite.score = 0.1;
    const { breaches } = checkRegressionBreaches(summary, [{ suiteId: "lore", score: 0.9 }]);
    expect(breaches.some((b) => b.suiteId === "lore" && b.clause === "8.5c")).toBe(true);
  });

  it("no breach when nothing regressed", () => {
    const { breaches } = checkRegressionBreaches(summaryWithAllSuites(), []);
    expect(breaches).toHaveLength(0);
  });
});

describe("checkGate", () => {
  it("passes a clean run with no previous release to compare against", () => {
    const result = checkGate(summaryWithAllSuites(), baseConfig());
    expect(result.passed).toBe(true);
    expect(result.breaches).toHaveLength(0);
  });

  it("fails when any of (a)/(b)/(c) breach, aggregating all breaches", () => {
    const summary = summaryWithAllSuites({
      "adjudication-critical": { correct: 50, incorrect: 40, abstained: 10 },
      lore: { correct: 1, incorrect: 9, abstained: 0 },
    });
    const result = checkGate(summary, baseConfig());
    expect(result.passed).toBe(false);
    expect(result.breaches.length).toBeGreaterThanOrEqual(2);
  });

  it("validates the config before doing anything else (invalid config throws, not a silent pass)", () => {
    const badConfig = baseConfig({ penalties: { correct: 1, abstained: -5, incorrect: -1 } });
    expect(() => checkGate(summaryWithAllSuites(), badConfig)).toThrow(InvalidGateConfigError);
  });
});
