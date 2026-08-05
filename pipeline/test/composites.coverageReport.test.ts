import { describe, it, expect } from "vitest";
import { createRng } from "../src/behavior/rng.js";
import { CoverageTracker } from "../src/composites/coverageTracker.js";
import { buildCoverageReport } from "../src/composites/coverageReport.js";
import type { CardImageRef } from "../src/composites/paramStream.js";

// #268 AC: "Emit a coverage report... distinguishing three states that
// must never collapse into one number: covered, unavailable upstream (with
// HTTP status), eligible but not placed." This is the module that turns a
// finished CoverageTracker + the run's card pool into that report.
//
// PR #269 review round 1, BLOCKER 1: the report must be built against the
// FULL CATALOG (every printing the-fab-cube knows about), not just
// `availableCards` (whatever happens to be cached right now). A printing
// that was never downloaded AND never recorded in a download-failures
// manifest (the common case for a partial/--limit'd download run) used to
// be invisible to every bucket — neither covered, nor eligibleButNotPlaced,
// nor unavailableUpstream — while the report still claimed 100% coverage.
// `fullCatalogPrintingIds` is now buildCoverageReport's first argument
// specifically to make that impossible: every id in it lands in EXACTLY
// one of the three buckets, checked by the `totalCatalogSize` invariant
// tests below.

function cards(n: number): CardImageRef[] {
  return Array.from({ length: n }, (_, i) => ({ printingId: `printing-${i}`, imagePath: `/images/printing-${i}.png` }));
}

