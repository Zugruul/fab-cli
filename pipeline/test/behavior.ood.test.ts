import { describe, it, expect } from "vitest";
import { buildOODExamples } from "../src/behavior/ood.js";

const REFUSAL = "I'm scoped to Flesh & Blood questions only.";

describe("buildOODExamples (SPEC-APP.md §7.5c)", () => {
  it("emits one example per template, tagged with its style", () => {
    const bank = { sports: ["q1", "q2"], cooking: ["q3"] };
    const { examples } = buildOODExamples(bank, { minCount: 1, refusalTemplate: REFUSAL });
    expect(examples).toHaveLength(3);
    expect(examples.filter((e) => e.style === "sports")).toHaveLength(2);
    expect(examples.filter((e) => e.style === "cooking")).toHaveLength(1);
  });

  it("every example targets the scoped-purpose refusal template", () => {
    const bank = { sports: ["q1"], math: ["q2"] };
    const { examples } = buildOODExamples(bank, { minCount: 1, refusalTemplate: REFUSAL });
    for (const ex of examples) {
      expect(ex.target.answer).toBe(REFUSAL);
      expect(ex.target.citation_ids).toEqual([]);
    }
  });

  it("reports a diversity metric using the full template bank", () => {
    const bank = { sports: ["q1", "q2"], cooking: ["q3", "q4"], math: ["q5"] };
    const { diversity } = buildOODExamples(bank, { minCount: 1, refusalTemplate: REFUSAL });
    expect(diversity.totalTemplates).toBe(5);
    expect(diversity.distinctTemplatesUsed).toBe(5);
    expect(diversity.styleCount).toBe(3);
    expect(diversity.stylesCovered).toBe(3);
    expect(diversity.styleCoverageRatio).toBe(1);
  });

  it("throws loudly when the bank has fewer templates than the configured minimum", () => {
    const bank = { sports: ["q1", "q2"] };
    expect(() => buildOODExamples(bank, { minCount: 10, refusalTemplate: REFUSAL })).toThrow(
      /below configured minimum/,
    );
  });

  it("produces stable ids independent of key insertion order (sorted by style)", () => {
    const bankA = { zebra: ["z1"], apple: ["a1"] };
    const bankB = { apple: ["a1"], zebra: ["z1"] };
    const a = buildOODExamples(bankA, { minCount: 1, refusalTemplate: REFUSAL });
    const b = buildOODExamples(bankB, { minCount: 1, refusalTemplate: REFUSAL });
    expect(a.examples.map((e) => e.id)).toEqual(b.examples.map((e) => e.id));
  });
});
