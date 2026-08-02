#!/usr/bin/env tsx
/**
 * Rejection sampling CLI (SPEC-APP.md §7.4). Reads APP-011's qa-pairs
 * output (pipeline/out/qa/qa-pairs.jsonl) plus APP-010's exported
 * chunks.jsonl (for the source chunk text each pair is checked against),
 * runs the resumable per-pair entailment-check batch runner against the
 * committed sampling config, and writes: accepted pairs (accepted.jsonl),
 * rejected pairs with reasons (rejected.jsonl), a run manifest
 * (manifest.json — counts + per-category acceptance rate + judge model id
 * + config hash), and the resumable progress file (progress.json) — all
 * under an output directory (default pipeline/out/sampling/, gitignored).
 *
 * --dry-run makes NO network calls at all: it only prints/writes what
 * would be sent per pair (dry-run-plan.json), never touches progress.
 *
 * ⚠️ STALENESS GUARD (BUG-180): sampling progress (progress.json) is keyed
 * by pairId (`${chunk_id}#${index}`), NOT by pair content. If you
 * regenerate an already-sampled chunk's pairs (re-run `qa:generate` for
 * that chunk_id — e.g. after editing its source text or prompt), the new
 * pairs at the same indices reuse the same pairIds. This is handled
 * automatically: `runSampling` records each checked pairId's content hash
 * in progress.json and, on every run, compares it against the current
 * work item — a mismatch means the pair was regenerated, so it's
 * reprocessed rather than silently honored with the stale verdict (see
 * `staleReprocessedCount` below). Progress files written before this
 * guard existed carry no hash; those pairIds are honored once
 * (`legacyUnverifiedCount`) and backfilled with their current hash so a
 * later resume can guard them too. See types.ts's WorkItem doc for the
 * full mechanism.
 */
import fs from "node:fs";
import path from "node:path";
import { runSampling, buildWorkItems } from "./sampler.js";
import { appendAcceptedDurable, appendRejectedDurable } from "./store.js";
import { buildSamplingManifest } from "./manifest.js";
import { AnthropicJudgeClient } from "./judge.js";
import { readPairsRecords } from "../qa/pairsStore.js";
import type { Chunk, JudgeClient, PairSamplingOutcome, SamplingConfig } from "./types.js";

interface CliArgs {
  chunksPath: string;
  qaPairsPath: string;
  configPath: string;
  outDir: string;
  dryRun: boolean;
  limit: number | null;
  costCeilingUsd: number | null;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    // BUG-190: chunks-fulltext.jsonl, not chunks.jsonl — see qa/cli.ts's
    // parseArgs doc comment for the full rationale.
    chunksPath: path.join(import.meta.dirname, "..", "..", "out", "chunks-fulltext.jsonl"),
    qaPairsPath: path.join(import.meta.dirname, "..", "..", "out", "qa", "qa-pairs.jsonl"),
    configPath: path.join(import.meta.dirname, "..", "..", "config", "rejection-sampling.json"),
    outDir: path.join(import.meta.dirname, "..", "..", "out", "sampling"),
    dryRun: false,
    limit: null,
    costCeilingUsd: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chunks" && argv[i + 1]) args.chunksPath = argv[++i];
    else if (arg === "--qa-pairs" && argv[i + 1]) args.qaPairsPath = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (arg === "--cost-ceiling" && argv[i + 1]) args.costCeilingUsd = parseFloat(argv[++i]);
  }
  return args;
}

/** See qa/cli.ts's chunksFullTextMissingError for the full rationale (same
 * loud-fail-not-silent-fallback contract, sampling-CLI-specific wording). */
function chunksFullTextMissingError(chunksPath: string): Error {
  return new Error(
    `${chunksPath}: not found.\n\n` +
      "qa:sample reads chunks-fulltext.jsonl (the exporter's parallel, always-full-text output), " +
      "not chunks.jsonl — chunks.jsonl carries only a stub marker for stub-mode sources like lore " +
      "(see docs/rights-assessment.md §7.10), and silently falling back to it here would judge " +
      "entailment against that stub marker instead of real source prose. Re-run the exporter " +
      "(`npm run export` from pipeline/, or `pnpm --filter @fab/pipeline run export` from the repo " +
      "root) to produce chunks-fulltext.jsonl, or pass --chunks <path> to point at an existing " +
      "fulltext chunk file explicitly.",
  );
}

export function loadChunksById(chunksPath: string): Map<string, Chunk> {
  let raw: string;
  try {
    raw = fs.readFileSync(chunksPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw chunksFullTextMissingError(chunksPath);
    throw err;
  }
  const chunks = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Chunk);
  return new Map(chunks.map((c) => [c.chunk_id, c]));
}

