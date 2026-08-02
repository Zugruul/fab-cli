import { describe, it, expect } from "vitest";
import { isAdjudicationCritical } from "../src/dataset/adjudication.js";

describe("isAdjudicationCritical (SPEC-APP.md §8.4 — curated adjudication-critical eval suite)", () => {
  it("maps a Comprehensive Rules section (rules/cr/**) to true", () => {
    expect(isAdjudicationCritical("rules/cr/8.3.1", ["cr", "rules"])).toBe(true);
  });

  it("maps a judge brain interaction-ruling note (ci-*) to true", () => {
    expect(isAdjudicationCritical("brain/judge/ci-steal-is-gain-control", [])).toBe(true);
  });

  it("maps a Rules Reprise article to false (LSS commentary, not the rules text itself)", () => {
    expect(isAdjudicationCritical("rules/reprise/omens-of-the-third-age", ["reprise", "rules"])).toBe(false);
  });

  it("maps a lore chunk to false", () => {
    expect(isAdjudicationCritical("lore/world-of-rathe/demonastery", ["lore"])).toBe(false);
  });

  it("maps a card-vault kw-* keyword note to false (covered by the §8.3 exact-match suite instead)", () => {
    expect(isAdjudicationCritical("brain/card-vault/kw-dominate", ["keyword"])).toBe(false);
  });

  it("also maps ruling-*/interaction-* slugs, and an interaction tag off-convention, to true — identity-agnostic", () => {
    expect(isAdjudicationCritical("brain/judge/ruling-dominate-timing", [])).toBe(true);
    expect(isAdjudicationCritical("brain/judge/interaction-block-vs-dominate", [])).toBe(true);
    // Identity-agnostic: a card-vault note tagged "interaction" qualifies the
    // same way a judge ci-* note does, even without the ci- slug prefix.
    expect(isAdjudicationCritical("brain/card-vault/mixed-topic-note", ["interaction"])).toBe(true);
  });

  it("maps other rules documents (trp/ppg/cpg/legality) to false — not the CR itself", () => {
    expect(isAdjudicationCritical("rules/trp/1.1", ["trp", "rules"])).toBe(false);
    expect(isAdjudicationCritical("rules/ppg/2.3", ["ppg", "rules"])).toBe(false);
    expect(isAdjudicationCritical("rules/cpg/deck-checks", ["cpg", "rules"])).toBe(false);
    expect(isAdjudicationCritical("rules/legality/current", ["legality", "rules"])).toBe(false);
  });

  it("defaults an undifferentiated brain note (no matching slug/tag) to false, unlike categorizeChunk's multi-card-interactions default", () => {
    expect(isAdjudicationCritical("brain/judge/combat-chain-steps", [])).toBe(false);
    expect(isAdjudicationCritical("brain/player/strategy-blocking-basics", [])).toBe(false);
  });

  it("defaults a card-facts (card-*) brain note to false", () => {
    expect(isAdjudicationCritical("brain/card-vault/card-heartstoker-branchblade", [])).toBe(false);
  });

  it("defaults an unrecognized chunk_id scheme to false rather than throwing", () => {
    expect(() => isAdjudicationCritical("something-unexpected", [])).not.toThrow();
    expect(isAdjudicationCritical("something-unexpected", [])).toBe(false);
  });

  it("is a pure function of (chunkId, tags) — same input always yields the same result", () => {
    expect(isAdjudicationCritical("rules/cr/8.3.1", ["cr"])).toBe(isAdjudicationCritical("rules/cr/8.3.1", ["cr"]));
  });
});
