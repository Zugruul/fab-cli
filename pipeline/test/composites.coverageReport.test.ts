import { describe, it, expect } from "vitest";
import { createRng } from "../src/behavior/rng.js";
import { CoverageTracker } from "../src/composites/coverageTracker.js";
import { buildCoverageReport, tallyAppearancesFromLabels } from "../src/composites/coverageReport.js";
import type { CardImageRef } from "../src/composites/paramStream.js";
import type { CompositeLabel, CompositeCardLabel } from "../src/composites/types.js";

// #268 AC: "Emit a coverage report... distinguishing three states that
// must never collapse into one number: covered, unavailable upstream (with
// HTTP status), eligible but not placed." This is the module that turns a
// run's per-printing appearance counts + the run's card pool into that
// report.
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
//
// #279: buildCoverageReport's 3rd argument used to be the CoverageTracker
// itself (it only ever called `tracker.allAppearanceCounts()` — PICK
// counts, i.e. how many times a printing was chosen for a composite's
// PLAN). That's a different number than how many times a printing actually
// made it into a composite's LABEL: compositor.ts's minVisibleFraction
// filter drops a card from the label post-hoc (after it's already been
// painted and already counted as a "pick"), so a printing that was picked
// >= minAppearances times but excluded from every single label was still
// reported as "covered" — confirmed on the real committed
// pipeline/out/composites-full dataset (2,229 of 16,213 "covered"
// printings actually have < 3 REAL label appearances; a couple have zero).
// The signature now takes a plain `appearanceCounts: number[]` — indexed
// like `availableCards`, exactly like `CoverageTracker.allAppearanceCounts()`
// already was — so the caller decides what "appeared" means. cli.ts now
// passes REAL counts from `tallyAppearancesFromLabels`, computed from the
// labels the run actually wrote, not from the tracker's picks.

function cards(n: number): CardImageRef[] {
  return Array.from({ length: n }, (_, i) => ({ printingId: `printing-${i}`, imagePath: `/images/printing-${i}.png` }));
}

function cardLabel(printingId: string, visibleFraction = 1): CompositeCardLabel {
  return {
    printingId,
    corners: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    tags: [],
    visibleFraction,
    region: "table",
  };
}

function label(compositeId: string, includedPrintingIds: string[], excludedCards = 0): CompositeLabel {
  return {
    compositeId,
    fileName: `${compositeId}.png`,
    width: 64,
    height: 64,
    backgroundType: "procedural:solid",
    backgroundHash: null,
    cards: includedPrintingIds.map((id) => cardLabel(id)),
    excludedCards,
    cardBacksPlaced: 0,
  };
}

