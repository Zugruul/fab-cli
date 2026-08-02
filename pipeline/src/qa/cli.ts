#!/usr/bin/env tsx
/**
 * Teacher Q&A generation CLI (SPEC-APP.md §7.3). Reads APP-010's exported
 * chunks.jsonl, runs the resumable batch runner against the committed
 * generation config, and writes: accepted pairs (qa-pairs.jsonl), a
 * human-reviewable markdown table (review.md), a run manifest
 * (manifest.json, counts + teacher model id + config hash), and the
 * resumable progress file (progress.json) — all under an output directory
 * (default pipeline/out/qa/, gitignored).
 *
 * --dry-run makes NO network calls at all: it only prints/writes what
 * would be sent per chunk (dry-run-plan.json), never touches progress.
 */
import fs from "node:fs";
import path from "node:path";
import { runBatch } from "./runner.js";
import { buildRunManifest } from "./manifest.js";
import { buildReviewMarkdown } from "./review.js";
import { AnthropicTeacherClient } from "./teacher.js";
import type { Chunk, ChunkGenerationOutcome, GenerationConfig, TeacherClient } from "./types.js";

interface CliArgs {
  chunksPath: string;
  configPath: string;
  outDir: string;
  dryRun: boolean;
  limit: number | null;
  costCeilingUsd: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    chunksPath: path.join(import.meta.dirname, "..", "..", "out", "chunks.jsonl"),
    configPath: path.join(import.meta.dirname, "..", "..", "config", "qa-generation.json"),
    outDir: path.join(import.meta.dirname, "..", "..", "out", "qa"),
    dryRun: false,
    limit: null,
    costCeilingUsd: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chunks" && argv[i + 1]) args.chunksPath = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (arg === "--cost-ceiling" && argv[i + 1]) args.costCeilingUsd = parseFloat(argv[++i]);
  }
  return args;
}

function loadChunks(chunksPath: string): Chunk[] {
  const raw = fs.readFileSync(chunksPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Chunk);
}

function loadConfig(configPath: string): GenerationConfig {
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as GenerationConfig;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let chunks = loadChunks(args.chunksPath);
  if (args.limit != null) chunks = chunks.slice(0, args.limit);

  const config = loadConfig(args.configPath);
  if (args.costCeilingUsd != null) config.cost.ceilingUsd = args.costCeilingUsd;

  fs.mkdirSync(args.outDir, { recursive: true });
  const progressPath = path.join(args.outDir, "progress.json");
  const qaPairsPath = path.join(args.outDir, "qa-pairs.jsonl");
  const reviewPath = path.join(args.outDir, "review.md");
  const manifestPath = path.join(args.outDir, "manifest.json");
  const dryRunPlanPath = path.join(args.outDir, "dry-run-plan.json");

  const chunksById = new Map(chunks.map((c) => [c.chunk_id, c]));
  const outcomes: ChunkGenerationOutcome[] = [];
  const qaPairsStream = args.dryRun ? null : fs.createWriteStream(qaPairsPath, { flags: "a" });

  // Never constructed for --dry-run: no Anthropic client, no auth
  // resolution, no possibility of a network call.
  const teacher: TeacherClient = args.dryRun
    ? { generate: () => Promise.reject(new Error("dry-run must never call the teacher")) }
    : new AnthropicTeacherClient();

  const result = await runBatch({
    chunks,
    config,
    teacher,
    progressPath,
    dryRun: args.dryRun,
    onChunkComplete: (outcome) => {
      outcomes.push(outcome);
      if (qaPairsStream && outcome.pairs.length > 0) {
        qaPairsStream.write(JSON.stringify({ chunk_id: outcome.chunk_id, pairs: outcome.pairs }) + "\n");
      }
    },
  });

  if (args.dryRun) {
    fs.writeFileSync(dryRunPlanPath, JSON.stringify(result.dryRunPlan, null, 2) + "\n");
    console.log(`dry run: ${result.dryRunPlan?.length ?? 0} chunk(s) planned -> ${dryRunPlanPath}`);
    console.log("no API calls were made.");
    return;
  }

  qaPairsStream?.end();

  const manifest = buildRunManifest({
    config,
    dryRun: false,
    chunkCount: chunks.length,
    outcomes,
    progress: result.progress,
    stoppedEarly: result.stoppedEarly,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const review = buildReviewMarkdown(outcomes, chunksById);
  fs.writeFileSync(reviewPath, review);

  console.log(`processed ${outcomes.length} chunk(s) this run`);
  console.log(`accepted pairs: ${manifest.acceptedPairCount}, rejected: ${manifest.rejectedPairCount}, failed chunks: ${manifest.failedChunkCount}`);
  console.log(`cost estimate so far: $${manifest.costUsd.toFixed(4)} (${manifest.requestCount} request(s))`);
  if (result.stoppedEarly) console.log(`stopped early: ${result.stoppedEarly.reason}`);
  console.log(`qa pairs -> ${qaPairsPath}`);
  console.log(`review -> ${reviewPath}`);
  console.log(`manifest -> ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
