// Shared fixtures for the behavior.*.test.ts suite (APP-013). Not itself a
// test file — vitest's default include pattern only picks up *.test.ts.
import type { Chunk } from "../src/types.js";
import type { PairsRecord } from "../src/qa/pairsStore.js";
import type { SampledRecordLike } from "../src/behavior/types.js";

export function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    chunk_id: "judge/notes/kw-dominate",
    title: "Dominate",
    text: "Dominate is a keyword ability. The attacking player chooses a defending hero to be Dominated, forcing that hero to block if able.",
    source: "judge brain note",
    links: [],
    tags: ["keyword"],
    ...overrides,
  };
}

/** N chunks with distinct ids/tags/text — no two share a tag, so any two
 * are "unrelated" under abstention.ts's tag-overlap heuristic unless a
 * caller overrides tags to force a collision. */
export function makeChunks(n: number, overrides: (i: number) => Partial<Chunk> = () => ({})): Chunk[] {
  return Array.from({ length: n }, (_, i) =>
    makeChunk({
      chunk_id: `chunk-${i + 1}`,
      title: `Chunk ${i + 1}`,
      text: `Text for chunk ${i + 1}. It explains a distinct rules concept in enough detail to ground an answer.`,
      tags: [`topic-${i + 1}`],
      ...overrides(i),
    }),
  );
}

export function makeLegalityChunk(overrides: Partial<Chunk> = {}): Chunk {
  return makeChunk({
    chunk_id: "rules/legality/current",
    title: "Card Legality Policy",
    text: "Legality text as of the live policy fetch.",
    source: "https://fabtcg.com/rules-and-policy-center/card-legality-policy/",
    tags: ["legality", "rules"],
    ...overrides,
  });
}

/** One PairsRecord (APP-011's qa-pairs.jsonl shape) with `n` pairs, each
 * citing `chunk_id` (the accepted-pairs contract every accepted pair
 * satisfies — see qa/prompt.ts / qa/parse.ts). */
export function makePairsRecord(chunk_id: string, n = 1): PairsRecord {
  return {
    chunk_id,
    pairs: Array.from({ length: n }, (_, i) => ({
      question: `Question ${i + 1} about ${chunk_id}?`,
      answer: `Answer ${i + 1}, grounded in ${chunk_id}.`,
      cited_chunk_ids: [chunk_id],
    })),
  };
}

export function makeSampledRecord(
  chunk_id: string,
  question: string,
  overrides: Partial<SampledRecordLike> = {},
): SampledRecordLike {
  return {
    pairId: `${chunk_id}#0`,
    chunk_id,
    question,
    answer: `Rejected/accepted answer text for: ${question}`,
    cited_chunk_ids: [chunk_id],
    rejectionKind: null,
    reason: "test fixture",
    ...overrides,
  };
}

export function fixedNow(iso = "2026-08-02T00:00:00.000Z"): () => string {
  return () => iso;
}
