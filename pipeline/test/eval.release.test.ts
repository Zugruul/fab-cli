/**
 * Release-gate enforcement policy (SPEC-APP.md §8.5, §13 invariant 8 —
 * APP-023, #135). gate.ts's checkGate() already produces the raw
 * (a)/(b)/(c) breach signals from an EvalRunSummary — these tests never
 * re-derive that threshold math (see gate.ts's own eval.gate.test.ts for
 * that coverage). This file tests the one policy layer §8.5 explicitly
 * defers to APP-023: version parsing, the major-version-bump detection,
 * and the human-audit-record requirement that gates major releases.
 */
import { describe, it, expect } from "vitest";
import {
  checkReleaseGate,
  extractAuditVerdict,
  isMajorVersionBump,
  parseSemver,
  InvalidVersionError,
} from "../src/eval/release.js";
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

describe("parseSemver", () => {
  it("parses a strict MAJOR.MINOR.PATCH string", () => {
    expect(parseSemver("2.0.0")).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseSemver("1.4.2")).toEqual({ major: 1, minor: 4, patch: 2 });
  });

  it("throws InvalidVersionError on a missing component", () => {
    expect(() => parseSemver("2.0")).toThrow(InvalidVersionError);
  });

  it("throws InvalidVersionError on a 'v'-prefixed string (not accepted — strict format only)", () => {
    expect(() => parseSemver("v2.0.0")).toThrow(InvalidVersionError);
  });

  it("throws InvalidVersionError on garbage input", () => {
    expect(() => parseSemver("not-a-version")).toThrow(InvalidVersionError);
    expect(() => parseSemver("")).toThrow(InvalidVersionError);
  });
});

describe("isMajorVersionBump", () => {
  it("is true when there is no previous version (first-ever release — no history to audit against)", () => {
    expect(isMajorVersionBump("1.0.0", null)).toBe(true);
  });

  it("is true when the candidate's major component is greater than the previous release's", () => {
    expect(isMajorVersionBump("2.0.0", "1.9.9")).toBe(true);
  });

  it("is false when the major component is unchanged (minor/patch bump only)", () => {
    expect(isMajorVersionBump("1.5.0", "1.4.2")).toBe(false);
    expect(isMajorVersionBump("1.4.3", "1.4.2")).toBe(false);
  });

  it("is false when the candidate's major component is lower (not a bump)", () => {
    expect(isMajorVersionBump("1.0.0", "2.0.0")).toBe(false);
  });

  it("throws InvalidVersionError when either version is malformed", () => {
    expect(() => isMajorVersionBump("bad", "1.0.0")).toThrow(InvalidVersionError);
    expect(() => isMajorVersionBump("1.0.0", "bad")).toThrow(InvalidVersionError);
  });
});

describe("extractAuditVerdict", () => {
  it("extracts APPROVE case-insensitively", () => {
    expect(extractAuditVerdict("## Sign-off\n\nVerdict: APPROVE\n")).toBe("APPROVE");
    expect(extractAuditVerdict("verdict: approve")).toBe("APPROVE");
  });

  it("extracts BLOCK", () => {
    expect(extractAuditVerdict("Verdict: BLOCK")).toBe("BLOCK");
  });

  it("returns null when there is no Verdict line", () => {
    expect(extractAuditVerdict("## Sign-off\n\nAuditor: nobody yet\n")).toBeNull();
  });

  it("returns null when the template placeholder is left unfilled", () => {
    expect(extractAuditVerdict("Verdict: <APPROVE | BLOCK>")).toBeNull();
  });
});

describe("checkReleaseGate — AC: seeded-bad candidate blocked (§8.5a)", () => {
  it("a candidate with adjudication-critical incorrects above threshold is blocked with the (a) reason, non-major version", () => {
    const summary = summaryWithAllSuites({
      "adjudication-critical": { correct: 50, incorrect: 40, abstained: 10 },
    });
    const result = checkReleaseGate({
      summary,
      config: baseConfig(),
      candidateVersion: "1.1.0",
      previousVersion: "1.0.0",
    });
    expect(result.passed).toBe(false);
    expect(result.isMajorVersion).toBe(false);
    expect(result.breaches.some((b) => b.clause === "8.5a")).toBe(true);
    // Non-major bump: no audit requirement should fire alongside it.
    expect(result.breaches.some((b) => b.clause === "8.5-audit")).toBe(false);
  });
});

