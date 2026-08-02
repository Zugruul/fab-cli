#!/usr/bin/env tsx
/**
 * Thin CLI over runner.ts (APP-021): run/resume/status subcommands for
 * driving E2 export runs through the slm-training:export-gguf capability
 * job. parseArgs is pure and unit-tested; main()'s real dispatch
 * (RealDispatcher shelling to remote-compute.py) is not exercised in tests,
 * mirroring training/cli.ts's split.
 *
 * Usage:
 *   tsx src/export/cli.ts run --run-id <id> --tier 1.7B|0.6B \
 *     [--adapters-run-id <id> | --adapters-dir <dir>] \
 *     --inputs <dir> --lockfile <path> --gpu-check <path> \
 *     [--cuda <ver>] [--driver <ver>] [--resource storm590x] \
 *     [--capability-job slm-training:export-gguf] \
 *     [--quantizations q4_k_m,q8_0] [--max-seq-length N] \
 *     [--smoke-prompt <text>] [--smoke-schema-file <path>] \
 *     [--smoke-max-tokens N] [--llama-cli <path>] \
 *     [--runs-dir <dir>] [--training-runs-dir <dir>]
 *   tsx src/export/cli.ts resume --run-id <id> --inputs <dir> --lockfile <path> --gpu-check <path> \
 *     [--cuda <ver>] [--driver <ver>] [--resource storm590x] --capability-job <name> \
 *     [--runs-dir <dir>] [--training-runs-dir <dir>]
 *   tsx src/export/cli.ts status --run-id <id> [--runs-dir <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { run, resume } from "./runner.js";
import { RealDispatcher } from "./realDispatcher.js";
import type { ExportRunManifest, ExportRunSpec, ExportRunState, ModelTier, SmokeConfig } from "./types.js";

const COMMANDS = ["run", "resume", "status"] as const;
type Command = (typeof COMMANDS)[number];

const DEFAULT_RUNS_DIR = "export-runs";
const DEFAULT_TRAINING_RUNS_DIR = "training-runs";
const DEFAULT_RESOURCE = "storm590x";
const DEFAULT_CAPABILITY_JOB = "slm-training:export-gguf";

export interface RunArgs {
  command: "run";
  runId: string;
  tier: ModelTier;
  adaptersRunId?: string;
  adaptersDir?: string;
  resource: string;
  capabilityJob: string;
  inputsDir: string;
  lockfilePath: string;
  gpuCheckPath: string;
  cuda: string | null;
  driver: string | null;
  runsDir: string;
  trainingRunsDir: string;
  quantizations?: string[];
  maxSeqLength?: number;
  smokePrompt?: string;
  smokeSchemaFile?: string;
  smokeMaxTokens?: number;
  llamaCli?: string;
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
  trainingRunsDir: string;
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
    throw new Error(`unknown export command: "${command ?? ""}" (expected one of: ${COMMANDS.join("|")})`);
  }
  const flags = parseFlags(rest);
  const runsDir = flags["runs-dir"] ?? DEFAULT_RUNS_DIR;

  if (!flags["run-id"]) throw new Error("--run-id is required");
  const runId = flags["run-id"];

  if (command === "status") {
    return { command: "status", runId, runsDir };
  }

  const resource = flags["resource"] ?? DEFAULT_RESOURCE;
  const capabilityJob = flags["capability-job"] ?? DEFAULT_CAPABILITY_JOB;
  const inputsDir = flags["inputs"];
  if (!inputsDir) throw new Error("--inputs is required");
  const lockfilePath = flags["lockfile"];
  if (!lockfilePath) throw new Error("--lockfile is required");
  const gpuCheckPath = flags["gpu-check"];
  if (!gpuCheckPath) throw new Error("--gpu-check is required");
  const cuda = flags["cuda"] ?? null;
  const driver = flags["driver"] ?? null;
  const trainingRunsDir = flags["training-runs-dir"] ?? DEFAULT_TRAINING_RUNS_DIR;

  if (command === "resume") {
    return { command: "resume", runId, resource, capabilityJob, inputsDir, lockfilePath, gpuCheckPath, cuda, driver, runsDir, trainingRunsDir };
  }

  // run
  const tier = flags["tier"];
  if (tier !== "1.7B" && tier !== "0.6B") {
    throw new Error(`--tier must be "1.7B" or "0.6B" (got ${flags["tier"] ?? ""})`);
  }

  // §8.1: CUDA/driver versions must be recorded in the environment capture,
  // never silently null — refused here, before any dispatcher is even
  // constructed in main(), mirroring training/cli.ts's fail-fast copy of
  // runner.ts's own guard. `resume` does NOT require these (inherits the
  // original run's captured values).
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
    resource,
    capabilityJob,
    inputsDir,
    lockfilePath,
    gpuCheckPath,
    cuda,
    driver,
    runsDir,
    trainingRunsDir,
  };
  if (flags["adapters-run-id"] !== undefined) args.adaptersRunId = flags["adapters-run-id"];
  if (flags["adapters-dir"] !== undefined) args.adaptersDir = flags["adapters-dir"];
  if (flags["quantizations"] !== undefined) {
    args.quantizations = flags["quantizations"]
      .split(",")
      .map((q) => q.trim())
      .filter((q) => q.length > 0);
  }
  if (flags["max-seq-length"] !== undefined) args.maxSeqLength = Number(flags["max-seq-length"]);
  if (flags["smoke-prompt"] !== undefined) args.smokePrompt = flags["smoke-prompt"];
  if (flags["smoke-schema-file"] !== undefined) args.smokeSchemaFile = flags["smoke-schema-file"];
  if (flags["smoke-max-tokens"] !== undefined) args.smokeMaxTokens = Number(flags["smoke-max-tokens"]);
  if (flags["llama-cli"] !== undefined) args.llamaCli = flags["llama-cli"];
  return args;
}

function specFromRunArgs(args: RunArgs): ExportRunSpec {
  const spec: ExportRunSpec = { tier: args.tier };
  if (args.adaptersRunId !== undefined) spec.adaptersRunId = args.adaptersRunId;
  if (args.adaptersDir !== undefined) spec.adaptersDir = args.adaptersDir;
  if (args.quantizations !== undefined) spec.quantizations = args.quantizations;
  if (args.maxSeqLength !== undefined) spec.maxSeqLength = args.maxSeqLength;

  const smoke: Partial<SmokeConfig> = {};
  if (args.smokePrompt !== undefined) smoke.prompt = args.smokePrompt;
  if (args.smokeSchemaFile !== undefined) {
    smoke.jsonSchema = JSON.parse(fs.readFileSync(args.smokeSchemaFile, "utf8")) as Record<string, unknown>;
  }
  if (args.smokeMaxTokens !== undefined) smoke.maxTokens = args.smokeMaxTokens;
  if (args.llamaCli !== undefined) smoke.llamaCli = args.llamaCli;
  if (Object.keys(smoke).length > 0) spec.smoke = smoke;

  return spec;
}

function loadGpuCheck(gpuCheckPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(gpuCheckPath, "utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "status") {
    const runDir = path.join(args.runsDir, args.runId);
    const state = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as ExportRunState;
    console.log(JSON.stringify({ state }, null, 2));
    const manifestPath = path.join(runDir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ExportRunManifest;
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
    trainingRunsDir: args.trainingRunsDir,
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
