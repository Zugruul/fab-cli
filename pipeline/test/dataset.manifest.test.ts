import { describe, it, expect } from "vitest";
import { configHash } from "../src/qa/manifest.js";
import { buildDatasetManifest, type BuildDatasetManifestOptions } from "../src/dataset/manifest.js";
import type { DatasetExample } from "../src/dataset/types.js";

function qaEx(chunkId: string, category: DatasetExample["category"], split: DatasetExample["split"]): DatasetExample {
  return {
    id: `qa-${chunkId}`,
    category,
    adjudicationCritical: false,
    exampleType: "qa",
    chunkId,
    split,
    payload: { id: `qa-${chunkId}`, chunk_id: chunkId, question: "q?", answer: "a.", cited_chunk_ids: [chunkId], entailmentChecked: true },
  } as DatasetExample;
}

function oodEx(id: string, split: DatasetExample["split"]): DatasetExample {
  return {
    id,
    category: "ood",
    adjudicationCritical: false,
    exampleType: "ood",
    chunkId: null,
    split,
    payload: { id, category: "ood", style: "sports", question: "q?", target: { answer: "no", citation_ids: [], confidence: "high" } },
  } as DatasetExample;
}

function baseOptions(overrides: Partial<BuildDatasetManifestOptions> = {}): BuildDatasetManifestOptions {
  return {
    examples: [],
    config: { seed: 1, evalFraction: 0.2 },
    seed: 1,
    evalFraction: 0.2,
    corpusSnapshot: null,
    teacherModel: null,
    qaSource: "qa-pairs-fallback",
    notes: [],
    ...overrides,
  };
}

describe("configHash reuse", () => {
  it("dataset manifest reuses qa/manifest.ts's configHash (no reinvented hashing)", () => {
    const config = { seed: 1, evalFraction: 0.2 };
    const manifest = buildDatasetManifest(baseOptions({ config, now: () => "2026-08-02T00:00:00.000Z" }));
    expect(manifest.datasetConfigHash).toBe(configHash(config));
  });
});

describe("buildDatasetManifest", () => {
  it("aggregates counts per category and per example type, split by train/eval", () => {
    const examples: DatasetExample[] = [
      qaEx("a", "keyword-definitions", "train"),
      qaEx("b", "keyword-definitions", "train"),
      qaEx("c", "keyword-definitions", "eval"),
      qaEx("d", "card-facts", "train"),
      oodEx("ood-1", "train"),
      oodEx("ood-2", "eval"),
    ];

    const manifest = buildDatasetManifest(baseOptions({ examples, now: () => "2026-08-02T00:00:00.000Z" }));

    expect(manifest.counts.total).toEqual({ train: 4, eval: 2 });
    expect(manifest.counts.byCategory["keyword-definitions"]).toEqual({ train: 2, eval: 1 });
    expect(manifest.counts.byCategory["card-facts"]).toEqual({ train: 1, eval: 0 });
    expect(manifest.counts.byCategory["ood"]).toEqual({ train: 1, eval: 1 });
    expect(manifest.counts.byCategory["lore"]).toEqual({ train: 0, eval: 0 });
    expect(manifest.counts.byExampleType["qa"]).toEqual({ train: 3, eval: 1 });
    expect(manifest.counts.byExampleType["ood"]).toEqual({ train: 1, eval: 1 });
    expect(manifest.counts.byExampleType["distractor"]).toEqual({ train: 0, eval: 0 });
  });

  it("pins the corpus snapshot reference when given, and reports null when absent (never fabricated)", () => {
    const withCorpus = buildDatasetManifest(
      baseOptions({ corpusSnapshot: { contentHash: "abc123", schemaVersion: "0.1.0", exportDate: "2026-08-01T00:00:00.000Z" } }),
    );
    expect(withCorpus.corpusSnapshot).toEqual({
      contentHash: "abc123",
      schemaVersion: "0.1.0",
      exportDate: "2026-08-01T00:00:00.000Z",
    });

    const withoutCorpus = buildDatasetManifest(baseOptions({ corpusSnapshot: null }));
    expect(withoutCorpus.corpusSnapshot).toBeNull();
  });

  it("records the teacher model id from the qa run manifest when present, null otherwise", () => {
    const withTeacher = buildDatasetManifest(baseOptions({ teacherModel: "claude-sonnet-5" }));
    expect(withTeacher.teacherModel).toBe("claude-sonnet-5");

    const withoutTeacher = buildDatasetManifest(baseOptions({ teacherModel: null }));
    expect(withoutTeacher.teacherModel).toBeNull();
  });

  it("carries qaSource and notes through unchanged", () => {
    const manifest = buildDatasetManifest(
      baseOptions({ qaSource: "sampling-accepted", notes: ["one note", "another note"] }),
    );
    expect(manifest.qaSource).toBe("sampling-accepted");
    expect(manifest.notes).toEqual(["one note", "another note"]);
  });

  it("records seed and evalFraction as given", () => {
    const manifest = buildDatasetManifest(baseOptions({ seed: 42, evalFraction: 0.33 }));
    expect(manifest.seed).toBe(42);
    expect(manifest.evalFraction).toBe(0.33);
  });

  it("reports a real buildDate by default (no fixed clock injected)", () => {
    const manifest = buildDatasetManifest(baseOptions());
    expect(() => new Date(manifest.buildDate).toISOString()).not.toThrow();
  });
});