function loadConfig(configPath: string): SamplingConfig {
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as SamplingConfig;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const chunksById = loadChunksById(args.chunksPath);
  const records = readPairsRecords(args.qaPairsPath);
  let workItems = buildWorkItems(records);
  if (args.limit != null) workItems = workItems.slice(0, args.limit);

  const config = loadConfig(args.configPath);
  if (args.costCeilingUsd != null) config.cost.ceilingUsd = args.costCeilingUsd;

  fs.mkdirSync(args.outDir, { recursive: true });
  const progressPath = path.join(args.outDir, "progress.json");
  const acceptedPath = path.join(args.outDir, "accepted.jsonl");
  const rejectedPath = path.join(args.outDir, "rejected.jsonl");
  const manifestPath = path.join(args.outDir, "manifest.json");
  const dryRunPlanPath = path.join(args.outDir, "dry-run-plan.json");

  const outcomes: PairSamplingOutcome[] = [];

  // Never constructed for --dry-run: no Anthropic client, no auth
  // resolution, no possibility of a network call.
  const judge: JudgeClient = args.dryRun
    ? { check: () => Promise.reject(new Error("dry-run must never call the judge")) }
    : new AnthropicJudgeClient();

  const result = await runSampling({
    workItems,
    chunksById,
    config,
    judge,
    progressPath,
    dryRun: args.dryRun,
    // sampler.ts awaits this and marks the pair done in progress.json only
    // AFTER it resolves — appendAcceptedDurable/appendRejectedDurable are
    // synchronous file rewrites, so by the time this returns, the record
    // is safely on disk. See store.ts for why a re-checked pair (after a
    // crash right here) never ends up duplicated. The sibling-path
    // argument on each call is the BUG-180 follow-up guard: a stale
    // pairId reprocessed by the staleness guard whose verdict FLIPS
    // (accepted <-> rejected) must not leave its old verdict's record
    // dangling in the OTHER file — see store.ts's removeRecordDurable.
    onPairComplete: (outcome) => {
      if (outcome.status === "accepted") {
        appendAcceptedDurable(acceptedPath, outcome.pairId, outcome.chunk_id, outcome.pair, outcome.reason, rejectedPath);
      } else {
        // outcome.rejectionKind is always set (non-null) when status is
        // "rejected" — see types.ts's PairSamplingOutcome.
        appendRejectedDurable(rejectedPath, outcome.pairId, outcome.chunk_id, outcome.pair, outcome.rejectionKind!, outcome.reason, acceptedPath);
      }
      outcomes.push(outcome);
    },
  });

  if (args.dryRun) {
    fs.writeFileSync(dryRunPlanPath, JSON.stringify(result.dryRunPlan, null, 2) + "\n");
    console.log(`dry run: ${result.dryRunPlan?.length ?? 0} pair(s) planned -> ${dryRunPlanPath}`);
    console.log("no API calls were made.");
    return;
  }

  const manifest = buildSamplingManifest({
    config,
    dryRun: false,
    pairCount: workItems.length,
    outcomes,
    progress: result.progress,
    stoppedEarly: result.stoppedEarly,
    staleReprocessedCount: result.staleReprocessedCount,
    legacyUnverifiedCount: result.legacyUnverifiedCount,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`processed ${outcomes.length} pair(s) this run`);
  if (manifest.staleReprocessedCount > 0) {
    console.log(
      `BUG-180 guard: ${manifest.staleReprocessedCount} pairId(s) had regenerated content and were reprocessed (stale verdict discarded)`,
    );
  }
  if (manifest.legacyUnverifiedCount > 0) {
    console.log(
      `BUG-180 guard: ${manifest.legacyUnverifiedCount} pairId(s) came from pre-guard progress with no content hash — honored once, now backfilled`,
    );
  }
  console.log(
    `accepted: ${manifest.acceptedCount}, rejected: ${manifest.rejectedCount} ` +
      `(not-entailed: ${manifest.rejectedNotEntailedCount}, infra-error: ${manifest.rejectedInfraCount})`,
  );
  console.log(
    `acceptance rate: ${(manifest.acceptanceRate * 100).toFixed(1)}% (excludes infra-error; ` +
      `raw incl. infra: ${(manifest.rawAcceptanceRate * 100).toFixed(1)}%)`,
  );
  for (const cat of manifest.categoryAcceptance) {
    console.log(
      `  ${cat.category}: ${cat.accepted}/${cat.accepted + cat.rejectedNotEntailed} (${(cat.acceptanceRate * 100).toFixed(1)}%)` +
        ` [infra-error: ${cat.rejectedInfra}]`,
    );
  }
  console.log(`cost estimate so far: $${manifest.costUsd.toFixed(4)} (${manifest.requestCount} request(s))`);
  if (result.stoppedEarly) console.log(`stopped early: ${result.stoppedEarly.reason}`);
  console.log(`accepted -> ${acceptedPath}`);
  console.log(`rejected -> ${rejectedPath}`);
  console.log(`manifest -> ${manifestPath}`);
}

// Guarded so importing this module (e.g. from tests) never triggers a real
// run as a side effect — see qa/cli.ts's matching guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
