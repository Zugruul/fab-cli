#!/usr/bin/env tsx
/**
 * OPTIONAL live smoke test for the teacher engine (issue #223, AC5). Makes
 * ONE real teacher call — via the real `claude` binary (default engine)
 * or, with --engine anthropic-api, the real Claude API — and prints what
 * came back. This is NOT part of `npm run gate` (the gate stays fully
 * network-disabled, per SPEC-APP.md §13 invariant 10) — it's a manual
 * check for confirming an engine is actually wired up against the real
 * transport, run by hand:
 *
 *   npx tsx src/qa/smoke.ts                        # claude-code-subscription (default)
 *   npx tsx src/qa/smoke.ts --engine anthropic-api  # requires ANTHROPIC_API_KEY
 *
 * or via the package script: `npm run qa:smoke -- [--engine <id>]`.
 *
 * Uses a tiny hardcoded chunk rather than reading a real corpus export, so
 * it never depends on chunks-fulltext.jsonl existing — this is a
 * transport check, not a dataset-generation run.
 */
import { buildTeacherRequest, estimateCost } from "./runner.js";
import { parseTeacherResponse } from "./parse.js";
import { buildTeacherClient, DEFAULT_ENGINE_ID, isEngineId } from "./engine.js";
import type { Chunk, EngineId, GenerationConfig } from "./types.js";

const SMOKE_CHUNK: Chunk = {
  chunk_id: "smoke/dominate",
  title: "Dominate",
  text: "Dominate is a keyword ability. The attacking player chooses a defending hero to be Dominated, forcing that hero to block if able.",
  source: "pipeline/src/qa/smoke.ts fixture",
  links: [],
  tags: ["keyword"],
};

const SMOKE_CONFIG: GenerationConfig = {
  teacherModel: "claude-sonnet-5",
  maxTokens: 512,
  pairsPerChunk: 1,
  diversityInstructions: ["Produce exactly one direct factual question about the chunk."],
  batch: { size: 1, maxConcurrent: 1, requestsPerMinute: 0 },
  cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: null },
  maxRetries: 0,
  retryBaseDelayMs: 0,
};

function parseEngineArg(argv: string[]): EngineId {
  const idx = argv.indexOf("--engine");
  if (idx === -1) return DEFAULT_ENGINE_ID;
  const value = argv[idx + 1];
  if (!value || !isEngineId(value)) {
    throw new Error(
      `--engine must be one of: claude-code-subscription, anthropic-api (got ${value ?? "<missing>"})`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  const engineId = parseEngineArg(process.argv.slice(2));
  console.log(`qa-engine-smoke: engine=${engineId} model=${SMOKE_CONFIG.teacherModel}`);

  const client = buildTeacherClient(engineId);
  const request = buildTeacherRequest(SMOKE_CHUNK, SMOKE_CONFIG);

  const startedAt = Date.now();
  const response = await client.generate(request);
  const elapsedMs = Date.now() - startedAt;

  const { pairs, rejected } = parseTeacherResponse(response.text, SMOKE_CHUNK);
  const costUsd = estimateCost(response.usage, SMOKE_CONFIG.cost);

  console.log(`elapsed: ${elapsedMs}ms`);
  console.log(`usage: ${JSON.stringify(response.usage)} (~$${costUsd.toFixed(4)} at configured pricing)`);
  console.log(`accepted pairs: ${pairs.length}, rejected: ${rejected.length}`);
  for (const pair of pairs) {
    console.log(`- Q: ${pair.question}`);
    console.log(`  A: ${pair.answer}`);
  }
  if (rejected.length > 0) {
    console.log("rejected entries:", JSON.stringify(rejected, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
