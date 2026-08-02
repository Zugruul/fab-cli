import { describe, it, expect } from "vitest";
import { buildBehaviorDatasets, type BehaviorDatasetsConfig } from "../src/behavior/build.js";
import { makeChunks, makeLegalityChunk, makePairsRecord } from "./behavior.helpers.js";

function baseConfig(overrides: Partial<BehaviorDatasetsConfig> = {}): BehaviorDatasetsConfig {
  return {
    seed: 12345,
    distractor: { k: 2, minCount: 1 },
    abstention: { contextSize: 2, minCount: 1, messageTemplate: "not clearly settled", escalationText: "ask a judge" },
    ood: { minCount: 1, refusalTemplate: "scoped to Flesh & Blood only" },
    dpo: {
      minCount: 1,
      degradation: { hedgePrefixes: ["Based on the source: "], confidentWrongPrefix: "Definitely: " },
    },
    ...overrides,
  };
}

const OOD_BANK = { sports: ["what is offside?"], cooking: ["how do I make a roux?"] };

describe("buildBehaviorDatasets (orchestrator)", () => {
  it("builds all four categories and a manifest tying them together", () => {
    const chunks = makeChunks(10);
    const pairRecords = [makePairsRecord("chunk-1", 2), makePairsRecord("chunk-2", 2)];
    const result = buildBehaviorDatasets({
      chunks,
      pairRecords,
      oodTemplateBank: OOD_BANK,
      config: baseConfig(),
      now: () => "2026-08-02T00:00:00.000Z",
    });

    expect(result.distractor.length).toBeGreaterThan(0);
    expect(result.abstention.length).toBeGreaterThan(0);
    expect(result.ood).toHaveLength(2);
    expect(result.dpo.length).toBeGreaterThan(0);
    expect(result.manifest.counts.distractor).toBe(result.distractor.length);
    expect(result.manifest.counts.abstention).toBe(result.abstention.length);
    expect(result.manifest.counts.ood).toBe(result.ood.length);
    expect(result.manifest.counts.dpo).toBe(result.dpo.length);
    expect(result.manifest.buildDate).toBe("2026-08-02T00:00:00.000Z");
    expect(result.manifest.seed).toBe(12345);
  });

  it("is deterministic end to end: two runs with the same seed produce byte-identical datasets", () => {
    const chunks = makeChunks(15);
    const pairRecords = [makePairsRecord("chunk-1", 3), makePairsRecord("chunk-8", 2)];
    const opts = {
      chunks,
      pairRecords,
      oodTemplateBank: OOD_BANK,
      config: baseConfig(),
      now: () => "2026-08-02T00:00:00.000Z",
    };
    const a = buildBehaviorDatasets(opts);
    const b = buildBehaviorDatasets(opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a different seed changes the sampled distractor/abstention context (sanity, not a hard requirement per-run)", () => {
    const chunks = makeChunks(15);
    const pairRecords = [makePairsRecord("chunk-1", 3)];
    const a = buildBehaviorDatasets({ chunks, pairRecords, oodTemplateBank: OOD_BANK, config: baseConfig({ seed: 1 }) });
    const b = buildBehaviorDatasets({ chunks, pairRecords, oodTemplateBank: OOD_BANK, config: baseConfig({ seed: 2 }) });
    expect(JSON.stringify(a.distractor)).not.toBe(JSON.stringify(b.distractor));
  });

  it("fails loudly (throws) when a category can't meet its configured minimum, and builds nothing", () => {
    const chunks = makeChunks(10);
    const pairRecords = [makePairsRecord("chunk-1", 1)];
    expect(() =>
      buildBehaviorDatasets({
        chunks,
        pairRecords,
        oodTemplateBank: OOD_BANK,
        config: baseConfig({ dpo: { minCount: 999, degradation: { hedgePrefixes: ["x: "], confidentWrongPrefix: "y: " } } }),
      }),
    ).toThrow(/below configured minimum/);
  });

  it("surfaces the count of time-sensitive (legality-sourced) distractor examples in the manifest", () => {
    const legality = makeLegalityChunk();
    const chunks = [legality, ...makeChunks(10)];
    const pairRecords = [makePairsRecord(legality.chunk_id, 1), makePairsRecord("chunk-1", 1)];
    const result = buildBehaviorDatasets({ chunks, pairRecords, oodTemplateBank: OOD_BANK, config: baseConfig() });
    expect(result.manifest.timeSensitiveDistractorCount).toBe(1);
  });
});