describe("buildCoverageReport", () => {
  it("reports every eligible printing as covered when the pick budget was sufficient", () => {
    const pool = cards(5);
    const catalog = pool.map((c) => c.printingId);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(1);
    for (let i = 0; i < 10; i++) tracker.pickForComposite(2, rng);

    const report = buildCoverageReport(catalog, pool, tracker, 2, []);
    expect(report.totalCatalogSize).toBe(5);
    expect(report.totalEligible).toBe(5);
    expect(report.covered).toBe(5);
    expect(report.eligibleButNotPlaced).toEqual([]);
    expect(report.minObservedAppearances).toBeGreaterThanOrEqual(2);
  });

  it("reports a printing as eligibleButNotPlaced when the run's budget was too small to reach minAppearances — never silently collapsed into 'covered'", () => {
    const pool = cards(6);
    const catalog = pool.map((c) => c.printingId);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(2);
    // Deliberately tiny budget: nowhere near enough to get every printing
    // to minAppearances=5.
    tracker.pickForComposite(2, rng);

    const report = buildCoverageReport(catalog, pool, tracker, 5, []);
    expect(report.covered).toBeLessThan(6);
    expect(report.eligibleButNotPlaced.length).toBeGreaterThan(0);
    expect(report.covered + report.eligibleButNotPlaced.length).toBe(6);
  });

  it("keeps unavailableUpstream printings as a THIRD, separate bucket — never counted as covered or eligibleButNotPlaced", () => {
    // 6 real catalog printings: 4 cached/eligible, 2 permanently failed
    // upstream (never entered `availableCards` — the CLI's real flow).
    const pool = cards(4);
    const unavailable = [
      { printingId: "printing-missing-1", httpStatus: 403, reason: "fetch failed: HTTP 403 for https://example.com/a.webp" },
      { printingId: "printing-missing-2", httpStatus: 404, reason: "fetch failed: HTTP 404 for https://example.com/b.webp" },
    ];
    const catalog = [...pool.map((c) => c.printingId), ...unavailable.map((u) => u.printingId)];
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(3);
    for (let i = 0; i < 8; i++) tracker.pickForComposite(2, rng);

    const report = buildCoverageReport(catalog, pool, tracker, 2, unavailable);

    expect(report.totalCatalogSize).toBe(6);
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
    const catalog = pool.map((c) => c.printingId);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(4);
    tracker.pickForComposite(1, rng); // one item picked once, two items at 0
    const report = buildCoverageReport(catalog, pool, tracker, 1, []);
    expect(report.minObservedAppearances).toBe(0);
    expect(report.maxObservedAppearances).toBe(1);
  });

  it("an empty catalog produces a well-formed, all-zero report rather than throwing", () => {
    const tracker = new CoverageTracker(0);
    const report = buildCoverageReport([], [], tracker, 1, []);
    expect(report.totalCatalogSize).toBe(0);
    expect(report.totalEligible).toBe(0);
    expect(report.covered).toBe(0);
    expect(report.eligibleButNotPlaced).toEqual([]);
    expect(report.minObservedAppearances).toBe(0);
    expect(report.maxObservedAppearances).toBe(0);
  });

  // --- PR #269 review round 1, BLOCKER 1 -----------------------------------

  it("BLOCKER 1: a catalog printing that is neither cached (in availableCards) NOR recorded as a download failure is never invisible — it lands in eligibleButNotPlaced, not silently dropped", () => {
    // 3 catalog printings total; only 2 were ever downloaded/cached
    // (availableCards). The 3rd ("printing-2") was simply never attempted
    // — e.g. a partial/--limit'd download run — and has NO entry in the
    // unavailableUpstream list either (that's the exact scenario that used
    // to make it vanish from every bucket).
    const catalog = ["printing-0", "printing-1", "printing-2"];
    const availableCards: CardImageRef[] = [
      { printingId: "printing-0", imagePath: "/images/printing-0.png" },
      { printingId: "printing-1", imagePath: "/images/printing-1.png" },
    ];
    const tracker = new CoverageTracker(availableCards.length);
    const rng = createRng(5);
    for (let i = 0; i < 10; i++) tracker.pickForComposite(2, rng); // both cached printings fully covered

    const report = buildCoverageReport(catalog, availableCards, tracker, 1, []);

    // The never-attempted printing must appear SOMEWHERE.
    const allMentioned = new Set([...report.eligibleButNotPlaced, ...report.unavailableUpstream.map((u) => u.printingId)]);
    expect(allMentioned.has("printing-2")).toBe(true);
    // Specifically: not cached and not a known failure => eligibleButNotPlaced.
    expect(report.eligibleButNotPlaced).toContain("printing-2");
    expect(report.unavailableUpstream).toEqual([]);
  });

  it("INVARIANT: covered + eligibleButNotPlaced.length + unavailableUpstream.length === totalCatalogSize, always — checked across several scenarios", () => {
    const scenarios: { catalog: string[]; available: CardImageRef[]; unavailable: { printingId: string; httpStatus: number | null; reason: string }[]; minAppearances: number }[] = [
      // fully cached + covered
      { catalog: cards(5).map((c) => c.printingId), available: cards(5), unavailable: [], minAppearances: 1 },
      // some cached, some never attempted, some known-failed
      {
        catalog: ["a", "b", "c", "d", "e"],
        available: [
          { printingId: "a", imagePath: "/a.png" },
          { printingId: "b", imagePath: "/b.png" },
        ],
        unavailable: [{ printingId: "c", httpStatus: 403, reason: "HTTP 403" }],
        // "d" and "e": never cached, never in the failures list — the vanishing case.
        minAppearances: 3,
      },
      // everything unavailable
      {
        catalog: ["x", "y"],
        available: [],
        unavailable: [
          { printingId: "x", httpStatus: 404, reason: "HTTP 404" },
          { printingId: "y", httpStatus: 403, reason: "HTTP 403" },
        ],
        minAppearances: 1,
      },
    ];

    for (const s of scenarios) {
      const tracker = new CoverageTracker(s.available.length);
      const rng = createRng(11);
      for (let i = 0; i < 20; i++) tracker.pickForComposite(Math.min(2, Math.max(1, s.available.length)), rng);
      const report = buildCoverageReport(s.catalog, s.available, tracker, s.minAppearances, s.unavailable);
      expect(report.covered + report.eligibleButNotPlaced.length + report.unavailableUpstream.length).toBe(report.totalCatalogSize);
      expect(report.totalCatalogSize).toBe(s.catalog.length);
    }
  });
});
