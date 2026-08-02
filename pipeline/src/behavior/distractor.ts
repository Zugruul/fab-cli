import type { Chunk } from "../types.js";
import type { PairsRecord } from "../qa/pairsStore.js";
import { sampleWithoutReplacement, shuffle } from "./rng.js";
import { isLegalityChunk } from "./legality.js";
import type { DistractorExample } from "./types.js";

export interface DistractorBuildConfig {
  /** Number of distractor (irrelevant) chunks bundled per example. */
  k: number;
  minCount: number;
}

export interface DistractorBuildResult {
  examples: DistractorExample[];
  /** Pairs skipped because the source chunk_id wasn't in the exported
   * chunk set, or there weren't enough OTHER chunks to draw k distractors
   * from — never silently dropped without a reason. */
  skipped: { chunk_id: string; question: string; reason: string }[];
}

function byChunkId(a: { chunk_id: string }, b: { chunk_id: string }): number {
  return a.chunk_id < b.chunk_id ? -1 : a.chunk_id > b.chunk_id ? 1 : 0;
}

/**
 * SPEC-APP.md §7.5a: prompts bundling the source chunk plus K distractor
 * chunks (sampled from OTHER chunks, deterministic given `rng`'s seed); the
 * target answer uses only the relevant chunk, with its already-validated
 * citation (accepted pairs only ever cite their own source chunk — see
 * qa/parse.ts). Chunks and pair records are sorted by chunk_id before any
 * sampling so the result depends only on (chunks, pairRecords, config, seed)
 * — never on JSONL read order.
 */
export function buildDistractorExamples(
  chunks: Chunk[],
  pairRecords: PairsRecord[],
  config: DistractorBuildConfig,
  rng: () => number,
): DistractorBuildResult {
  const sortedChunks = [...chunks].sort(byChunkId);
  const chunksById = new Map(sortedChunks.map((c) => [c.chunk_id, c]));
  const sortedRecords = [...pairRecords].sort(byChunkId);

  const examples: DistractorExample[] = [];
  const skipped: DistractorBuildResult["skipped"] = [];

  for (const record of sortedRecords) {
    const sourceChunk = chunksById.get(record.chunk_id);
    if (!sourceChunk) {
      for (const pair of record.pairs) {
        skipped.push({
          chunk_id: record.chunk_id,
          question: pair.question,
          reason: "source chunk not found in exported chunk set",
        });
      }
      continue;
    }

    const otherChunks = sortedChunks.filter((c) => c.chunk_id !== record.chunk_id);

    record.pairs.forEach((pair, index) => {
      if (otherChunks.length < config.k) {
        skipped.push({
          chunk_id: record.chunk_id,
          question: pair.question,
          reason: `distractor: only ${otherChunks.length} other chunk(s) available, need ${config.k}`,
        });
        return;
      }

      const distractors = sampleWithoutReplacement(otherChunks, config.k, rng);
      const contextChunkIds = shuffle([sourceChunk.chunk_id, ...distractors.map((d) => d.chunk_id)], rng);

      examples.push({
        id: `distractor-${record.chunk_id}-${index}`,
        category: "distractor",
        chunk_id: sourceChunk.chunk_id,
        question: pair.question,
        contextChunkIds,
        target: { answer: pair.answer, citation_ids: pair.cited_chunk_ids, confidence: "high" },
        timeSensitive: isLegalityChunk(sourceChunk),
      });
    });
  }

  if (examples.length < config.minCount) {
    throw new Error(
      `distractor: built ${examples.length} example(s), below configured minimum ${config.minCount} ` +
        `(${skipped.length} pair(s) skipped)`,
    );
  }

  return { examples, skipped };
}
