#!/usr/bin/env tsx
/**
 * Eval harness CLI (SPEC-APP.md §8.3-§8.5). Two subcommands:
 *
 *   eval run [--stub] [--dataset <eval.jsonl>] [--human-authored-dir <dir>]
 *            [--config <eval-harness.json>] [--previous <evalScores.json>]
 *            [--out <dir>]
 *     Runs every suite and writes an EvalRunSummary + gate-check result.
 *     `--stub` (default, and the ONLY mode ever exercised by `npm run
 *     gate`, which runs the pipeline's vitest suite against fixtures, not
 *     this CLI) uses the deterministic stub model client + mocked rubric
 *     judge (stubClients.ts) with no network calls. A real on-device
 *     model client is deferred — see docs/design/app-E2.md's Out of
 *     scope — so omitting --stub without wiring a real client fails
 *     loudly rather than silently reusing the stub.
 *
 *   eval calibrate --embedder-version <id> --scores <file.json> [--out <dir>]
 *     Computes and records a calibration artifact (§9.7 abstention floor +
 *     §10.9 OOD threshold) from a JSON array of {score, correct} samples.
 */
import fs from "node:fs";
import path from "node:path";
import type { DatasetExample } from "../dataset/types.js";
import type { RubricJudgeConfig } from "./scorers/rubricJudge.js";
import { calibrate, type CalibrationConfig, type ScoreSample } from "./calibration.js";
import { checkGate } from "./gate.js";
import { toManifestEvalScores } from "./manifestIntegration.js";
import type { PreviousSuiteScore } from "./regression.js";
import { runEval } from "./runner.js";
import { createAlwaysCorrectMockRubricJudgeClient, createAlwaysCorrectStubModelClient } from "./stubClients.js";
import type { EvalGateConfig } from "./types.js";

const BASE = path.join(import.meta.dirname, "..", "..");

interface EvalHarnessConfigFile {
  penalties: EvalGateConfig["penalties"];
  adjudicationCriticalMaxIncorrectRate: number;
  perSuiteMinCorrectRate: EvalGateConfig["perSuiteMinCorrectRate"];
  calibration: CalibrationConfig;
  rubricJudge: RubricJudgeConfig & { engine: "claude-code-subscription" | "anthropic-api" };
}

function loadJsonlIfPresent<T>(filePath: string): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function loadConfig(configPath: string): EvalHarnessConfigFile {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as EvalHarnessConfigFile;
  return raw;
}

// --- eval run --------------------------------------------------------------

interface RunArgs {
  stub: boolean;
  datasetPath: string;
  humanAuthoredDir: string;
  configPath: string;
  previousPath: string | null;
  outDir: string;
}

