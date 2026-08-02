import type { Chunk } from "../types.js";
import type { PairsRecord } from "../qa/pairsStore.js";
import { isLegalityChunk } from "./legality.js";
import type { AnswerTarget, DPOConstructionMethod, DPOPair, SampledRecordLike } from "./types.js";

export interface DPODegradationConfig {
  /** Rotated round-robin across a chunk's pairs so `chosen` isn't always
   * prefixed identically within one chunk's example set. */
  hedgePrefixes: string[];
  /** Prepended to the answer for the "confident-wrong" synthetic variant —
   * a rule-based, offline stand-in for a fabricated-confidence rejected
   * completion (see buildDPOPairs's doc comment for why this is phrasing,
   * not a verified factual inversion). */
  confidentWrongPrefix: string;
}

export interface DPOBuildConfig {
  minCount: number;
  degradation: DPODegradationConfig;
}

export interface DPOBuildResult {
  pairs: DPOPair[];
  methodCounts: Record<DPOConstructionMethod, number>;
  skipped: { chunk_id: string; question: string; reason: string }[];
}

function byChunkId(a: { chunk_id: string }, b: { chunk_id: string }): number {
  return a.chunk_id < b.chunk_id ? -1 : a.chunk_id > b.chunk_id ? 1 : 0;
}

function key(chunk_id: string, question: string): string {
  return `${chunk_id} ${question}`;
}

/**
 * SPEC-APP.md §7.6: DPO preference pairs — chosen = a cited, hedged
 * accepted answer; rejected = a real teacher-rejected/non-entailed answer
 * from the SAME chunk when APP-012's rejection-sampling artifacts provide
 * one ("from the rejection stage's rejected file when present"), otherwise
 * a rule-based synthetic degradation of the chosen answer (citation
 * stripped, or an overconfident-framing prefix with citations dropped).
 * Every pair records its construction method.
 *
 * `acceptedRecords`/`rejectedRecords` mirror APP-012's accepted.jsonl/
 * rejected.jsonl (SampledRecordLike, structurally — see types.ts for why
 * this is a duplicate shape rather than an import of the unmerged
 * pipeline/src/sampling/** lane).
 *
 * Chosen-eligibility gating is per EXACT (chunk_id, question): once
 * rejection sampling has actually run for this chunk set (either artifact
 * is non-empty), a raw pair with no matching accepted.jsonl record hasn't
 * been confirmed entailed — it is skipped rather than assumed good, so a
 * DPO "chosen" is never built from an unverified (or explicitly rejected)
 * answer. Only when NEITHER artifact exists at all (rejection sampling
 * hasn't run) does this fall back to treating every raw pair as
 * chosen-eligible — a documented best-effort placeholder, the same pattern
 * qa/manifest.ts's ACCEPTANCE_PLACEHOLDER uses.
 *
 * Rejected-side sourcing is per CHUNK, not per exact question: a given
 * (chunk_id, question) is accepted XOR rejected by APP-012, never both, so
 * matching a rejected answer to the exact same question as an accepted one
 * can't happen on real single-pass data. Since APP-011's diversity
 * instructions push each pair to a distinct phrasing, a chunk's rejected
 * candidates (if any survived rejection sampling) are the closest
 * available real "hard negative" for that chunk's chosen answers, assigned
 * round-robin — an approximation (not a literal same-prompt contrast), and
 * used only when at least one exists; otherwise synthetic degradation.
 *
 * §7.9: chunks sourced from the live legality policy/ban list are excluded
 * entirely — a DPO chosen answer bakes the cited chunk's facts into the
 * PREFERRED completion, which is exactly the SFT-fact-training §7.9 rules
 * out for that content (unlike distractor.ts's retrieval-robustness
 * examples, which §7.9 explicitly carves out for legality content marked
 * time-sensitive).
 */
