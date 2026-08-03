#!/usr/bin/env tsx
/**
 * Thin CLI over embedRunner.ts (APP-028): run/resume/status subcommands
 * for driving ArcFace embedder training runs. Mirrors cli.ts's shape for
 * the detector; parseArgs is pure and unit-tested, main()'s real dispatch
 * is not exercised in tests — same split as cli.ts.
 *
 * Usage:
 *   tsx src/train-vision/embedCli.ts run --run-id <id> --dataset-dir <dir> --seed <n> --inputs <dir> \
 *     [--architecture arcface-embedder-tiny] [--val-fraction F] [--crop-size N] [--embedding-dim N] \
 *     [--margin F] [--scale F] [--epochs N] [--batch-size N] [--lr F] \
 *     [--resource storm590x] [--capability-job vision-training:arcface-embed-train] \
 *     [--cuda <ver>] [--driver <ver>] [--gpu <name>] [--torch <ver>] [--runs-dir <dir>]
 *   tsx src/train-vision/embedCli.ts resume --run-id <id> --inputs <dir> \
 *     [--resource storm590x] --capability-job <name> [--cuda <ver>] [--driver <ver>] [--gpu <name>] [--torch <ver>] [--runs-dir <dir>]
 *   tsx src/train-vision/embedCli.ts status --run-id <id> [--runs-dir <dir>]
 *
 * No capability job exists yet on any resource for vision training (see
 * README.md, same gap the detector's cli.ts documents) — --capability-job
 * defaults to a placeholder name so this CLI is ready the moment one is
 * installed.
 */
import fs from "node:fs";
import path from "node:path";
import { run, resume } from "./embedRunner.js";
import { RealDispatcher } from "./realDispatcher.js";
import type { EmbedArchitecture, EmbedRunSpec, EmbedRunState, EmbedRunManifest } from "./embedTypes.js";

const COMMANDS = ["run", "resume", "status"] as const;
type Command = (typeof COMMANDS)[number];

const DEFAULT_RUNS_DIR = "vision-runs";
const DEFAULT_RESOURCE = "storm590x";
const DEFAULT_CAPABILITY_JOB = "vision-training:arcface-embed-train";

export interface RunArgs {
  command: "run";
  runId: string;
  datasetDir: string;
  seed: number;
  architecture?: EmbedArchitecture;
  valFraction?: number;
  cropSize?: number;
  embeddingDim?: number;
  margin?: number;
  scale?: number;
  epochs?: number;
  batchSize?: number;
  lr?: number;
  resource: string;
  capabilityJob: string;
  inputsDir: string;
  cuda: string | null;
  driver: string | null;
  gpu: string | null;
  torch: string | null;
  runsDir: string;
}

export interface ResumeArgs {
  command: "resume";
  runId: string;
  resource: string;
  capabilityJob: string;
  inputsDir: string;
  cuda: string | null;
  driver: string | null;
  gpu: string | null;
  torch: string | null;
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
    throw new Error(`unknown embed-vision command: "${command ?? ""}" (expected one of: ${COMMANDS.join("|")})`);
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
  const cuda = flags["cuda"] ?? null;
  const driver = flags["driver"] ?? null;
  const gpu = flags["gpu"] ?? null;
  const torch = flags["torch"] ?? null;
  const capabilityJob = flags["capability-job"] ?? DEFAULT_CAPABILITY_JOB;

  if (command === "resume") {
    return { command: "resume", runId, resource, capabilityJob, inputsDir, cuda, driver, gpu, torch, runsDir };
  }

  // run
  const datasetDir = flags["dataset-dir"];
  if (!datasetDir) throw new Error("--dataset-dir is required");
  if (!flags["seed"]) throw new Error("--seed is required");
  const seed = Number(flags["seed"]);

  const args: RunArgs = { command: "run", runId, datasetDir, seed, resource, capabilityJob, inputsDir, cuda, driver, gpu, torch, runsDir };
  if (flags["architecture"] !== undefined) args.architecture = flags["architecture"] as EmbedArchitecture;
  if (flags["val-fraction"] !== undefined) args.valFraction = Number(flags["val-fraction"]);
  if (flags["crop-size"] !== undefined) args.cropSize = Number(flags["crop-size"]);
  if (flags["embedding-dim"] !== undefined) args.embeddingDim = Number(flags["embedding-dim"]);
  if (flags["margin"] !== undefined) args.margin = Number(flags["margin"]);
  if (flags["scale"] !== undefined) args.scale = Number(flags["scale"]);
  if (flags["epochs"] !== undefined) args.epochs = Number(flags["epochs"]);
  if (flags["batch-size"] !== undefined) args.batchSize = Number(flags["batch-size"]);
  if (flags["lr"] !== undefined) args.lr = Number(flags["lr"]);
  return args;
}

function specFromRunArgs(args: RunArgs): EmbedRunSpec {
  const spec: EmbedRunSpec = { datasetDir: args.datasetDir, seed: args.seed };
  if (args.architecture !== undefined) spec.architecture = args.architecture;
  if (args.valFraction !== undefined) spec.valFraction = args.valFraction;
  if (args.cropSize !== undefined) spec.cropSize = args.cropSize;
  if (args.embeddingDim !== undefined) spec.embeddingDim = args.embeddingDim;
  if (args.margin !== undefined || args.scale !== undefined) {
    spec.arcface = {
      ...(args.margin !== undefined ? { margin: args.margin } : {}),
      ...(args.scale !== undefined ? { scale: args.scale } : {}),
    };
  }
  if (args.epochs !== undefined || args.batchSize !== undefined || args.lr !== undefined) {
    spec.train = {
      ...(args.epochs !== undefined ? { epochs: args.epochs } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.lr !== undefined ? { lr: args.lr } : {}),
    };
  }
  return spec;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "status") {
    const runDir = path.join(args.runsDir, args.runId);
    const state = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as EmbedRunState;
    console.log(JSON.stringify({ state }, null, 2));
    const manifestPath = path.join(runDir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as EmbedRunManifest;
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
    environment: { torch: args.torch, cuda: args.cuda, driver: args.driver, gpu: args.gpu },
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
