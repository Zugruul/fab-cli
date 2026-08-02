import { describe, it, expect } from "vitest";
import { buildSamplingManifest, categoryOf } from "../src/sampling/manifest.js";
import { configHash } from "../src/qa/manifest.js";
import type { PairSamplingOutcome, SamplingConfig, SamplingProgressState } from "../src/sampling/types.js";
import { makePair } from "./sampling.helpers.js";

function baseConfig(overrides: Partial<SamplingConfig> = {}): SamplingConfig {
  return {
    judgeModel: "claude-sonnet-5",
    maxTokens: 1024,
    batch: { size: 10, maxConcurrent: 3, requestsPerMinute: 30 },
    cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 5 },
    maxRetries: 3,
    retryBaseDelayMs: 500,
    ...overrides,
  };
}

function outcome(overrides: Partial<PairSamplingOutcome> = {}): PairSamplingOutcome {
  return {
    pairId: "brain/judge/kw-dominate#0",
    chunk_id: "brain/judge/kw-dominate",
    pair: makePair(),
    status: "accepted",
    reason: "fully supported",
    attempts: 1,
    ...overrides,
  };
}

const emptyProgress: SamplingProgressState = { acceptedIds: [], rejectedIds: [], costUsd: 0, requestCount: 0 };

describe("categoryOf", () => {
  it("returns the leading path segment of a chunk_id", () => {
    expect(categoryOf("brain/judge/kw-dominate")).toBe("brain");
    expect(categoryOf("rules/cr/1.1")).toBe("rules");
    expect(categoryOf("lore/world-of-rathe/demonastery")).toBe("lore");
  });

  it("returns the whole string when there's no '/' at all", () => {
    expect(categoryOf("no-slash-id")).toBe("no-slash-id");
  });
});

describe("buildSamplingManifest — aggregate counts", () => {
  it("aggregates accepted/rejected counts, overall acceptance rate, judge model id, and config hash", () => {
    const config = baseConfig();
    const outcomes: PairSamplingOutcome[] = [
      outcome({ pairId: "a#0", chunk_id: "brain/judge/kw-dominate", status: "accepted" }),
      outcome({ pairId: "a#1", chunk_id: "brain/judge/kw-dominate", status: "rejected", reason: "not entailed" }),
      outcome({ pairId: "b#0", chunk_id: "rules/cr/1.1", status: "accepted" }),
    ];
    const progress: SamplingProgressState = { acceptedIds: ["a#0", "b#0"], rejectedIds: ["a#1"], costUsd: 0.05, requestCount: 3 };

    const manifest = buildSamplingManifest({
      config,
      dryRun: false,
      pairCount: 5,
      outcomes,
      progress,
      stoppedEarly: null,
      now: () => "2026-08-02T00:00:00.000Z",
    });

    expect(manifest.judgeModel).toBe("claude-sonnet-5");
    expect(manifest.configHash).toBe(configHash(config));
    expect(manifest.dryRun).toBe(false);
    expect(manifest.pairCount).toBe(5);
    expect(manifest.processedCount).toBe(3);
    expect(manifest.acceptedCount).toBe(2);
    expect(manifest.rejectedCount).toBe(1);
    expect(manifest.acceptanceRate).toBeCloseTo(2 / 3, 5);
    expect(manifest.costUsd).toBe(0.05);
    expect(manifest.requestCount).toBe(3);
    expect(manifest.runDate).toBe("2026-08-02T00:00:00.000Z");
    expect(manifest.stoppedEarly).toBeNull();
  });

  it("reports acceptanceRate 0 (not NaN) when nothing was processed", () => {
    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: false,
      pairCount: 0,
      outcomes: [],
      progress: emptyProgress,
      stoppedEarly: null,
    });
    expect(manifest.acceptanceRate).toBe(0);
    expect(manifest.categoryAcceptance).toEqual([]);
  });

  it("reflects a cost-ceiling stoppedEarly reason", () => {
    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: false,
      pairCount: 10,
      outcomes: [outcome()],
      progress: { ...emptyProgress, acceptedIds: ["brain/judge/kw-dominate#0"] },
      stoppedEarly: { reason: "cost-ceiling" },
    });
    expect(manifest.stoppedEarly).toBe("cost-ceiling");
  });
});

describe("buildSamplingManifest — per-category acceptance", () => {
  it("breaks acceptance down per chunk_id category (brain/rules/lore), sorted by category name", () => {
    const outcomes: PairSamplingOutcome[] = [
      outcome({ pairId: "brain-1#0", chunk_id: "brain/judge/kw-dominate", status: "accepted" }),
      outcome({ pairId: "brain-1#1", chunk_id: "brain/judge/kw-dominate", status: "accepted" }),
      outcome({ pairId: "brain-2#0", chunk_id: "brain/player/kw-go-again", status: "rejected", reason: "not entailed" }),
      outcome({ pairId: "rules-1#0", chunk_id: "rules/cr/1.1", status: "rejected", reason: "not entailed" }),
      outcome({ pairId: "rules-1#1", chunk_id: "rules/cr/1.1", status: "rejected", reason: "unparseable judge response" }),
      outcome({ pairId: "lore-1#0", chunk_id: "lore/world-of-rathe/demonastery", status: "accepted" }),
    ];

    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: false,
      pairCount: 6,
      outcomes,
      progress: emptyProgress,
      stoppedEarly: null,
    });

    expect(manifest.categoryAcceptance).toEqual([
      { category: "brain", accepted: 2, rejected: 1, acceptanceRate: expect.closeTo(2 / 3, 5) },
      { category: "lore", accepted: 1, rejected: 0, acceptanceRate: 1 },
      { category: "rules", accepted: 0, rejected: 2, acceptanceRate: 0 },
    ]);
  });
});

describe("buildSamplingManifest — dry run", () => {
  it("carries dryRun through with zero processed/accepted/rejected counts", () => {
    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: true,
      pairCount: 4,
      outcomes: [],
      progress: emptyProgress,
      stoppedEarly: null,
    });
    expect(manifest.dryRun).toBe(true);
    expect(manifest.processedCount).toBe(0);
    expect(manifest.acceptedCount).toBe(0);
    expect(manifest.rejectedCount).toBe(0);
  });
});
