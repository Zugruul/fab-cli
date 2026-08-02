#!/usr/bin/env tsx
/**
 * Thin CLI over runner.ts (APP-020): run/resume/status subcommands for
 * driving E2 training runs through the slm-training capability bundle.
 * parseArgs is pure and unit-tested; main()'s real dispatch (RealDispatcher
 * shelling to remote-compute.py) is not exercised in tests, mirroring
 * dispatch/cli.ts's split.
 *
 * Usage:
 *   tsx src/training/cli.ts run --run-id <id> --tier 1.7B|0.6B --stage sft|dpo \
 *     --dataset <path> --seed <n> --inputs <dir> --lockfile <path> --gpu-check <path> \
 *     [--cuda <ver>] [--driver <ver>] [--resource storm590x] [--capability-job slm-training:<stage>] \
 *     [--max-steps N | --num-epochs N] [--max-seq-length N] [--load-in-4bit true|false] \
 *     [--lora-r N] [--lora-alpha N] [--lora-dropout F] [--runs-dir <dir>]
 *   tsx src/training/cli.ts resume --run-id <id> --inputs <dir> --lockfile <path> --gpu-check <path> \
 *     [--cuda <ver>] [--driver <ver>] [--resource storm590x] --capability-job <name> [--runs-dir <dir>]
 *   tsx src/training/cli.ts status --run-id <id> [--runs-dir <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { run, resume } from "./runner.js";
import { RealDispatcher } from "./realDispatcher.js";
import type { ModelTier, RunState, TrainingRunManifest, TrainingRunSpec, TrainingStage } from "./types.js";

const COMMANDS = ["run", "resume", "status"] as const;
type Command = (typeof COMMANDS)[number];

const DEFAULT_RUNS_DIR = "training-runs";
const DEFAULT_RESOURCE = "storm590x";

export interface RunArgs {
  command: "run";
  runId: string;
  tier: ModelTier;
  stage: TrainingStage;
  datasetPath: string;
  seed: number;
  resource: string;
  capabilityJob: string;
  inputsDir: string;
  lockfilePath: string;
  gpuCheckPath: string;
  cuda: string | null;
  driver: string | null;
  runsDir: string;
  maxSteps?: number;
  numEpochs?: number;
  maxSeqLength?: number;
  loadIn4bit?: boolean;
  loraR?: number;
  loraAlpha?: number;
  loraDropout?: number;
}

export interface ResumeArgs {
  command: "resume";
  runId: string;
  resource: string;
  capabilityJob: string;
  inputsDir: string;
  lockfilePath: string;
  gpuCheckPath: string;
  cuda: string | null;
  driver: string | null;
  runsDir: string;
}

export interface StatusArgs {
  command: "status";
  runId: string;
  runsDir: string;
}

export type CliArgs = RunArgs | ResumeArgs | StatusArgs;

function isCommand(value: string | undefined): value is Command {
  return !!value && (COMMANDS as readonly string[]).includes(value);
}

function parseFlags(rest: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

export function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    throw new Error(`unknown training command: "${command ?? ""}" (expected one of: ${COMMANDS.join("|")})`);
  }
  const flags = parseFlags(rest);
  const runsDir = flags["runs-dir"] ?? DEFAULT_RUNS_DIR;

  if (!flags["run-id"]) throw new Error("--run-id is required");
  const runId = flags["run-id"];

  if (command === "status") {
    return { command: "status", runId, runsDir };
  }

  const resource = flags["resource"] ?? DEFAULT_RESOURCE;
  const inputsDir = flags["inputs"];
  if (!inputsDir) throw new Error("--inputs is required");
  const lockfilePath = flags["lockfile"];
  if (!lockfilePath) throw new Error("--lockfile is required");
  const gpuCheckPath = flags["gpu-check"];
  if (!gpuCheckPath) throw new Error("--gpu-check is required");
  const cuda = flags["cuda"] ?? null;
  const driver = flags["driver"] ?? null;

  if (command === "resume") {
    const capabilityJob = flags["capability-job"];
    if (!capabilityJob) throw new Error("--capability-job is required");
    return { command: "resume", runId, resource, capabilityJob, inputsDir, lockfilePath, gpuCheckPath, cuda, driver, runsDir };
  }

  // run
  const tier = flags["tier"];
  if (tier !== "1.7B" && tier !== "0.6B") {
    throw new Error(`--tier must be "1.7B" or "0.6B" (got ${flags["tier"] ?? ""})`);
  }
  const stage = flags["stage"];
  if (stage !== "sft" && stage !== "dpo") {
    throw new Error(`--stage must be "sft" or "dpo" (got ${flags["stage"] ?? ""})`);
  }
  const datasetPath = flags["dataset"];
  if (!datasetPath) throw new Error("--dataset is required");
  if (!flags["seed"]) throw new Error("--seed is required");
  const seed = Number(flags["seed"]);
  const capabilityJob = flags["capability-job"] ?? `slm-training:${stage}`;

  // §8.1: CUDA/driver versions must be recorded in the environment capture,
  // never silently null. Refused here — before any dispatcher is even
  // constructed in main() — so a run without real values never reaches
  // runner.run() (which independently refuses too; this is the fail-fast
  // CLI-layer copy of that same guard). `resume` does NOT require these:
  // it inherits the original run's captured values and must stay usable
  // for recovery even without a fresh cuda/driver probe at hand.
  if (cuda === null || driver === null) {
    throw new Error(
      "--cuda and --driver are both required for `run` (SPEC-APP.md §8.1: CUDA/driver versions " +
        `must be recorded, never silently null) — got --cuda=${cuda ?? "(missing)"} --driver=${driver ?? "(missing)"}. ` +
        "Get real values from remote-compute.py's registry probe for the resource " +
        "(reads capabilities.gpu.{cuda,driver}) or `nvidia-smi --query-gpu=driver_version,name " +
        "--format=csv,noheader` run on the resource itself.",
    );
  }

  const args: RunArgs = {
    command: "run",
    runId,
    tier,
    stage,
    datasetPath,
    seed,
    resource,
    capabilityJob,
    inputsDir,
    lockfilePath,
    gpuCheckPath,
    cuda,
    driver,
    runsDir,
  };
  if (flags["max-steps"] !== undefined) args.maxSteps = Number(flags["max-steps"]);
  if (flags["num-epochs"] !== undefined) args.numEpochs = Number(flags["num-epochs"]);
  if (flags["max-seq-length"] !== undefined) args.maxSeqLength = Number(flags["max-seq-length"]);
  if (flags["load-in-4bit"] !== undefined) args.loadIn4bit = flags["load-in-4bit"] === "true";
  if (flags["lora-r"] !== undefined) args.loraR = Number(flags["lora-r"]);
  if (flags["lora-alpha"] !== undefined) args.loraAlpha = Number(flags["lora-alpha"]);
  if (flags["lora-dropout"] !== undefined) args.loraDropout = Number(flags["lora-dropout"]);
  return args;
}

function specFromRunArgs(args: RunArgs): TrainingRunSpec {
  const spec: TrainingRunSpec = { tier: args.tier, stage: args.stage, datasetPath: args.datasetPath, seed: args.seed };
  if (args.maxSteps !== undefined || args.numEpochs !== undefined) {
    spec.train = { ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}), ...(args.numEpochs !== undefined ? { numEpochs: args.numEpochs } : {}) };
  }
  if (args.maxSeqLength !== undefined) spec.maxSeqLength = args.maxSeqLength;
  if (args.loadIn4bit !== undefined) spec.loadIn4bit = args.loadIn4bit;
  if (args.loraR !== undefined || args.loraAlpha !== undefined || args.loraDropout !== undefined) {
    spec.lora = {
      ...(args.loraR !== undefined ? { r: args.loraR } : {}),
      ...(args.loraAlpha !== undefined ? { alpha: args.loraAlpha } : {}),
      ...(args.loraDropout !== undefined ? { dropout: args.loraDropout } : {}),
    };
  }
  return spec;
}

function loadGpuCheck(gpuCheckPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(gpuCheckPath, "utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "status") {
    const runDir = path.join(args.runsDir, args.runId);
    const state = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as RunState;
    console.log(JSON.stringify({ state }, null, 2));
    const manifestPath = path.join(runDir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as TrainingRunManifest;
      console.log(JSON.stringify({ manifest }, null, 2));
    }
    return;
  }

  const dispatcher = new RealDispatcher({
    resource: args.resource,
    capabilityJob: args.capabilityJob,
    remoteComputePyPath: process.env.REMOTE_COMPUTE_PY ?? "",
  });
  const opts = {
    runsDir: args.runsDir,
    dispatcher,
    resource: args.resource,
    capabilityJob: args.capabilityJob,
    inputsDir: args.inputsDir,
    environment: {
      lockfilePath: args.lockfilePath,
      gpuCheck: loadGpuCheck(args.gpuCheckPath),
      cudaDriver: { cuda: args.cuda, driver: args.driver },
    },
  };

  const result = args.command === "run" ? await run(specFromRunArgs(args), args.runId, opts) : await resume(args.runId, opts);
  console.log(JSON.stringify(result, null, 2));
}

// Guarded so importing this module (e.g. from tests, for parseArgs) never
// triggers a real dispatch as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
