import { describe, it, expect } from "vitest";
import { buildDatasetSuiteItems, SUITE_REGISTRY } from "../src/eval/suites/registry.js";
import { EVAL_SUITE_IDS } from "../src/eval/types.js";
import { abstentionExample, distractorExample, oodExample, qaExample } from "./eval.helpers.js";

describe("SUITE_REGISTRY", () => {
  it("registers exactly the eight canonical suite ids, matching @fab/manifest-schema's EVAL_SUITE_IDS", () => {
    expect(SUITE_REGISTRY.map((s) => s.id).sort()).toEqual([...EVAL_SUITE_IDS].sort());
  });

  it("gives every suite except human-authored-adjudication a dataset selector", () => {
    for (const def of SUITE_REGISTRY) {
      if (def.id === "human-authored-adjudication") {
        expect(def.selectFromDataset).toBeUndefined();
      } else {
        expect(def.selectFromDataset).toBeTypeOf("function");
      }
    }
  });
});

describe("buildDatasetSuiteItems", () => {
  it("buckets a mixed batch of examples into the right suites in one pass", () => {
    const examples = [
      qaExample({ id: "q1", category: "multi-card-interactions", adjudicationCritical: true }),
      qaExample({ id: "q2", category: "lore" }),
      qaExample({ id: "q3", category: "card-facts" }),
      distractorExample({ id: "d1" }),
      abstentionExample({ id: "a1" }),
      oodExample({ id: "o1" }),
    ];
    const bySuite = buildDatasetSuiteItems(examples);

    expect(bySuite["adjudication-critical"]).toHaveLength(1);
    expect(bySuite["interactions"]).toHaveLength(1); // q1 only (q2 is lore, q3 is card-facts)
    expect(bySuite["lore"]).toHaveLength(1);
    // citation-validity picks up every qa example (q1, q2, q3) — 3, not distractor/abstention/ood.
    expect(bySuite["citation-validity"]).toHaveLength(3);
    expect(bySuite["abstention-quality"]).toHaveLength(1);
    expect(bySuite["ood-rejection"]).toHaveLength(1);
    expect(bySuite["distractor-robustness"]).toHaveLength(1);
    expect(bySuite["human-authored-adjudication"]).toBeUndefined(); // not built from the dataset
  });

  it("returns empty arrays (not missing keys) for a suite with no matching examples", () => {
    const bySuite = buildDatasetSuiteItems([qaExample({ id: "q1", category: "lore" })]);
    expect(bySuite["abstention-quality"]).toEqual([]);
    expect(bySuite["ood-rejection"]).toEqual([]);
  });
});
