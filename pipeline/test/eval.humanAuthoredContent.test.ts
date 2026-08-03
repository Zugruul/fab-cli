/**
 * Validates the REAL committed human-authored-adjudication content
 * (pipeline/eval-suites/human-adjudication/*.json) — not a test fixture —
 * against loadHumanAuthoredItems' runtime guards and the task's own bar:
 * >=100 items, every item cites a real independent sourceUrl (§8.4
 * anti-circularity control), and no near-duplicate padding.
 */
import path from "node:path";
import { describe, it, expect } from "vitest";
import { findNearDuplicateQuestions, loadHumanAuthoredItems } from "../src/eval/suites/humanAuthored.js";

const CONTENT_DIR = path.join(import.meta.dirname, "..", "eval-suites", "human-adjudication");

describe("committed human-authored-adjudication content", () => {
  it("loads without throwing (every item passes the runtime sourceUrl/shape guards)", () => {
    expect(() => loadHumanAuthoredItems(CONTENT_DIR)).not.toThrow();
  });

  it("has at least 100 items (task bar)", () => {
    const items = loadHumanAuthoredItems(CONTENT_DIR);
    expect(items.length).toBeGreaterThanOrEqual(100);
  });

  it("every item carries a real https:// sourceUrl", () => {
    const items = loadHumanAuthoredItems(CONTENT_DIR);
    for (const item of items) {
      expect(item.sourceUrl, item.id).toMatch(/^https:\/\/fabtcg\.com\//);
    }
  });

  it("every item is in the human-authored-adjudication suite, not adjudication-critical (§8.4: reprise grounding is excluded from that suite)", () => {
    const items = loadHumanAuthoredItems(CONTENT_DIR);
    for (const item of items) {
      expect(item.suite).toBe("human-authored-adjudication");
      expect(item.adjudicationCritical).toBe(false);
    }
  });

  it("draws from a real spread of independent source articles, not one or two", () => {
    const items = loadHumanAuthoredItems(CONTENT_DIR);
    const distinctSources = new Set(items.map((i) => i.sourceUrl));
    expect(distinctSources.size).toBeGreaterThanOrEqual(10);
  });

  it("has no near-duplicate questions above the default similarity threshold", () => {
    const items = loadHumanAuthoredItems(CONTENT_DIR);
    const duplicates = findNearDuplicateQuestions(items);
    expect(duplicates, JSON.stringify(duplicates, null, 2)).toEqual([]);
  });

  it("every item's expected rubric has at least one non-empty claim", () => {
    const items = loadHumanAuthoredItems(CONTENT_DIR);
    for (const item of items) {
      expect(item.expected.kind).toBe("rubric");
      if (item.expected.kind === "rubric") {
        expect(item.expected.claims.length).toBeGreaterThan(0);
        for (const claim of item.expected.claims) expect(claim.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
