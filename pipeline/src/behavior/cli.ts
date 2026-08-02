#!/usr/bin/env tsx
/**
 * Behavior-training dataset builder CLI (SPEC-APP.md §7.5-§7.6). Reads
 * APP-010's exported chunks.jsonl and APP-011's accepted qa-pairs.jsonl
 * (via qa/pairsStore's readPairsRecords, import-only reuse), optionally
 * APP-012's accepted.jsonl/rejected.jsonl when present (pipeline/out/
 * sampling/ — their absence is a normal, fully-supported "not run yet"
 * state, not an error), and the committed behavior-datasets.json +
 * ood-templates.json config, then builds all four categories
 * (distractor-robustness, abstention, OOD refusal, DPO preference pairs)
 * and writes them atomically to an output directory (default
 * pipeline/out/behavior/, gitignored).
 *
 * Pure offline transform: no API calls, no network, ever. Fails loudly
 * (non-zero exit, no output written) when any category can't meet its
 * configured minimum — see build.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { readPairsRecords } from "../qa/pairsStore.js";
import { buildBehaviorDatasets, type BehaviorDatasetsConfig } from "./build.js";
import { writeBehaviorDatasets } from "./write.js";
import type { Chunk, SampledRecordLike } from "./types.js";
import type { OODTemplateBank } from "./ood.js";

interface CliArgs {
  chunksPath: string;
  qaPairsPath: string;
  configPath: string;
  oodTemplatesPath: string;
  acceptedPath: string;
  rejectedPath: string;
  outDir: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const base = path.join(import.meta.dirname, "..", "..");
  const args: CliArgs = {
    // BUG-190: chunks-fulltext.jsonl, not chunks.jsonl — see qa/cli.ts's
    // parseArgs doc comment for the full rationale.
    chunksPath: path.join(base, "out", "chunks-fulltext.jsonl"),
    qaPairsPath: path.join(base, "out", "qa", "qa-pairs.jsonl"),
    configPath: path.join(base, "config", "behavior-datasets.json"),
    oodTemplatesPath: path.join(base, "config", "ood-templates.json"),
    acceptedPath: path.join(base, "out", "sampling", "accepted.jsonl"),
    rejectedPath: path.join(base, "out", "sampling", "rejected.jsonl"),
    outDir: path.join(base, "out", "behavior"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chunks" && argv[i + 1]) args.chunksPath = argv[++i];
    else if (arg === "--qa-pairs" && argv[i + 1]) args.qaPairsPath = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--ood-templates" && argv[i + 1]) args.oodTemplatesPath = argv[++i];
    else if (arg === "--accepted" && argv[i + 1]) args.acceptedPath = argv[++i];
    else if (arg === "--rejected" && argv[i + 1]) args.rejectedPath = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
  }
  return args;
}

/** See qa/cli.ts's chunksFullTextMissingError for the full rationale (same
 * loud-fail-not-silent-fallback contract, behavior-CLI-specific wording).
 * Note: behavior/build.ts's transforms never read chunk.text (only
 * chunk_id/tags — see categorize.ts/adjudication.ts), so this lane can't
 * structurally leak the stub marker into its output today; the loud-fail
 * still applies for consistency with the other three lanes and as
 * defense-in-depth if that changes. */
function chunksFullTextMissingError(chunksPath: string): Error {
  return new Error(
    `${chunksPath}: not found.\n\n` +
      "behavior:build reads chunks-fulltext.jsonl (the exporter's parallel, always-full-text " +
      "output), not chunks.jsonl — chunks.jsonl carries only a stub marker for stub-mode sources " +
      "like lore (see docs/rights-assessment.md §7.10). Re-run the exporter (`npm run export` from " +
      "pipeline/, or `pnpm --filter @fab/pipeline run export` from the repo root) to produce " +
      "chunks-fulltext.jsonl, or pass --chunks <path> to point at an existing fulltext chunk file " +
      "explicitly.",
  );
}

export function loadChunks(chunksPath: string): Chunk[] {
  let raw: string;
  try {
    raw = fs.readFileSync(chunksPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw chunksFullTextMissingError(chunksPath);
    throw err;
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Chunk);
}

/** APP-012's artifacts are entirely optional input — see dpo.ts's gating
 * doc comment — so a missing file is a normal empty-array case, never an
 * error, and every other read error propagates (a corrupt/half-written
 * file should stop the build, not silently degrade). */
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const chunks = loadChunks(args.chunksPath);
  const pairRecords = readPairsRecords(args.qaPairsPath);
  const config = JSON.parse(fs.readFileSync(args.configPath, "utf8")) as BehaviorDatasetsConfig;
  const oodTemplateBank = JSON.parse(fs.readFileSync(args.oodTemplatesPath, "utf8")) as OODTemplateBank;
  const acceptedRecords = loadJsonlIfPresent<SampledRecordLike>(args.acceptedPath);
  const rejectedRecords = loadJsonlIfPresent<SampledRecordLike>(args.rejectedPath);

  const result = buildBehaviorDatasets({ chunks, pairRecords, oodTemplateBank, config, acceptedRecords, rejectedRecords });
  writeBehaviorDatasets(args.outDir, result);

  console.log(`distractor: ${result.distractor.length} (min ${config.distractor.minCount})`);
  console.log(`abstention: ${result.abstention.length} (min ${config.abstention.minCount})`);
  console.log(
    `ood: ${result.ood.length} (min ${config.ood.minCount}) — diversity: template ` +
      `${(result.manifest.oodDiversity.templateUsageRatio * 100).toFixed(0)}%, style ` +
      `${(result.manifest.oodDiversity.styleCoverageRatio * 100).toFixed(0)}%`,
  );
  console.log(`dpo: ${result.dpo.length} (min ${config.dpo.minCount})`);
  console.log(`accepted/rejected artifacts found: ${acceptedRecords.length}/${rejectedRecords.length}`);
  console.log(`-> ${args.outDir}`);
}

// Guarded so importing this module (e.g. from tests) never triggers a real
// run as a side effect — see qa/cli.ts's matching guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
