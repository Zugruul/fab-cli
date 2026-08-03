import { describe, it, expect } from "vitest";
import { configHash, buildRunManifest } from "../src/qa/manifest.js";
import type { ChunkGenerationOutcome, GenerationConfig, ProgressState } from "../src/qa/types.js";

function baseConfig(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    teacherModel: "claude-sonnet-5",
    maxTokens: 2048,
    pairsPerChunk: 4,
    diversityInstructions: ["Vary phrasing."],
    batch: { size: 10, maxConcurrent: 3, requestsPerMinute: 30 },
    cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 5 },
    maxRetries: 3,
    retryBaseDelayMs: 500,
    ...overrides,
  };
}

describe("configHash", () => {
  it("is deterministic regardless of key insertion order", () => {
    const a = { model: "x", pairsPerChunk: 4, nested: { b: 1, a: 2 } };
    const b = { nested: { a: 2, b: 1 }, pairsPerChunk: 4, model: "x" };
    expect(configHash(a)).toBe(configHash(b));
  });

  it("changes when a value changes", () => {
    const a = { model: "x", pairsPerChunk: 4 };
    const b = { model: "x", pairsPerChunk: 5 };
    expect(configHash(a)).not.toBe(configHash(b));
  });

  it("produces a hex digest", () => {
    expect(configHash({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("buildRunManifest", () => {
  function outcome(overrides: Partial<ChunkGenerationOutcome> = {}): ChunkGenerationOutcome {
    return {
      chunk_id: "chunk-1",
      status: "ok",
      pairs: [{ question: "Q?", answer: "A.", cited_chunk_ids: ["chunk-1"] }],
      rejected: [],
      attempts: 1,
      ...overrides,
    };
  }

  it("aggregates counts, includes the teacher model id and config hash, and reflects dry-run status", () => {
    const outcomes: ChunkGenerationOutcome[] = [
      outcome({
        chunk_id: "chunk-1",
        pairs: [
          { question: "Q1?", answer: "A1.", cited_chunk_ids: ["chunk-1"] },
          { question: "Q2?", answer: "A2.", cited_chunk_ids: ["chunk-1"] },
        ],
        rejected: [{ reason: "bad citation" }],
      }),
      outcome({ chunk_id: "chunk-2", status: "failed", pairs: [], failureReason: "api error" }),
    ];
    const progress: ProgressState = {
      doneChunkIds: ["chunk-1"],
      failed: [{ chunk_id: "chunk-2", reason: "api error" }],
      costUsd: 0.0123,
      requestCount: 2,
    };
    const config = baseConfig();

    const manifest = buildRunManifest({
      config,
      dryRun: false,
      chunkCount: 5,
      outcomes,
      progress,
      stoppedEarly: null,
      engineId: "claude-code-subscription",
      now: () => "2026-08-02T00:00:00.000Z",
    });

    expect(manifest.teacherModel).toBe("claude-sonnet-5");
    expect(manifest.engineId).toBe("claude-code-subscription");
    expect(manifest.configHash).toBe(configHash(config));
    expect(manifest.dryRun).toBe(false);
    expect(manifest.chunkCount).toBe(5);
    expect(manifest.processedCount).toBe(2);
    expect(manifest.acceptedPairCount).toBe(2);
    expect(manifest.rejectedPairCount).toBe(1);
    expect(manifest.failedChunkCount).toBe(1);
    expect(manifest.costUsd).toBe(0.0123);
    expect(manifest.requestCount).toBe(2);
    expect(manifest.stoppedEarly).toBeNull();
    expect(manifest.runDate).toBe("2026-08-02T00:00:00.000Z");
    // acceptance rate is a placeholder here — real entailment-based
    // acceptance sampling is APP-012's job (SPEC-APP.md §7.4/§7.7).
    expect(manifest.acceptancePlaceholder).toMatch(/APP-012/);
  });

  it("records a stoppedEarly reason string when the run was cut short", () => {
    const config = baseConfig();
    const manifest = buildRunManifest({
      config,
      dryRun: false,
      chunkCount: 10,
      outcomes: [outcome()],
      progress: { doneChunkIds: ["chunk-1"], failed: [], costUsd: 5.01, requestCount: 1 },
      stoppedEarly: { reason: "cost-ceiling" },
      engineId: "claude-code-subscription",
    });
    expect(manifest.stoppedEarly).toBe("cost-ceiling");
  });

  it("reports a real runDate by default (no fixed clock injected)", () => {
    const config = baseConfig();
    const manifest = buildRunManifest({
      config,
      dryRun: true,
      chunkCount: 3,
      outcomes: [],
      progress: { doneChunkIds: [], failed: [], costUsd: 0, requestCount: 0 },
      stoppedEarly: null,
      engineId: "claude-code-subscription",
    });
    expect(() => new Date(manifest.runDate).toISOString()).not.toThrow();
  });

  it("records the engine id alongside the teacher model id (issue #223 — reproducibility invariant §13.7: every generation run's transport must be auditable, not just its model)", () => {
    const config = baseConfig();
    const manifest = buildRunManifest({
      config,
      dryRun: false,
      chunkCount: 1,
      outcomes: [outcome()],
      progress: { doneChunkIds: ["chunk-1"], failed: [], costUsd: 0.01, requestCount: 1 },
      stoppedEarly: null,
      engineId: "anthropic-api",
    });
    expect(manifest.engineId).toBe("anthropic-api");
  });

  it("throws at runtime if engineId is falsy, even when a caller bypasses TypeScript (e.g. `as any`) — a manifest must never silently record a hole in the reproducibility invariant (§13.7)", () => {
    const config = baseConfig();
    const baseOpts = {
      config,
      dryRun: false,
      chunkCount: 1,
      outcomes: [outcome()],
      progress: { doneChunkIds: ["chunk-1"], failed: [], costUsd: 0.01, requestCount: 1 },
      stoppedEarly: null,
    };

    expect(() => buildRunManifest({ ...baseOpts, engineId: undefined as any })).toThrow(/engineId/i);
    expect(() => buildRunManifest({ ...baseOpts, engineId: "" as any })).toThrow(/engineId/i);
  });
});
