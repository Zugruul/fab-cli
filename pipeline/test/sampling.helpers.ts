// Shared fixtures/mocks for the sampling.*.test.ts suite (APP-012). Not
// itself a test file — vitest's default include pattern only picks up
// *.test.ts. Mirrors test/qa.helpers.ts's shape for the judge side.
import type { Chunk } from "../src/types.js";
import type { QAPair } from "../src/qa/types.js";
import type { JudgeClient, JudgeRequest, JudgeResponse, WorkItem } from "../src/sampling/types.js";
import { computePairContentHash } from "../src/sampling/sampler.js";

export function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    chunk_id: "brain/judge/kw-dominate",
    title: "Dominate",
    text: "Dominate is a keyword ability. The attacking player chooses a defending hero to be Dominated, forcing that hero to block if able.",
    source: "judge brain note",
    links: [],
    tags: ["keyword"],
    ...overrides,
  };
}

export function makePair(overrides: Partial<QAPair> = {}): QAPair {
  return {
    question: "What does Dominate force the defending hero to do?",
    answer: "It forces the chosen defending hero to block if able.",
    cited_chunk_ids: ["brain/judge/kw-dominate"],
    ...overrides,
  };
}

/** `pairContentHash` is derived from `pair` (or from `overrides.pair` when
 * given) unless the caller overrides it explicitly — that override is what
 * BUG-180's staleness tests use to simulate a progress record whose
 * recorded hash predates a content change. */
export function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  const pair = overrides.pair ?? makePair();
  return {
    pairId: "brain/judge/kw-dominate#0",
    chunk_id: "brain/judge/kw-dominate",
    pair,
    pairContentHash: computePairContentHash(pair),
    ...overrides,
  };
}

export function makeWorkItems(n: number, chunkId = "chunk"): WorkItem[] {
  return Array.from({ length: n }, (_, i) => {
    const chunk_id = `${chunkId}-${i + 1}`;
    return makeWorkItem({
      pairId: `${chunk_id}#0`,
      chunk_id,
      pair: makePair({
        question: `Question about ${chunk_id}?`,
        answer: `Answer grounded in ${chunk_id}.`,
        cited_chunk_ids: [chunk_id],
      }),
    });
  });
}

export function makeChunksById(workItems: WorkItem[]): Map<string, Chunk> {
  const ids = new Set(workItems.map((w) => w.chunk_id));
  return new Map(
    Array.from(ids, (chunk_id) => [
      chunk_id,
      makeChunk({ chunk_id, title: chunk_id, text: `Text for ${chunk_id}, detailed enough to ground an answer.` }),
    ]),
  );
}

/** A class (not a plain object) so tests can assert non-retryable failures
 * carry an HTTP-style `status` the same way the Anthropic SDK's typed
 * errors do (mirrors qa.helpers.ts's FakeApiError). */
export class FakeApiError extends Error {
  status: number;
  constructor(status: number, message = `fake api error ${status}`) {
    super(message);
    this.status = status;
  }
}

export type MockResponder = (
  request: JudgeRequest,
  callIndex: number,
) => JudgeResponse | Promise<JudgeResponse>;

/** Builds a JudgeClient whose `check` is scripted per-call. `respond` may
 * return a JudgeResponse or throw/reject (including a FakeApiError) to
 * simulate failures. Every call is recorded in `.calls` for assertions. */
export function makeMockJudge(respond: MockResponder): JudgeClient & { calls: JudgeRequest[] } {
  const calls: JudgeRequest[] = [];
  let callIndex = 0;
  return {
    calls,
    async check(request: JudgeRequest): Promise<JudgeResponse> {
      calls.push(request);
      return respond(request, callIndex++);
    },
  };
}

const DEFAULT_USAGE = { inputTokens: 300, outputTokens: 60 };

export function entailedResponse(reason = "the answer restates the chunk text", usage = DEFAULT_USAGE): JudgeResponse {
  return { text: JSON.stringify({ entailed: true, reason }), usage };
}

export function notEntailedResponse(reason = "the answer adds a fact not present in the chunk", usage = DEFAULT_USAGE): JudgeResponse {
  return { text: JSON.stringify({ entailed: false, reason }), usage };
}

/** A second not-entailed flavor, distinct from the fabricated-fact case:
 * the answer states something that's TRUE in general (or true of a
 * different card/rule), but this specific chunk never says it — the
 * entailment check is against the given chunk's text only, not against
 * "is this true anywhere in the corpus". Regression coverage for a judge
 * (or a reviewer) being tempted to accept a true-but-unsupported answer. */
export function notEntailedWrongChunkResponse(
  reason = "the statement is accurate, but this chunk doesn't say it — it belongs to a different chunk, and grounding must come from the given chunk alone",
  usage = DEFAULT_USAGE,
): JudgeResponse {
  return { text: JSON.stringify({ entailed: false, reason }), usage };
}

export function malformedJsonResponse(usage = DEFAULT_USAGE): JudgeResponse {
  return { text: "{entailed: true, reason: not valid json,,,", usage };
}

export function refusalResponse(usage = DEFAULT_USAGE): JudgeResponse {
  return { text: "I'm sorry, I can't help evaluate this request.", usage };
}

export function truncatedResponse(usage = DEFAULT_USAGE): JudgeResponse {
  return { text: '{"entailed": true, "reason": "the answer is supp', usage };
}

/** A judge that always returns an entailed verdict for every call. */
export function makeAlwaysEntailedJudge(): JudgeClient & { calls: JudgeRequest[] } {
  return makeMockJudge(() => entailedResponse());
}

export function noopSleep(): Promise<void> {
  return Promise.resolve();
}
