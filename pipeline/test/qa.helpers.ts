// Shared fixtures/mocks for the qa.*.test.ts suite (APP-011). Not itself a
// test file — vitest's default include pattern only picks up *.test.ts.
import type { Chunk } from "../src/types.js";
import type { TeacherClient, TeacherRequest, TeacherResponse } from "../src/qa/types.js";

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

export function makeChunks(n: number): Chunk[] {
  return Array.from({ length: n }, (_, i) =>
    makeChunk({
      chunk_id: `chunk-${i + 1}`,
      title: `Chunk ${i + 1}`,
      text: `Text for chunk ${i + 1}. It explains a distinct rules concept in enough detail to ground an answer.`,
    }),
  );
}

/** A class (not a plain object) so tests can assert non-retryable failures
 * carry an HTTP-style `status` the same way the Anthropic SDK's typed
 * errors do. */
export class FakeApiError extends Error {
  status: number;
  constructor(status: number, message = `fake api error ${status}`) {
    super(message);
    this.status = status;
  }
}

export type MockResponder = (
  request: TeacherRequest,
  callIndex: number,
) => TeacherResponse | Promise<TeacherResponse>;

/** Builds a TeacherClient whose `generate` is scripted per-call. `respond`
 * may return a TeacherResponse or throw/reject (including a FakeApiError)
 * to simulate failures. Every call is recorded in `.calls` for assertions. */
export function makeMockTeacher(respond: MockResponder): TeacherClient & { calls: TeacherRequest[] } {
  const calls: TeacherRequest[] = [];
  let callIndex = 0;
  return {
    calls,
    async generate(request: TeacherRequest): Promise<TeacherResponse> {
      calls.push(request);
      return respond(request, callIndex++);
    },
  };
}

/** A teacher that always returns `count` grounded, correctly-cited pairs. */
export function makeAlwaysValidTeacher(count = 2): TeacherClient & { calls: TeacherRequest[] } {
  return makeMockTeacher((request) => {
    const chunkId = extractChunkIdFromUserPrompt(request.user);
    return validPairsResponse(chunkId, count);
  });
}

export function validPairsResponse(chunkId: string, count = 2, usage = { inputTokens: 500, outputTokens: 200 }): TeacherResponse {
  const pairs = Array.from({ length: count }, (_, i) => ({
    question: `Question ${i + 1} about ${chunkId}?`,
    answer: `Answer ${i + 1}, grounded in ${chunkId}.`,
    cited_chunk_ids: [chunkId],
  }));
  return { text: JSON.stringify(pairs), usage };
}

// The prompt always embeds "chunk_id: <id>" (see prompt.ts) — used by mocks
// that need to know which chunk they were asked about without re-deriving
// the whole prompt-building logic.
export function extractChunkIdFromUserPrompt(user: string): string {
  const match = /chunk_id:\s*(\S+)/.exec(user);
  if (!match) throw new Error(`could not find chunk_id in prompt: ${user}`);
  return match[1];
}

export function noopSleep(): Promise<void> {
  return Promise.resolve();
}
