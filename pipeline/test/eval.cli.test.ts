import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calibrateCommand, parseCalibrateArgs, parseRunArgs, runCommand } from "../src/eval/cli.js";

describe("parseRunArgs", () => {
  it("defaults to --stub mode", () => {
    expect(parseRunArgs([]).stub).toBe(true);
  });

  it("--real flips stub off", () => {
    expect(parseRunArgs(["--real"]).stub).toBe(false);
  });

  it("accepts --dataset, --human-authored-dir, --config, --previous, --out overrides", () => {
    const args = parseRunArgs([
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

  it("defaults humanAuthoredDir to pipeline/eval-suites/human-adjudication", () => {
    expect(parseRunArgs([]).humanAuthoredDir.split(path.sep).slice(-2)).toEqual(["eval-suites", "human-adjudication"]);
  });
});

describe("parseCalibrateArgs", () => {
  it("requires embedder-version and scores to be explicitly passed (null default, not silently guessed)", () => {
    const args = parseCalibrateArgs([]);
    expect(args.embedderVersion).toBeNull();
    expect(args.scoresPath).toBeNull();
  });

  it("parses --embedder-version and --scores", () => {
    const args = parseCalibrateArgs(["--embedder-version", "text-embed-v1", "--scores", "/tmp/scores.json"]);
    expect(args.embedderVersion).toBe("text-embed-v1");
    expect(args.scoresPath).toBe("/tmp/scores.json");
  });
});

describe("eval run --stub (end to end, network-disabled gate contract)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-eval-cli-test-"));
    fs.mkdirSync(path.join(tmpDir, "human-adjudication"));
    fs.writeFileSync(
      path.join(tmpDir, "human-adjudication", "001.json"),
      JSON.stringify([
        {
          id: "ha-1",
          question: "human-authored question",
          expectedClaims: ["expected claim"],
          groundingChunkIds: ["rules/reprise/x"],
          sourceUrl: "https://fabtcg.com/example",
        },
      ]),
    );
    fs.writeFileSync(
      path.join(tmpDir, "eval.jsonl"),
      JSON.stringify({
        id: "q1",
        category: "lore",
        adjudicationCritical: false,
        exampleType: "qa",
        chunkId: "lore/x",
        payload: { id: "q1", chunk_id: "lore/x", question: "lore question", answer: "lore answer", cited_chunk_ids: ["lore/x"], entailmentChecked: true },
        split: "eval",
      }) + "\n",
    );
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

  it("runs end to end via the stub model + mocked judge and writes a passing gate result artifact", async () => {
    const outDir = path.join(tmpDir, "out");
    const exitCode = await runCommand([
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
    const gateResult = JSON.parse(fs.readFileSync(path.join(outDir, runDirName, "gate-result.json"), "utf8"));
    expect(gateResult.passed).toBe(true);

    const manifestFragment = JSON.parse(fs.readFileSync(path.join(outDir, runDirName, "manifest-eval-scores.json"), "utf8"));
    expect(manifestFragment.suites).toHaveLength(8);
  });

  it("--real fails loudly (no real ModelClient wired up — never silently falls back to the stub)", async () => {
    await expect(
      runCommand(["--real", "--config", path.join(tmpDir, "config.json"), "--out", path.join(tmpDir, "out")]),
    ).rejects.toThrow(/no real on-device ModelClient/);
  });
});

describe("eval calibrate (end to end)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-eval-cli-calibrate-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        penalties: { correct: 1, abstained: -0.2, incorrect: -3 },
        adjudicationCriticalMaxIncorrectRate: 0.02,
        perSuiteMinCorrectRate: {},
        calibration: { floorPercentile: 0.1, oodMarginRatio: 0.5 },
        rubricJudge: { engine: "claude-code-subscription", model: "claude-sonnet-5", maxTokens: 256, temperature: null },
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "scores.json"),
      JSON.stringify([
        { score: 0.9, correct: true },
        { score: 0.8, correct: true },
        { score: 0.3, correct: false },
      ]),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a calibration artifact keyed by embedder version", () => {
    calibrateCommand([
      "--embedder-version",
      "text-embed-v1",
      "--scores",
      path.join(tmpDir, "scores.json"),
      "--config",
      path.join(tmpDir, "config.json"),
      "--out",
      path.join(tmpDir, "calibration"),
    ]);
    const artifact = JSON.parse(fs.readFileSync(path.join(tmpDir, "calibration", "text-embed-v1.json"), "utf8"));
    expect(artifact.embedderVersion).toBe("text-embed-v1");
    expect(artifact.oodThreshold).toBeLessThan(artifact.retrievalFloor);
  });

  it("throws when --embedder-version is missing", () => {
    expect(() => calibrateCommand(["--scores", path.join(tmpDir, "scores.json")])).toThrow(/embedder-version/);
  });

  it("throws when --scores is missing", () => {
    expect(() => calibrateCommand(["--embedder-version", "v1"])).toThrow(/scores/);
  });
});
