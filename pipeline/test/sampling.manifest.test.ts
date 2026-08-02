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

/** status defaults to "accepted" (rejectionKind null); overriding status to
 * "rejected" without an explicit rejectionKind defaults to "not-entailed"
 * (the more common case in these tests) — override rejectionKind directly
 * for an infra-error fixture. */
function outcome(overrides: Partial<PairSamplingOutcome> = {}): PairSamplingOutcome {
  const status = overrides.status ?? "accepted";
  return {
    pairId: "brain/judge/kw-dominate#0",
    chunk_id: "brain/judge/kw-dominate",
    pair: makePair(),
    status,
    rejectionKind: status === "accepted" ? null : "not-entailed",
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
  it("aggregates accepted/rejected(NotEntailed/Infra) counts, acceptance rates, judge model id, and config hash", () => {
    const config = baseConfig();
    const outcomes: PairSamplingOutcome[] = [
      outcome({ pairId: "a#0", chunk_id: "brain/judge/kw-dominate", status: "accepted" }),
      outcome({ pairId: "a#1", chunk_id: "brain/judge/kw-dominate", status: "rejected", rejectionKind: "not-entailed", reason: "not entailed" }),
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
    expect(manifest.rejectedNotEntailedCount).toBe(1);
    expect(manifest.rejectedInfraCount).toBe(0);
    // No infra rejections here, so acceptanceRate and rawAcceptanceRate agree.
    expect(manifest.acceptanceRate).toBeCloseTo(2 / 3, 5);
    expect(manifest.rawAcceptanceRate).toBeCloseTo(2 / 3, 5);
    expect(manifest.costUsd).toBe(0.05);
    expect(manifest.requestCount).toBe(3);
    expect(manifest.runDate).toBe("2026-08-02T00:00:00.000Z");
    expect(manifest.stoppedEarly).toBeNull();
  });

  it("reports acceptanceRate and rawAcceptanceRate as 0 (not NaN) when nothing was processed", () => {
    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: false,
      pairCount: 0,
      outcomes: [],
      progress: emptyProgress,
      stoppedEarly: null,
    });
    expect(manifest.acceptanceRate).toBe(0);
    expect(manifest.rawAcceptanceRate).toBe(0);
    expect(manifest.rejectedNotEntailedCount).toBe(0);
    expect(manifest.rejectedInfraCount).toBe(0);
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

describe("buildSamplingManifest — per-category acceptance, split by rejectionKind", () => {
  it("breaks acceptance down per chunk_id category (brain/rules/lore), sorted by category name, with rejectedNotEntailed/rejectedInfra split", () => {
    const outcomes: PairSamplingOutcome[] = [
      outcome({ pairId: "brain-1#0", chunk_id: "brain/judge/kw-dominate", status: "accepted" }),
      outcome({ pairId: "brain-1#1", chunk_id: "brain/judge/kw-dominate", status: "accepted" }),
      outcome({ pairId: "brain-2#0", chunk_id: "brain/player/kw-go-again", status: "rejected", rejectionKind: "not-entailed", reason: "not entailed" }),
      outcome({ pairId: "rules-1#0", chunk_id: "rules/cr/1.1", status: "rejected", rejectionKind: "not-entailed", reason: "not entailed" }),
      outcome({ pairId: "rules-1#1", chunk_id: "rules/cr/1.1", status: "rejected", rejectionKind: "infra-error", reason: "unparseable judge response" }),
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
      {
        category: "brain",
        accepted: 2,
        rejected: 1,
        rejectedNotEntailed: 1,
        rejectedInfra: 0,
        acceptanceRate: expect.closeTo(2 / 3, 5),
        rawAcceptanceRate: expect.closeTo(2 / 3, 5),
      },
      {
        category: "lore",
        accepted: 1,
        rejected: 0,
        rejectedNotEntailed: 0,
        rejectedInfra: 0,
        acceptanceRate: 1,
        rawAcceptanceRate: 1,
      },
      {
        // rules: 0 accepted, 1 genuine not-entailed rejection, 1 infra-error
        // rejection. acceptanceRate excludes the infra one from the
        // denominator entirely (0/(0+1) = 0); rawAcceptanceRate includes
        // it (0/(0+1+1) = 0) — both happen to be 0 here, but the counts
        // prove the two rejections were bucketed distinctly.
        category: "rules",
        accepted: 0,
        rejected: 2,
        rejectedNotEntailed: 1,
        rejectedInfra: 1,
        acceptanceRate: 0,
        rawAcceptanceRate: 0,
      },
    ]);
  });
});

describe("buildSamplingManifest — outage simulation: infra failures don't tank the entailment acceptance rate", () => {
  it("keeps acceptanceRate reflecting only genuine not-entailed rejections while rawAcceptanceRate absorbs a burst of infra-error rejections", () => {
    const accepted = Array.from({ length: 8 }, (_, i) =>
      outcome({ pairId: `ok-${i}#0`, chunk_id: `brain/judge/kw-ok-${i}`, status: "accepted" }),
    );
    const genuinelyBad = Array.from({ length: 2 }, (_, i) =>
      outcome({
        pairId: `bad-${i}#0`,
        chunk_id: `brain/judge/kw-bad-${i}`,
        status: "rejected",
        rejectionKind: "not-entailed",
        reason: "fabricated fact",
      }),
    );
    // A judge-API outage during this run: 10 pairs that never got a real
    // verdict at all.
    const outageNoise = Array.from({ length: 10 }, (_, i) =>
      outcome({
        pairId: `outage-${i}#0`,
        chunk_id: `brain/judge/kw-outage-${i}`,
        status: "rejected",
        rejectionKind: "infra-error",
        reason: "judge check failed: 503",
      }),
    );

    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: false,
      pairCount: 20,
      outcomes: [...accepted, ...genuinelyBad, ...outageNoise],
      progress: emptyProgress,
      stoppedEarly: null,
    });

    expect(manifest.acceptedCount).toBe(8);
    expect(manifest.rejectedNotEntailedCount).toBe(2);
    expect(manifest.rejectedInfraCount).toBe(10);
    expect(manifest.rejectedCount).toBe(12);

    // The entailment-quality signal (8 good out of 10 real verdicts) is
    // untouched by the outage.
    expect(manifest.acceptanceRate).toBeCloseTo(8 / 10, 5);
    // The raw, un-adjusted rate DOES reflect the outage — this is exactly
    // the number that would mislead a dashboard into thinking pair
    // quality cratered when really the judge API just had a bad run.
    expect(manifest.rawAcceptanceRate).toBeCloseTo(8 / 20, 5);
    expect(manifest.acceptanceRate).toBeGreaterThan(manifest.rawAcceptanceRate);
  });
});

describe("buildSamplingManifest — BUG-180 staleness-guard counts", () => {
  it("surfaces staleReprocessedCount and legacyUnverifiedCount when provided", () => {
    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: false,
      pairCount: 3,
      outcomes: [outcome()],
      progress: { ...emptyProgress, acceptedIds: ["brain/judge/kw-dominate#0"] },
      stoppedEarly: null,
      staleReprocessedCount: 2,
      legacyUnverifiedCount: 5,
    });
    expect(manifest.staleReprocessedCount).toBe(2);
    expect(manifest.legacyUnverifiedCount).toBe(5);
  });

  it("defaults both counts to 0 when omitted (pre-BUG-180 call sites)", () => {
    const manifest = buildSamplingManifest({
      config: baseConfig(),
      dryRun: false,
      pairCount: 0,
      outcomes: [],
      progress: emptyProgress,
      stoppedEarly: null,
    });
    expect(manifest.staleReprocessedCount).toBe(0);
    expect(manifest.legacyUnverifiedCount).toBe(0);
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
    expect(manifest.rejectedNotEntailedCount).toBe(0);
    expect(manifest.rejectedInfraCount).toBe(0);
  });
});