describe("buildCoverageReport", () => {
  it("reports every eligible printing as covered when the pick budget was sufficient", () => {
    const pool = cards(5);
    const catalog = pool.map((c) => c.printingId);
    const tracker = new CoverageTracker(pool.length);
    const rng = createRng(1);
    for (let i = 0; i < 10; i++) tracker.pickForComposite(2, rng);

    const report = buildCoverageReport(catalog, pool, tracker.allAppearanceCounts(), 2, []);
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

    const report = buildCoverageReport(catalog, pool, tracker.allAppearanceCounts(), 5, []);
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

    const report = buildCoverageReport(catalog, pool, tracker.allAppearanceCounts(), 2, unavailable);

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
    const report = buildCoverageReport(catalog, pool, tracker.allAppearanceCounts(), 1, []);
    expect(report.minObservedAppearances).toBe(0);
    expect(report.maxObservedAppearances).toBe(1);
  });

  it("an empty catalog produces a well-formed, all-zero report rather than throwing", () => {
    const report = buildCoverageReport([], [], [], 1, []);
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

    const report = buildCoverageReport(catalog, availableCards, tracker.allAppearanceCounts(), 1, []);

    // The never-attempted printing must appear SOMEWHERE.
    const allMentioned = new Set([...report.eligibleButNotPlaced, ...report.unavailableUpstream.map((u) => u.printingId)]);
    expect(allMentioned.has("printing-2")).toBe(true);
    // Specifically: not cached and not a known failure => eligibleButNotPlaced.
    expect(report.eligibleButNotPlaced).toContain("printing-2");
    expect(report.unavailableUpstream).toEqual([]);
  });

  it("a download-failures entry naming a printingId that ISN'T a catalog member is dropped from unavailableUpstream (not just ignored for accounting) — keeps the partition invariant exact even against a stale/mismatched manifest", () => {
    const catalog = ["printing-0", "printing-1"];
    const available: CardImageRef[] = [{ printingId: "printing-0", imagePath: "/images/printing-0.png" }];
    const tracker = new CoverageTracker(available.length);
    tracker.pickForComposite(1, createRng(6));

    const staleUnavailable = [{ printingId: "printing-not-in-catalog", httpStatus: 403, reason: "stale, from a different catalog version" }];
    const report = buildCoverageReport(catalog, available, tracker.allAppearanceCounts(), 1, staleUnavailable);

    expect(report.unavailableUpstream).toEqual([]); // dropped — not a real catalog member
    expect(report.eligibleButNotPlaced).toContain("printing-1"); // still accounted for as never-attempted
    expect(report.covered + report.eligibleButNotPlaced.length + report.unavailableUpstream.length).toBe(report.totalCatalogSize);
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
      const report = buildCoverageReport(s.catalog, s.available, tracker.allAppearanceCounts(), s.minAppearances, s.unavailable);
      expect(report.covered + report.eligibleButNotPlaced.length + report.unavailableUpstream.length).toBe(report.totalCatalogSize);
      expect(report.totalCatalogSize).toBe(s.catalog.length);
    }
  });

  // --- #279: appearanceCounts must reflect REAL label inclusion, not picks --

  it("#279: a printing PICKED >= minAppearances times but EXCLUDED from every label (0 real appearances) is reported as eligibleButNotPlaced, not covered — this is the exact bug measured on the committed composites-full dataset", () => {
    const pool = cards(2);
    const catalog = pool.map((c) => c.printingId);

    // Old (buggy) semantics: the tracker picked BOTH printings 3 times each
    // (a real coverage run always keeps pick counts balanced/high) —
    // feeding raw picks straight into buildCoverageReport would report
    // both as "covered" at minAppearances=3.
    const pickCounts = [3, 3];
    const oldReport = buildCoverageReport(catalog, pool, pickCounts, 3, []);
    expect(oldReport.covered).toBe(2); // the bug: both look covered from picks alone

    // Real semantics: printing-0 was picked 3 times but excluded from the
    // label EVERY time (e.g. always fully occluded by a later, larger
    // card) — its REAL appearance count is 0, not 3. printing-1's picks
    // all survived.
    const labels: CompositeLabel[] = [
      label("composite-0000", ["printing-1"], 1), // printing-0 pasted, excluded
      label("composite-0001", ["printing-1"], 1),
      label("composite-0002", ["printing-1"], 1),
    ];
    const realCounts = tallyAppearancesFromLabels(pool, labels);
    expect(realCounts).toEqual([0, 3]);

    const realReport = buildCoverageReport(catalog, pool, realCounts, 3, []);
    expect(realReport.covered).toBe(1); // only printing-1
    expect(realReport.eligibleButNotPlaced).toEqual(["printing-0"]);
    expect(realReport.minObservedAppearances).toBe(0);
  });
});

describe("tallyAppearancesFromLabels (#279)", () => {
  it("counts each printing's REAL label appearances (cards[] entries), indexed like availableCards — matching CoverageTracker.allAppearanceCounts()'s index contract", () => {
    const pool = cards(3);
    const labels: CompositeLabel[] = [label("composite-0000", ["printing-0", "printing-1"]), label("composite-0001", ["printing-1"]), label("composite-0002", ["printing-0", "printing-1", "printing-2"])];
    expect(tallyAppearancesFromLabels(pool, labels)).toEqual([2, 3, 1]);
  });

  it("a printing that is pasted but never appears in any label's cards[] (always excluded or never picked) counts as 0, not omitted", () => {
    const pool = cards(2);
    const labels: CompositeLabel[] = [label("composite-0000", ["printing-1"], 1)];
    expect(tallyAppearancesFromLabels(pool, labels)).toEqual([0, 1]);
  });

  it("an empty run (no labels) tallies every printing to 0", () => {
    const pool = cards(4);
    expect(tallyAppearancesFromLabels(pool, [])).toEqual([0, 0, 0, 0]);
  });

  it("ignores excludedCards' count and cardBacksPlaced entirely — only actual cards[] entries are tallied", () => {
    const pool = cards(1);
    const labels: CompositeLabel[] = [{ ...label("composite-0000", []), excludedCards: 5, cardBacksPlaced: 2 }];
    expect(tallyAppearancesFromLabels(pool, labels)).toEqual([0]);
  });
});