export function parseRunArgs(argv: string[]): RunArgs {
  const args: RunArgs = {
    stub: true,
    datasetPath: path.join(BASE, "out", "dataset", "eval.jsonl"),
    humanAuthoredDir: path.join(BASE, "eval-suites", "human-adjudication"),
    configPath: path.join(BASE, "config", "eval-harness.json"),
    previousPath: null,
    outDir: path.join(BASE, "eval-runs"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stub") args.stub = true;
    else if (arg === "--real") args.stub = false;
    else if (arg === "--dataset" && argv[i + 1]) args.datasetPath = argv[++i];
    else if (arg === "--human-authored-dir" && argv[i + 1]) args.humanAuthoredDir = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--previous" && argv[i + 1]) args.previousPath = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
  }
  return args;
}

export async function runCommand(argv: string[]): Promise<number> {
  const args = parseRunArgs(argv);
  if (!args.stub) {
    throw new Error(
      "eval run --real: no real on-device ModelClient is wired up yet (deferred — remote compute for a real model run is unavailable; see docs/design/app-E2.md's Out of scope). Only --stub is supported today.",
    );
  }

  const config = loadConfig(args.configPath);
  const gateConfig: EvalGateConfig = {
    penalties: config.penalties,
    adjudicationCriticalMaxIncorrectRate: config.adjudicationCriticalMaxIncorrectRate,
    perSuiteMinCorrectRate: config.perSuiteMinCorrectRate,
  };

  const datasetExamples = loadJsonlIfPresent<DatasetExample>(args.datasetPath);
  const modelClient = createAlwaysCorrectStubModelClient();
  const rubricJudgeClient = createAlwaysCorrectMockRubricJudgeClient();

  const summary = await runEval({
    datasetExamples,
    humanAuthoredDir: args.humanAuthoredDir,
    modelClient,
    rubricJudgeClient,
    rubricJudgeConfig: config.rubricJudge,
    gateConfig,
  });

  const previous: PreviousSuiteScore[] = args.previousPath
    ? (JSON.parse(fs.readFileSync(args.previousPath, "utf8")) as { suites: PreviousSuiteScore[] }).suites
    : [];
  const gateResult = checkGate(summary, gateConfig, previous);

  const runDir = path.join(args.outDir, summary.runAt.replace(/[:.]/g, "-"));
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "manifest-eval-scores.json"), JSON.stringify(toManifestEvalScores(summary), null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "gate-result.json"), JSON.stringify(gateResult, null, 2) + "\n");

  for (const suite of summary.suites) {
    console.log(
      `${suite.suiteId}: correct=${suite.counts.correct} incorrect=${suite.counts.incorrect} abstained=${suite.counts.abstained} score=${suite.score.toFixed(3)}`,
    );
  }
  console.log(gateResult.passed ? "GATE: PASS" : `GATE: FAIL (${gateResult.breaches.length} breach(es))`);
  for (const breach of gateResult.breaches) console.log(`  [${breach.clause}] ${breach.suiteId}: ${breach.message}`);
  console.log(`-> ${runDir}`);

  return gateResult.passed ? 0 : 1;
}

// --- eval calibrate ----------------------------------------------------------

interface CalibrateArgs {
  embedderVersion: string | null;
  scoresPath: string | null;
  configPath: string;
  outDir: string;
}

export function parseCalibrateArgs(argv: string[]): CalibrateArgs {
  const args: CalibrateArgs = {
    embedderVersion: null,
    scoresPath: null,
    configPath: path.join(BASE, "config", "eval-harness.json"),
    outDir: path.join(BASE, "eval-runs", "calibration"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--embedder-version" && argv[i + 1]) args.embedderVersion = argv[++i];
    else if (arg === "--scores" && argv[i + 1]) args.scoresPath = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
  }
  return args;
}

export function calibrateCommand(argv: string[]): void {
  const args = parseCalibrateArgs(argv);
  if (!args.embedderVersion) throw new Error("eval calibrate: --embedder-version <id> is required");
  if (!args.scoresPath) throw new Error("eval calibrate: --scores <file.json> is required");

  const config = loadConfig(args.configPath);
  const samples = JSON.parse(fs.readFileSync(args.scoresPath, "utf8")) as ScoreSample[];
  const artifact = calibrate(args.embedderVersion, samples, config.calibration);

  fs.mkdirSync(args.outDir, { recursive: true });
  const outPath = path.join(args.outDir, `${args.embedderVersion}.json`);
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`retrievalFloor=${artifact.retrievalFloor} oodThreshold=${artifact.oodThreshold} (n=${artifact.sampleSize})`);
  console.log(`-> ${outPath}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "run") {
    const code = await runCommand(rest);
    process.exitCode = code;
    return;
  }
  if (command === "calibrate") {
    calibrateCommand(rest);
    return;
  }
  console.error(`unknown eval command: ${command ?? "(none)"} — expected "run" or "calibrate"`);
  process.exitCode = 1;
}

// Guarded so importing this module (e.g. from tests) never triggers a real
// run as a side effect — see qa/cli.ts's matching guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
