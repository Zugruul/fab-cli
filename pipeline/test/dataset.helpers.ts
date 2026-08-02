// Shared fixtures for the dataset.*.test.ts suite (APP-014). Not itself a
// test file — vitest's default include pattern only picks up *.test.ts.
import type { Chunk } from "../src/types.js";
import type { PairsRecord } from "../src/qa/pairsStore.js";
import type { SampledRecord } from "../src/sampling/store.js";
import type { DistractorExample, AbstentionExample, OODExample, DPOPair } from "../src/behavior/types.js";

export function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    chunk_id: "brain/judge/combat-chain-steps",
    title: "Combat Chain Steps",
    text: "The combat chain has several steps: Layer, Attack, Defend, Damage, Reaction, Resolution, Link.",
    source: "judge brain note",
    links: [],
    tags: [],
    ...overrides,
  };
}

/** N chunks with distinct ids/categories, spread deterministically across
 * every §7.8 chunk-grounded category so split/leakage tests have several
 * chunks per category to shuffle. */
export function makeChunks(n: number, overrides: (i: number) => Partial<Chunk> = () => ({})): Chunk[] {
  const patterns: Partial<Chunk>[] = [
    { chunk_id: "brain/card-vault/kw-dominate", title: "Dominate", tags: ["keyword"] },
    { chunk_id: "brain/card-vault/card-heartstoker-branchblade", title: "Heartstoker, Branchblade", tags: [] },
    { chunk_id: "brain/judge/ci-steal-is-gain-control", title: "Steal is Gain Control", tags: [] },
    { chunk_id: "rules/trp/1.1", title: "TRP 1.1", tags: ["trp", "rules"] },
    { chunk_id: "lore/world-of-rathe/demonastery", title: "Demonastery", tags: ["lore"] },
  ];
  return Array.from({ length: n }, (_, i) => {
    const pattern = patterns[i % patterns.length];
    const suffix = Math.floor(i / patterns.length);
    return makeChunk({
      ...pattern,
      chunk_id: `${pattern.chunk_id}${suffix > 0 ? `-${suffix}` : ""}`,
      ...overrides(i),
    });
  });
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

export function makeSampledRecord(chunk_id: string, index: number, overrides: Partial<SampledRecord> = {}): SampledRecord {
  return {
    pairId: `${chunk_id}#${index}`,
    chunk_id,
    question: `Question ${index + 1} about ${chunk_id}?`,
    answer: `Answer ${index + 1}, grounded in ${chunk_id}.`,
    cited_chunk_ids: [chunk_id],
    rejectionKind: null,
    reason: "entailed",
    ...overrides,
  };
}

export function makeDistractorExample(chunk_id: string, index = 0, overrides: Partial<DistractorExample> = {}): DistractorExample {
  return {
    id: `distractor-${chunk_id}-${index}`,
    category: "distractor",
    chunk_id,
    question: `Question ${index + 1} about ${chunk_id}, with distractors?`,
    contextChunkIds: [chunk_id, "brain/judge/other-chunk-1", "brain/judge/other-chunk-2"],
    target: { answer: `Answer grounded in ${chunk_id}.`, citation_ids: [chunk_id], confidence: "high" },
    timeSensitive: false,
    ...overrides,
  };
}

export function makeAbstentionExample(sourceChunkId: string, index = 0, overrides: Partial<AbstentionExample> = {}): AbstentionExample {
  return {
    id: `abstention-${sourceChunkId}-${index}`,
    category: "abstention",
    sourceChunkId,
    question: `Question ${index + 1} the provided context doesn't answer?`,
    contextChunkIds: ["brain/judge/unrelated-1", "brain/judge/unrelated-2"],
    target: {
      answer: "not clearly settled",
      citation_ids: [],
      confidence: "abstain",
      abstained: true,
      escalation: "ask a judge",
    },
    ...overrides,
  };
}

export function makeOODExample(style: string, index = 0, overrides: Partial<OODExample> = {}): OODExample {
  return {
    id: `ood-${style}-${index}`,
    category: "ood",
    style,
    question: `What's the best deck in some other card game #${index}?`,
    target: { answer: "scoped to Flesh & Blood only", citation_ids: [], confidence: "high" },
    ...overrides,
  };
}

export function makeDPOPair(chunk_id: string, index = 0, overrides: Partial<DPOPair> = {}): DPOPair {
  return {
    id: `dpo-${chunk_id}-${index}`,
    category: "dpo",
    chunk_id,
    question: `Question ${index + 1} about ${chunk_id}?`,
    chosen: { answer: `Cited answer for ${chunk_id}.`, citation_ids: [chunk_id], confidence: "high" },
    rejected: { answer: `Uncited answer for ${chunk_id}.`, citation_ids: [], confidence: "high" },
    method: "synthetic-citation-stripped",
    ...overrides,
  };
}

export function fixedNow(iso = "2026-08-02T00:00:00.000Z"): () => string {
  return () => iso;
}
