import { describe, it, expect } from "vitest";
import { categorizeChunk } from "../src/dataset/categorize.js";
import { makeChunk } from "./dataset.helpers.js";

describe("categorizeChunk (SPEC-APP.md §7.8 category derivation)", () => {
  it("maps lore/** chunk_ids to lore", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "lore/world-of-rathe/demonastery", tags: ["lore"] }))).toBe("lore");
  });

  it("maps a lore tag to lore even off the lore/ prefix (defensive)", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/judge/some-story-note", tags: ["lore"] }))).toBe("lore");
  });

  it("maps rules/trp/**, rules/ppg/**, rules/cpg/** to tournament-procedure", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "rules/trp/1.1", tags: ["trp", "rules"] }))).toBe(
      "tournament-procedure",
    );
    expect(categorizeChunk(makeChunk({ chunk_id: "rules/ppg/2.3", tags: ["ppg", "rules"] }))).toBe(
      "tournament-procedure",
    );
    expect(categorizeChunk(makeChunk({ chunk_id: "rules/cpg/deck-checks", tags: ["cpg", "rules"] }))).toBe(
      "tournament-procedure",
    );
  });

  it("maps rules/cr/** to multi-card-interactions", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "rules/cr/8.3.1", tags: ["cr", "rules"] }))).toBe(
      "multi-card-interactions",
    );
  });

  it("maps rules/reprise/** (per-set interaction guidance) to multi-card-interactions", () => {
    expect(
      categorizeChunk(makeChunk({ chunk_id: "rules/reprise/omens-of-the-third-age", tags: ["reprise", "rules"] })),
    ).toBe("multi-card-interactions");
  });

  it("maps rules/legality/** to tournament-procedure (still categorized for distractor stratification, even though qa/dpo assembly excludes it per §7.9)", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "rules/legality/current", tags: ["legality", "rules"] }))).toBe(
      "tournament-procedure",
    );
  });

  it("maps brain kw-* slugs to keyword-definitions", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/card-vault/kw-dominate", tags: [] }))).toBe(
      "keyword-definitions",
    );
  });

  it("maps a keyword tag to keyword-definitions even off the kw- slug convention", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/card-vault/dominate-glossary", tags: ["keyword"] }))).toBe(
      "keyword-definitions",
    );
  });

  it("maps brain card-* slugs to card-facts", () => {
    expect(
      categorizeChunk(makeChunk({ chunk_id: "brain/card-vault/card-heartstoker-branchblade", tags: [] })),
    ).toBe("card-facts");
  });

  it("maps a card tag to card-facts even off the card- slug convention", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/card-vault/branchblade-stats", tags: ["card"] }))).toBe(
      "card-facts",
    );
  });

  it("maps brain ci-*/ruling-*/interaction-* slugs to multi-card-interactions", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/judge/ci-steal-is-gain-control", tags: [] }))).toBe(
      "multi-card-interactions",
    );
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/judge/ruling-dominate-timing", tags: [] }))).toBe(
      "multi-card-interactions",
    );
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/judge/interaction-block-vs-dominate", tags: [] }))).toBe(
      "multi-card-interactions",
    );
  });

  it("maps an interaction tag to multi-card-interactions", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/judge/mixed-topic-note", tags: ["interaction"] }))).toBe(
      "multi-card-interactions",
    );
  });

  it("defaults an unmatched brain note (no kw-/card-/ci- slug, no distinguishing tag) to multi-card-interactions", () => {
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/judge/combat-chain-steps", tags: [] }))).toBe(
      "multi-card-interactions",
    );
    expect(categorizeChunk(makeChunk({ chunk_id: "brain/player/strategy-blocking-basics", tags: [] }))).toBe(
      "multi-card-interactions",
    );
  });

  it("defaults an unrecognized chunk_id scheme to multi-card-interactions rather than throwing", () => {
    expect(() => categorizeChunk(makeChunk({ chunk_id: "something-unexpected", tags: [] }))).not.toThrow();
    expect(categorizeChunk(makeChunk({ chunk_id: "something-unexpected", tags: [] }))).toBe(
      "multi-card-interactions",
    );
  });

  it("is a pure function of chunk_id/tags — same input always yields the same category", () => {
    const chunk = makeChunk({ chunk_id: "brain/card-vault/kw-dominate", tags: ["keyword"] });
    expect(categorizeChunk(chunk)).toBe(categorizeChunk(chunk));
  });
});
