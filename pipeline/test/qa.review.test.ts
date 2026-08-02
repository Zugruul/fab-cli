import { describe, it, expect } from "vitest";
import { buildReviewMarkdown } from "../src/qa/review.js";
import { makeChunk } from "./qa.helpers.js";
import type { ChunkGenerationOutcome } from "../src/qa/types.js";

describe("buildReviewMarkdown", () => {
  it("renders a markdown table with one row per generated pair, including the chunk's title", () => {
    const chunk = makeChunk({ chunk_id: "chunk-1", title: "Dominate" });
    const outcomes: ChunkGenerationOutcome[] = [
      {
        chunk_id: "chunk-1",
        status: "ok",
        pairs: [
          { question: "What does Dominate force?", answer: "It forces a block.", cited_chunk_ids: ["chunk-1"] },
          { question: "Who chooses the target?", answer: "The attacking player.", cited_chunk_ids: ["chunk-1"] },
        ],
        rejected: [],
        attempts: 1,
      },
    ];
    const md = buildReviewMarkdown(outcomes, new Map([[chunk.chunk_id, chunk]]));

    expect(md).toContain("|");
    expect(md).toMatch(/Question/i);
    expect(md).toMatch(/Answer/i);
    expect(md).toContain("Dominate");
    expect(md).toContain("What does Dominate force?");
    expect(md).toContain("It forces a block.");
    expect(md).toContain("Who chooses the target?");
  });

  it("surfaces failed chunks and their reason distinctly, without pretending they produced pairs", () => {
    const chunk = makeChunk({ chunk_id: "chunk-2", title: "Go again" });
    const outcomes: ChunkGenerationOutcome[] = [
      {
        chunk_id: "chunk-2",
        status: "failed",
        pairs: [],
        rejected: [],
        attempts: 4,
        failureReason: "rate limited after 3 retries",
      },
    ];
    const md = buildReviewMarkdown(outcomes, new Map([[chunk.chunk_id, chunk]]));
    expect(md).toContain("chunk-2");
    expect(md).toMatch(/failed/i);
    expect(md).toContain("rate limited after 3 retries");
  });

  it("does not throw and produces a header on an empty outcome set", () => {
    const md = buildReviewMarkdown([], new Map());
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
    expect(md).toMatch(/Question/i);
  });

  it("falls back to the chunk_id when no chunk metadata is available for a title", () => {
    const outcomes: ChunkGenerationOutcome[] = [
      {
        chunk_id: "unknown-chunk",
        status: "ok",
        pairs: [{ question: "Q?", answer: "A.", cited_chunk_ids: ["unknown-chunk"] }],
        rejected: [],
        attempts: 1,
      },
    ];
    const md = buildReviewMarkdown(outcomes, new Map());
    expect(md).toContain("unknown-chunk");
  });
});