export function buildDPOPairs(
  chunks: Chunk[],
  pairRecords: PairsRecord[],
  config: DPOBuildConfig,
  acceptedRecords: SampledRecordLike[] = [],
  rejectedRecords: SampledRecordLike[] = [],
): DPOBuildResult {
  const chunksById = new Map(chunks.map((c) => [c.chunk_id, c]));
  const sortedRecords = [...pairRecords].sort(byChunkId);

  const acceptedByKey = new Map(acceptedRecords.map((r) => [key(r.chunk_id, r.question), r]));
  const rejectedByKey = new Map(rejectedRecords.map((r) => [key(r.chunk_id, r.question), r]));
  const rejectionSamplingRan = acceptedRecords.length > 0 || rejectedRecords.length > 0;

  // Rejected candidates pooled per chunk, sorted by question text so
  // round-robin assignment is deterministic regardless of file order.
  const rejectedByChunk = new Map<string, SampledRecordLike[]>();
  for (const r of rejectedRecords) {
    const list = rejectedByChunk.get(r.chunk_id) ?? [];
    list.push(r);
    rejectedByChunk.set(r.chunk_id, list);
  }
  for (const list of rejectedByChunk.values()) list.sort((a, b) => (a.question < b.question ? -1 : a.question > b.question ? 1 : 0));
  const rejectedCursor = new Map<string, number>();

  const pairs: DPOPair[] = [];
  const skipped: DPOBuildResult["skipped"] = [];
  const methodCounts: Record<DPOConstructionMethod, number> = {
    "rejection-sample": 0,
    "synthetic-citation-stripped": 0,
    "synthetic-confident-wrong": 0,
  };
  let syntheticIndex = 0;

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
    if (isLegalityChunk(sourceChunk)) {
      for (const pair of record.pairs) {
        skipped.push({
          chunk_id: record.chunk_id,
          question: pair.question,
          reason: "source chunk is live legality/ban-list content — excluded from DPO fact-training per SPEC-APP.md §7.9",
        });
      }
      continue;
    }

    record.pairs.forEach((pair, index) => {
      const k = key(record.chunk_id, pair.question);
      const accepted = acceptedByKey.get(k);

      if (rejectionSamplingRan && !accepted) {
        const reason = rejectedByKey.has(k)
          ? "pair was rejected by rejection sampling — not eligible as a DPO chosen answer"
          : "not yet processed by rejection sampling (no accepted.jsonl/rejected.jsonl record for this question)";
        skipped.push({ chunk_id: record.chunk_id, question: pair.question, reason });
        return;
      }

      const base = accepted ?? { answer: pair.answer, cited_chunk_ids: pair.cited_chunk_ids };
      const hedgePrefix = config.degradation.hedgePrefixes[index % config.degradation.hedgePrefixes.length];
      const chosen: AnswerTarget = {
        answer: `${hedgePrefix}${base.answer}`,
        citation_ids: base.cited_chunk_ids,
        confidence: "high",
      };

      const chunkRejected = rejectedByChunk.get(record.chunk_id);
      if (chunkRejected && chunkRejected.length > 0) {
        const cursor = rejectedCursor.get(record.chunk_id) ?? 0;
        const rejectedRecord = chunkRejected[cursor % chunkRejected.length];
        rejectedCursor.set(record.chunk_id, cursor + 1);

        pairs.push({
          id: `dpo-${record.chunk_id}-${index}`,
          category: "dpo",
          chunk_id: record.chunk_id,
          question: pair.question,
          chosen,
          rejected: {
            answer: rejectedRecord.answer,
            citation_ids: rejectedRecord.cited_chunk_ids,
            confidence: "high",
          },
          method: "rejection-sample",
        });
        methodCounts["rejection-sample"]++;
        return;
      }

      const method: DPOConstructionMethod =
        syntheticIndex % 2 === 0 ? "synthetic-citation-stripped" : "synthetic-confident-wrong";
      syntheticIndex++;
      const rejected: AnswerTarget =
        method === "synthetic-citation-stripped"
          ? { answer: base.answer, citation_ids: [], confidence: "high" }
          : { answer: `${config.degradation.confidentWrongPrefix}${base.answer}`, citation_ids: [], confidence: "high" };

      pairs.push({
        id: `dpo-${record.chunk_id}-${index}`,
        category: "dpo",
        chunk_id: record.chunk_id,
        question: pair.question,
        chosen,
        rejected,
        method,
      });
      methodCounts[method]++;
    });
  }

  if (pairs.length < config.minCount) {
    throw new Error(
      `dpo: built ${pairs.length} pair(s), below configured minimum ${config.minCount} (${skipped.length} pair(s) skipped)`,
    );
  }

  return { pairs, methodCounts, skipped };
}
