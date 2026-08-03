import { describe, it, expect } from "vitest";
import {
  expectedAnswerForCategory,
  selectAbstentionQuality,
  selectAdjudicationCritical,
  selectCitationValidity,
  selectDistractorRobustness,
  selectInteractions,
  selectLore,
  selectOodRejection,
} from "../src/eval/suites/fromDataset.js";
import { abstentionExample, distractorExample, oodExample, qaExample } from "./eval.helpers.js";

describe("expectedAnswerForCategory", () => {
  it("uses exact-match for canonical categories (§8.3: keyword definitions, numeric card stats)", () => {
    expect(expectedAnswerForCategory("keyword-definitions", "Dominate")).toEqual({ kind: "exact", value: "Dominate" });
    expect(expectedAnswerForCategory("card-facts", "3")).toEqual({ kind: "exact", value: "3" });
  });

  it("uses rubric grading for every other category", () => {
    expect(expectedAnswerForCategory("multi-card-interactions", "explanation")).toEqual({ kind: "rubric", claims: ["explanation"] });
    expect(expectedAnswerForCategory("lore", "story")).toEqual({ kind: "rubric", claims: ["story"] });
    expect(expectedAnswerForCategory("tournament-procedure", "procedure")).toEqual({ kind: "rubric", claims: ["procedure"] });
  });
});

describe("selectAdjudicationCritical", () => {
  it("selects a qa example whose precomputed adjudicationCritical flag is true", () => {
    const ex = qaExample({ id: "a1", adjudicationCritical: true, category: "multi-card-interactions" });
    const item = selectAdjudicationCritical(ex);
    expect(item).not.toBeNull();
    expect(item!.suite).toBe("adjudication-critical");
    expect(item!.adjudicationCritical).toBe(true);
  });

  it("consumes the PRECOMPUTED flag rather than re-deriving it — a multi-card-interactions example with the flag false is excluded", () => {
    const ex = qaExample({ id: "a2", adjudicationCritical: false, category: "multi-card-interactions" });
    expect(selectAdjudicationCritical(ex)).toBeNull();
  });

  it("excludes non-qa example types (e.g. distractor) even when adjudicationCritical is true", () => {
    const ex = distractorExample({ id: "a3", adjudicationCritical: true });
    expect(selectAdjudicationCritical(ex)).toBeNull();
  });
});

describe("selectInteractions", () => {
  it("selects qa examples categorized multi-card-interactions", () => {
    const ex = qaExample({ id: "i1", category: "multi-card-interactions" });
    expect(selectInteractions(ex)!.suite).toBe("interactions");
  });

  it("excludes other categories", () => {
    expect(selectInteractions(qaExample({ id: "i2", category: "lore" }))).toBeNull();
  });
});

describe("selectLore", () => {
  it("selects qa examples categorized lore", () => {
    const item = selectLore(qaExample({ id: "l1", category: "lore", answer: "the demonastery is..." }));
    expect(item!.suite).toBe("lore");
    expect(item!.expected).toEqual({ kind: "rubric", claims: ["the demonastery is..."] });
  });

  it("excludes non-lore categories", () => {
    expect(selectLore(qaExample({ id: "l2", category: "card-facts" }))).toBeNull();
  });
});

describe("selectCitationValidity", () => {
  it("selects every qa example regardless of category, carrying its cited_chunk_ids as groundingChunkIds", () => {
    const ex = qaExample({ id: "c1", category: "card-facts", citedChunkIds: ["brain/card-x"] });
    const item = selectCitationValidity(ex);
    expect(item!.suite).toBe("citation-validity");
    expect(item!.groundingChunkIds).toEqual(["brain/card-x"]);
  });

  it("excludes non-qa example types", () => {
    expect(selectCitationValidity(oodExample({ id: "c2" }))).toBeNull();
  });
});

describe("selectAbstentionQuality", () => {
  it("selects abstention examples with expected: abstain and no grounding", () => {
    const item = selectAbstentionQuality(abstentionExample({ id: "ab1" }));
    expect(item).toEqual(
      expect.objectContaining({ suite: "abstention-quality", expected: { kind: "abstain" }, groundingChunkIds: [] }),
    );
  });

  it("excludes non-abstention example types", () => {
    expect(selectAbstentionQuality(qaExample({ id: "ab2" }))).toBeNull();
  });
});

describe("selectOodRejection", () => {
  it("selects ood examples with expected: abstain and no grounding", () => {
    const item = selectOodRejection(oodExample({ id: "o1" }));
    expect(item).toEqual(expect.objectContaining({ suite: "ood-rejection", expected: { kind: "abstain" }, groundingChunkIds: [] }));
  });

  it("excludes non-ood example types", () => {
    expect(selectOodRejection(abstentionExample({ id: "o2" }))).toBeNull();
  });
});

describe("selectDistractorRobustness", () => {
  it("selects distractor examples, grounding on the TRUE chunk_id (not the bundled distractors)", () => {
    const ex = distractorExample({ id: "d1", chunkId: "rules/cr/true", distractorChunkIds: ["rules/cr/fake-1", "rules/cr/fake-2"] });
    const item = selectDistractorRobustness(ex);
    expect(item!.suite).toBe("distractor-robustness");
    expect(item!.groundingChunkIds).toEqual(["rules/cr/true"]);
  });

  it("excludes non-distractor example types", () => {
    expect(selectDistractorRobustness(qaExample({ id: "d2" }))).toBeNull();
  });
});