describe("checkReleaseGate — AC: seeded always-abstain candidate blocked (§8.5b, not §8.5a)", () => {
  it("a candidate that abstains on everything is blocked via the coverage floor, never via the near-zero-incorrect check", () => {
    const summary = summaryWithAllSuites({
      "adjudication-critical": { correct: 0, incorrect: 0, abstained: 100 },
    });
    const result = checkReleaseGate({
      summary,
      config: baseConfig(),
      candidateVersion: "1.1.0",
      previousVersion: "1.0.0",
    });
    expect(result.passed).toBe(false);
    // Zero incorrects: (a) must NOT be the reason this is blocked.
    expect(result.breaches.some((b) => b.clause === "8.5a")).toBe(false);
    expect(result.breaches.some((b) => b.clause === "8.5b" && b.suiteId === "adjudication-critical")).toBe(true);
  });
});

describe("checkReleaseGate — major-version human-audit requirement", () => {
  const cleanSummary = summaryWithAllSuites();

  it("blocks a major-version candidate with no audit record path provided", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "2.0.0",
      previousVersion: "1.9.9",
    });
    expect(result.isMajorVersion).toBe(true);
    expect(result.passed).toBe(false);
    const audit = result.breaches.find((b) => b.clause === "8.5-audit");
    expect(audit).toBeDefined();
    expect(audit!.message).toMatch(/MAJOR version bump/);
    expect(audit!.message).toMatch(/no --audit-record path/);
  });

  it("blocks a major-version candidate whose audit record file is missing on disk", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "2.0.0",
      previousVersion: "1.9.9",
      auditRecordPath: "/nonexistent/audit.md",
      readAuditRecord: () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.passed).toBe(false);
    expect(result.breaches.find((b) => b.clause === "8.5-audit")!.message).toMatch(/not found/);
  });

  it("blocks a major-version candidate whose audit record has no completed sign-off verdict", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "2.0.0",
      previousVersion: "1.9.9",
      auditRecordPath: "/tmp/audit.md",
      readAuditRecord: () => "## Sign-off\n\nVerdict: <APPROVE | BLOCK>\n",
    });
    expect(result.passed).toBe(false);
    expect(result.breaches.find((b) => b.clause === "8.5-audit")!.message).toMatch(/no completed sign-off/);
  });

  it("blocks a major-version candidate whose human audit recorded verdict BLOCK", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "2.0.0",
      previousVersion: "1.9.9",
      auditRecordPath: "/tmp/audit.md",
      readAuditRecord: () => "## Sign-off\n\nVerdict: BLOCK\n",
    });
    expect(result.passed).toBe(false);
    expect(result.breaches.find((b) => b.clause === "8.5-audit")!.message).toMatch(/BLOCK/);
  });

  it("passes a major-version candidate with a completed APPROVE audit record and a clean run", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "2.0.0",
      previousVersion: "1.9.9",
      auditRecordPath: "/tmp/audit.md",
      readAuditRecord: () => "## Sign-off\n\nAuditor: Leo\nDate: 2026-08-02\nVerdict: APPROVE\n",
    });
    expect(result.passed).toBe(true);
    expect(result.breaches).toHaveLength(0);
  });

  it("does not require an audit record for a non-major bump, even when none is provided", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "1.10.0",
      previousVersion: "1.9.9",
    });
    expect(result.isMajorVersion).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("treats an omitted previousVersion the same as null (first release => major)", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "1.0.0",
    });
    expect(result.isMajorVersion).toBe(true);
  });

  it("aggregates a suite breach and a missing-audit breach together on a bad major-version run", () => {
    const badSummary = summaryWithAllSuites({
      "adjudication-critical": { correct: 50, incorrect: 40, abstained: 10 },
    });
    const result = checkReleaseGate({
      summary: badSummary,
      config: baseConfig(),
      candidateVersion: "2.0.0",
      previousVersion: "1.9.9",
    });
    expect(result.passed).toBe(false);
    expect(result.breaches.length).toBeGreaterThanOrEqual(2);
    expect(result.breaches.some((b) => b.clause === "8.5a")).toBe(true);
    expect(result.breaches.some((b) => b.clause === "8.5-audit")).toBe(true);
  });

  it("exposes the underlying GateCheckResult unmodified via .gate", () => {
    const result = checkReleaseGate({
      summary: cleanSummary,
      config: baseConfig(),
      candidateVersion: "1.10.0",
      previousVersion: "1.9.9",
    });
    expect(result.gate.passed).toBe(true);
    expect(result.gate.breaches).toHaveLength(0);
  });
});
