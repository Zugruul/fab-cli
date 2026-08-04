import { describe, it, expect } from "vitest";
import { createRng } from "../src/behavior/rng.js";
import { CoverageTracker } from "../src/composites/coverageTracker.js";
import { buildCoverageReport } from "../src/composites/coverageReport.js";
import type { CardImageRef } from "../src/composites/paramStream.js";

// #268 AC: "Emit a coverage report... distinguishing three states that
// must never collapse into one number: covered, unavailable upstream (with
// HTTP status), eligible but not placed." This is the module that turns a
// finished CoverageTracker + the run's card pool into that report.

function cards(n: number): CardImageRef[] {
  return Array.from({ length: n }, (_, i) => ({ printingId: `printing-${i}`, imagePath: `/images/printing-${i}.png` }));
}

describe("buildCoverageReport", () => {
  it("reports every eligible printing as covered when the pick budget was sufficient", () => {
    const pool = cards(5);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(1);
    for (let i = 0; i < 10; i++) tracker.pickForComposite(2, rng);

    const report = buildCoverageReport(pool, tracker, 2, []);
    expect(report.totalEligible).toBe(5);
    expect(report.covered).toBe(5);
    expect(report.eligibleButNotPlaced).toEqual([]);
    expect(report.minObservedAppearances).toBeGreaterThanOrEqual(2);
  });

  it("reports a printing as eligibleButNotPlaced when the run's budget was too small to reach minAppearances — never silently collapsed into 'covered'", () => {
    const pool = cards(6);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(2);
    // Deliberately tiny budget: nowhere near enough to get every printing
    // to minAppearances=5.
    tracker.pickForComposite(2, rng);

    const report = buildCoverageReport(pool, tracker, 5, []);
    expect(report.covered).toBeLessThan(6);
    expect(report.eligibleButNotPlaced.length).toBeGreaterThan(0);
    expect(report.covered + report.eligibleButNotPlaced.length).toBe(6);
  });

  it("keeps unavailableUpstream printings as a THIRD, separate bucket — never counted as covered or eligibleButNotPlaced", () => {
    // Only 4 of the "real" 6 printings were ever eligible (2 failed
    // upstream and were excluded from the pool passed to the tracker
    // entirely — this mirrors the CLI's real flow: unavailable printings
    // never enter `availableCards` in the first place).
    const pool = cards(4);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(3);
    for (let i = 0; i < 8; i++) tracker.pickForComposite(2, rng);

    const unavailable = [
      { printingId: "printing-missing-1", httpStatus: 403, reason: "fetch failed: HTTP 403 for https://example.com/a.webp" },
      { printingId: "printing-missing-2", httpStatus: 404, reason: "fetch failed: HTTP 404 for https://example.com/b.webp" },
    ];
    const report = buildCoverageReport(pool, tracker, 2, unavailable);

    expect(report.totalEligible).toBe(4); // NOT 6 — unavailable printings are excluded from "eligible"
    expect(report.unavailableUpstream).toEqual(unavailable);
    // No overlap between the "unavailable upstream" and "eligible pool" id sets.
    const unavailableIds = new Set(report.unavailableUpstream.map((u) => u.printingId));
    for (const id of report.eligibleButNotPlaced) expect(unavailableIds.has(id)).toBe(false);
    for (const c of pool) expect(unavailableIds.has(c.printingId)).toBe(false);
    // The three buckets partition disjointly: covered + eligibleButNotPlaced == totalEligible.
    expect(report.covered + report.eligibleButNotPlaced.length).toBe(report.totalEligible);
  });

  it("records min and max observed appearance counts across the eligible pool", () => {
    const pool = cards(3);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(4);
    tracker.pickForComposite(1, rng); // one item picked once, two items at 0
    const report = buildCoverageReport(pool, tracker, 1, []);
    expect(report.minObservedAppearances).toBe(0);
    expect(report.maxObservedAppearances).toBe(1);
  });

  it("an empty pool produces a well-formed, all-zero report rather than throwing", () => {
    const tracker = new CoverageTracker(0);
    const report = buildCoverageReport([], tracker, 1, []);
    expect(report.totalEligible).toBe(0);
    expect(report.covered).toBe(0);
    expect(report.eligibleButNotPlaced).toEqual([]);
    expect(report.minObservedAppearances).toBe(0);
    expect(report.maxObservedAppearances).toBe(0);
  });
});
