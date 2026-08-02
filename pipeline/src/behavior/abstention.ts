import type { Chunk } from "../types.js";
import type { PairsRecord } from "../qa/pairsStore.js";
import { sampleWithoutReplacement, shuffle } from "./rng.js";
import type { AbstentionExample, AbstentionTarget } from "./types.js";

export interface AbstentionBuildConfig {
  /** Number of context chunks bundled per example, none of which answer
   * the question. */
  contextSize: number;
  minCount: number;
  /** The abstention message used as `target.answer` for every example. */
  messageTemplate: string;
  /** The judge-escalation pointer used as `target.escalation` for every
   * example (SPEC-APP.md §10.4 / `rules ask`'s #ask-a-judge contract). */
  escalationText: string;
}

export interface AbstentionBuildResult {
  examples: AbstentionExample[];
  skipped: { chunk_id: string; question: string; reason: string }[];
}

function byChunkId(a: { chunk_id: string }, b: { chunk_id: string }): number {
  return a.chunk_id < b.chunk_id ? -1 : a.chunk_id > b.chunk_id ? 1 : 0;
}

function sharesTag(a: Chunk, b: Chunk): boolean {
  return a.tags.some((t) => b.tags.includes(t));
}

/**
 * SPEC-APP.md §7.5b: prompts whose provided chunks do NOT answer the
 * question — the question comes from one chunk, the bundled context chunks
 * are deliberately unrelated. "Unrelated" is a best-effort, fully-offline
 * heuristic (no semantic similarity model available here): a chunk
 * qualifies only if it isn't the source chunk itself, isn't one the source
 * chunk links to, and shares no tag with the source chunk. When too few
 * chunks satisfy that bar for a given question, the question is skipped
 * (recorded, not silently dropped) rather than risking a context that
 * might actually answer it — abstention-quality correctness matters more
 * here than hitting the minimum via a weaker heuristic.
 */
export function buildAbstentionExamples(
  chunks: Chunk[],
  pairRecords: PairsRecord[],
  config: AbstentionBuildConfig,
  rng: () => number,
): AbstentionBuildResult {
  const sortedChunks = [...chunks].sort(byChunkId);
  const chunksById = new Map(sortedChunks.map((c) => [c.chunk_id, c]));
  const sortedRecords = [...pairRecords].sort(byChunkId);

  const target: AbstentionTarget = {
    answer: config.messageTemplate,
    citation_ids: [],
    confidence: "abstain",
    abstained: true,
    escalation: config.escalationText,
  };

  const examples: AbstentionExample[] = [];
  const skipped: AbstentionBuildResult["skipped"] = [];

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

    const unrelated = sortedChunks.filter(
      (c) =>
        c.chunk_id !== record.chunk_id &&
        !sourceChunk.links.includes(c.chunk_id) &&
        !sharesTag(c, sourceChunk),
    );

    record.pairs.forEach((pair, index) => {
      if (unrelated.length < config.contextSize) {
        skipped.push({
          chunk_id: record.chunk_id,
          question: pair.question,
          reason: `only ${unrelated.length} topically-unrelated chunk(s) available, need ${config.contextSize}`,
        });
        return;
      }

      const context = sampleWithoutReplacement(unrelated, config.contextSize, rng);

      examples.push({
        id: `abstention-${record.chunk_id}-${index}`,
        category: "abstention",
        sourceChunkId: record.chunk_id,
        question: pair.question,
        contextChunkIds: shuffle(context.map((c) => c.chunk_id), rng),
        target,
      });
    });
  }

  if (examples.length < config.minCount) {
    throw new Error(
      `abstention: built ${examples.length} example(s), below configured minimum ${config.minCount} ` +
        `(${skipped.length} pair(s) skipped)`,
    );
  }

  return { examples, skipped };
}
