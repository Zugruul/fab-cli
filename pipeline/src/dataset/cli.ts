#!/usr/bin/env tsx
/**
 * Dataset versioning + stratified eval split CLI (SPEC-APP.md §7.7-§7.8).
 * Reads APP-010's exported chunks.jsonl, APP-011's qa-pairs.jsonl,
 * APP-012's accepted.jsonl/rejected.jsonl (optional), APP-013's behavior-
 * training artifacts (optional, each independently), the committed
 * dataset-build.json config, plus the corpus snapshot manifest and the qa
 * run manifest (both optional, read only to pin/annotate the dataset
 * manifest — see manifest.ts), then assembles + splits + writes the
 * versioned dataset atomically to an output directory (default
 * pipeline/out/dataset/, gitignored).
 *
 * Every upstream artifact this reads is OPTIONAL except chunks.jsonl —
 * see assemble.ts's doc comment for exactly how each absence degrades the
 * build (never silently, always noted in the manifest).
 */
import fs from "node:fs";
import path from "node:path";
import { readPairsRecords } from "../qa/pairsStore.js";
import { readAcceptedRecords, readRejectedRecords } from "../sampling/store.js";
import { assembleDataset } from "./assemble.js";
import { buildDatasetManifest, type CorpusSnapshotRef } from "./manifest.js";
import { writeDataset } from "./write.js";
import type { SplitConfig } from "./split.js";
import type { Chunk } from "../types.js";
import type { DistractorExample, AbstentionExample, OODExample, DPOPair } from "../behavior/types.js";

interface CliArgs {
  chunksPath: string;
  qaPairsPath: string;
  acceptedPath: string;
  rejectedPath: string;
  distractorPath: string;
  abstentionPath: string;
  oodPath: string;
  dpoPath: string;
  configPath: string;
  corpusManifestPath: string;
  qaManifestPath: string;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const base = path.join(import.meta.dirname, "..", "..");
  const args: CliArgs = {
    chunksPath: path.join(base, "out", "chunks.jsonl"),
    qaPairsPath: path.join(base, "out", "qa", "qa-pairs.jsonl"),
    acceptedPath: path.join(base, "out", "sampling", "accepted.jsonl"),
    rejectedPath: path.join(base, "out", "sampling", "rejected.jsonl"),
    distractorPath: path.join(base, "out", "behavior", "distractor.jsonl"),
    abstentionPath: path.join(base, "out", "behavior", "abstention.jsonl"),
    oodPath: path.join(base, "out", "behavior", "ood.jsonl"),
    dpoPath: path.join(base, "out", "behavior", "dpo.jsonl"),
    configPath: path.join(base, "config", "dataset-build.json"),
    corpusManifestPath: path.join(base, "out", "manifest.json"),
    qaManifestPath: path.join(base, "out", "qa", "manifest.json"),
    outDir: path.join(base, "out", "dataset"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chunks" && argv[i + 1]) args.chunksPath = argv[++i];
    else if (arg === "--qa-pairs" && argv[i + 1]) args.qaPairsPath = argv[++i];
    else if (arg === "--accepted" && argv[i + 1]) args.acceptedPath = argv[++i];
    else if (arg === "--rejected" && argv[i + 1]) args.rejectedPath = argv[++i];
    else if (arg === "--distractor" && argv[i + 1]) args.distractorPath = argv[++i];
    else if (arg === "--abstention" && argv[i + 1]) args.abstentionPath = argv[++i];
    else if (arg === "--ood" && argv[i + 1]) args.oodPath = argv[++i];
    else if (arg === "--dpo" && argv[i + 1]) args.dpoPath = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--corpus-manifest" && argv[i + 1]) args.corpusManifestPath = argv[++i];
    else if (arg === "--qa-manifest" && argv[i + 1]) args.qaManifestPath = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
  }
  return args;
}

function loadJsonl<T>(filePath: string): T[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/** Every upstream artifact besides chunks.jsonl is optional — a missing
 * file is a normal "not run yet" state (see assemble.ts), never an error;
 * any other read failure (permissions, corrupt JSON) still propagates. */
function loadJsonlIfPresent<T>(filePath: string): T[] {
  try {
    return loadJsonl<T>(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

function loadJsonIfPresent<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const chunks = loadJsonl<Chunk>(args.chunksPath);
  const qaPairRecords = readPairsRecords(args.qaPairsPath);
  const acceptedRecords = readAcceptedRecords(args.acceptedPath);
  const rejectedRecords = readRejectedRecords(args.rejectedPath);
  const distractorExamples = loadJsonlIfPresent<DistractorExample>(args.distractorPath);
  const abstentionExamples = loadJsonlIfPresent<AbstentionExample>(args.abstentionPath);
  const oodExamples = loadJsonlIfPresent<OODExample>(args.oodPath);
  const dpoPairs = loadJsonlIfPresent<DPOPair>(args.dpoPath);

  const config = JSON.parse(fs.readFileSync(args.configPath, "utf8")) as SplitConfig;

  const corpusManifest = loadJsonIfPresent<{ contentHash: string; schemaVersion: string; exportDate: string }>(
    args.corpusManifestPath,
  );
  const corpusSnapshot: CorpusSnapshotRef | null = corpusManifest
    ? {
        contentHash: corpusManifest.contentHash,
        schemaVersion: corpusManifest.schemaVersion,
        exportDate: corpusManifest.exportDate,
      }
    : null;

  const qaManifest = loadJsonIfPresent<{ teacherModel: string }>(args.qaManifestPath);
  const teacherModel = qaManifest?.teacherModel ?? null;

  const { examples, qaSource, notes } = assembleDataset({
    chunks,
    qaPairRecords,
    acceptedRecords,
    rejectedRecords,
    distractorExamples,
    abstentionExamples,
    oodExamples,
    dpoPairs,
    split: config,
  });

  // SPEC-APP.md §7.9 (APP-015) legality guard runs INSIDE assembleDataset()
  // itself (see assemble.ts's doc comment) — every caller gets it, not just
  // this CLI, so there's nothing to re-check here.

  const manifest = buildDatasetManifest({
    examples,
    config,
    seed: config.seed,
    evalFraction: config.evalFraction,
    corpusSnapshot,
    teacherModel,
    qaSource,
    notes,
  });

  writeDataset(args.outDir, examples, manifest);

  console.log(`examples: ${examples.length} (train ${manifest.counts.total.train}, eval ${manifest.counts.total.eval})`);
  console.log(`qa source: ${qaSource}`);
  for (const [category, counts] of Object.entries(manifest.counts.byCategory)) {
    console.log(`  ${category}: train ${counts.train}, eval ${counts.eval}`);
  }
  if (notes.length > 0) {
    console.log("notes:");
    for (const note of notes) console.log(`  - ${note}`);
  }
  console.log(`-> ${args.outDir}`);
}

main();
