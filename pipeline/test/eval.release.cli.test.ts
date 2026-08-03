/**
 * `eval release` CLI subcommand (SPEC-APP.md §8.5 — APP-023, #135). Wires
 * checkReleaseGate (src/eval/release.ts) into the same stub-model /
 * mocked-judge, network-disabled harness `eval run` already exercises
 * (src/eval/cli.ts) — this file only tests the CLI plumbing (arg parsing,
 * exit codes, written artifacts); the gate decision logic itself is
 * covered by eval.release.test.ts against EvalRunSummary fixtures.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseReleaseArgs, releaseCommand } from "../src/eval/cli.js";

describe("parseReleaseArgs", () => {
  it("requires --version (null default, not silently guessed)", () => {
    expect(parseReleaseArgs([]).version).toBeNull();
  });

  it("parses --version, --previous-version, --audit-record", () => {
    const args = parseReleaseArgs([
      "--version",
      "2.0.0",
      "--previous-version",
      "1.9.9",
      "--audit-record",
      "/tmp/audit.md",
    ]);
    expect(args.version).toBe("2.0.0");
    expect(args.previousVersion).toBe("1.9.9");
    expect(args.auditRecordPath).toBe("/tmp/audit.md");
  });

  it("defaults previousVersion and auditRecordPath to null", () => {
    const args = parseReleaseArgs(["--version", "1.0.0"]);
    expect(args.previousVersion).toBeNull();
    expect(args.auditRecordPath).toBeNull();
  });

  it("accepts the same --dataset/--human-authored-dir/--config/--previous/--out overrides as `eval run`", () => {
    const args = parseReleaseArgs([
      "--version",
      "1.0.0",
      "--dataset",
      "/tmp/eval.jsonl",
      "--human-authored-dir",
      "/tmp/ha",
      "--config",
      "/tmp/config.json",
      "--previous",
      "/tmp/prev.json",
      "--out",
      "/tmp/out",
    ]);
    expect(args.datasetPath).toBe("/tmp/eval.jsonl");
    expect(args.humanAuthoredDir).toBe("/tmp/ha");
    expect(args.configPath).toBe("/tmp/config.json");
    expect(args.previousPath).toBe("/tmp/prev.json");
    expect(args.outDir).toBe("/tmp/out");
  });
});

describe("eval release --stub (end to end, network-disabled)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-eval-release-cli-test-"));
    fs.mkdirSync(path.join(tmpDir, "human-adjudication"));
    fs.writeFileSync(path.join(tmpDir, "human-adjudication", "001.json"), JSON.stringify([]));
    fs.writeFileSync(path.join(tmpDir, "eval.jsonl"), "");
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        penalties: { correct: 1.0, abstained: -0.2, incorrect: -3.0 },
        adjudicationCriticalMaxIncorrectRate: 0.02,
        perSuiteMinCorrectRate: {
          "adjudication-critical": 0,
          interactions: 0,
          lore: 0,
          "citation-validity": 0,
          "abstention-quality": 0,
          "ood-rejection": 0,
          "distractor-robustness": 0,
          "human-authored-adjudication": 0,
        },
        calibration: { floorPercentile: 0.1, oodMarginRatio: 0.5 },
        rubricJudge: { engine: "claude-code-subscription", model: "claude-sonnet-5", maxTokens: 256, temperature: null },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when --version is missing (never silently skips the release-vs-dev-run distinction)", async () => {
    await expect(
      releaseCommand([
        "--dataset",
        path.join(tmpDir, "eval.jsonl"),
        "--human-authored-dir",
        path.join(tmpDir, "human-adjudication"),
        "--config",
        path.join(tmpDir, "config.json"),
        "--out",
        path.join(tmpDir, "out"),
      ]),
    ).rejects.toThrow(/--version/);
  });

  it("a non-major bump with an all-zero-floor config and empty suites passes and writes release-gate-result.json", async () => {
    const outDir = path.join(tmpDir, "out");
    const exitCode = await releaseCommand([
      "--version",
      "1.1.0",
      "--previous-version",
      "1.0.0",
      "--dataset",
      path.join(tmpDir, "eval.jsonl"),
      "--human-authored-dir",
      path.join(tmpDir, "human-adjudication"),
      "--config",
      path.join(tmpDir, "config.json"),
      "--out",
      outDir,
    ]);
    expect(exitCode).toBe(0);

    const [runDirName] = fs.readdirSync(outDir);
    const releaseGateResult = JSON.parse(fs.readFileSync(path.join(outDir, runDirName, "release-gate-result.json"), "utf8"));
    expect(releaseGateResult.passed).toBe(true);
    expect(releaseGateResult.isMajorVersion).toBe(false);
  });

  it("a major bump with no --audit-record is blocked and exits nonzero", async () => {
    const outDir = path.join(tmpDir, "out");
    const exitCode = await releaseCommand([
      "--version",
      "2.0.0",
      "--previous-version",
      "1.0.0",
      "--dataset",
      path.join(tmpDir, "eval.jsonl"),
      "--human-authored-dir",
      path.join(tmpDir, "human-adjudication"),
      "--config",
      path.join(tmpDir, "config.json"),
      "--out",
      outDir,
    ]);
    expect(exitCode).toBe(1);

    const [runDirName] = fs.readdirSync(outDir);
    const releaseGateResult = JSON.parse(fs.readFileSync(path.join(outDir, runDirName, "release-gate-result.json"), "utf8"));
    expect(releaseGateResult.passed).toBe(false);
    expect(releaseGateResult.breaches.some((b: { clause: string }) => b.clause === "8.5-audit")).toBe(true);
  });

  it("a major bump with a completed APPROVE audit record passes", async () => {
    const outDir = path.join(tmpDir, "out");
    const auditPath = path.join(tmpDir, "audit.md");
    fs.writeFileSync(auditPath, "## Sign-off\n\nAuditor: Leo\nDate: 2026-08-02\nVerdict: APPROVE\n");

    const exitCode = await releaseCommand([
      "--version",
      "2.0.0",
      "--previous-version",
      "1.0.0",
      "--audit-record",
      auditPath,
      "--dataset",
      path.join(tmpDir, "eval.jsonl"),
      "--human-authored-dir",
      path.join(tmpDir, "human-adjudication"),
      "--config",
      path.join(tmpDir, "config.json"),
      "--out",
      outDir,
    ]);
    expect(exitCode).toBe(0);
  });
});
