import { describe, it, expect } from "vitest";
import { buildBroadcastSampleSheetHtml } from "../src/composites/zones/broadcastSampleSheet.js";
import type { CompositeLabel } from "../src/composites/types.js";
import type { SampleSheetEntry } from "../src/composites/sampleSheet.js";
import type { BroadcastReferenceEntry } from "../src/composites/zones/broadcastSampleSheet.js";

// #256 Phase D: a dedicated sheet interleaving synthetic broadcast renders
// (WITH label overlays) with real imported captures (UNLABELED reference
// material only — issue #256's honest constraint). Every real-capture
// tile must be explicitly, visually marked so a human can never mistake
// one for the other.

function label(id: string, cardCount = 1): CompositeLabel {
  return {
    compositeId: id,
    fileName: `${id}.png`,
    width: 400,
    height: 300,
    backgroundType: "procedural:solid",
    backgroundHash: null,
    cards: Array.from({ length: cardCount }, (_, i) => ({
      printingId: `printing-${i}`,
      corners: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 220 }, { x: 10, y: 220 }] as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ],
      tags: [],
      visibleFraction: 1,
      region: i === 0 ? ("preview" as const) : ("table" as const),
    })),
    excludedCards: 0,
    cardBacksPlaced: 0,
  };
}

function syntheticEntry(id: string): SampleSheetEntry {
  return { fileName: `${id}.png`, label: label(id, 2) };
}

function referenceEntry(fileName: string, framing: BroadcastReferenceEntry["framing"] = "full-broadcast"): BroadcastReferenceEntry {
  return { fileName, framing };
}

describe("buildBroadcastSampleSheetHtml — synthetic tiles", () => {
  it("includes an <img> + quad overlay for each synthetic composite, same fidelity as the base sample sheet", () => {
    const html = buildBroadcastSampleSheetHtml([syntheticEntry("broadcast-0000")], []);
    expect(html).toContain('src="broadcast-0000.png"');
    expect((html.match(/<polygon/g) ?? []).length).toBe(2);
  });

  it("shows the region ('table'/'preview') per card so a human can tell a preview-panel label from a table label", () => {
    const html = buildBroadcastSampleSheetHtml([syntheticEntry("broadcast-0000")], []);
    expect(html).toContain("preview");
    expect(html).toContain("table");
  });
});

describe("buildBroadcastSampleSheetHtml — reference tiles (real captures)", () => {
  it("includes an <img> for each reference capture", () => {
    const html = buildBroadcastSampleSheetHtml([], [referenceEntry("aabbccdd11223344.png")]);
    expect(html).toContain('src="aabbccdd11223344.png"');
  });

  it("EVERY reference tile is explicitly marked REFERENCE — unlabeled real capture, not training data", () => {
    const html = buildBroadcastSampleSheetHtml([], [referenceEntry("a.png"), referenceEntry("b.png", "play-area-crop")]);
    const markerCount = (html.match(/REFERENCE — unlabeled real capture, not training data/g) ?? []).length;
    expect(markerCount).toBe(2);
  });

  it("draws NO quad overlay on a reference tile (it has no labels — never fabricate one)", () => {
    const html = buildBroadcastSampleSheetHtml([], [referenceEntry("a.png")]);
    expect(html).not.toContain("<polygon");
  });

  it("shows the reference tile's framing classification", () => {
    const html = buildBroadcastSampleSheetHtml([], [referenceEntry("a.png", "play-area-crop")]);
    expect(html).toContain("play-area-crop");
  });
});

describe("buildBroadcastSampleSheetHtml — interleaving + never-confused invariant", () => {
  it("interleaves synthetic and reference tiles in one sheet (both kinds present, distinguishably marked)", () => {
    const html = buildBroadcastSampleSheetHtml([syntheticEntry("broadcast-0000"), syntheticEntry("broadcast-0001")], [referenceEntry("ref-a.png"), referenceEntry("ref-b.png")]);
    expect(html).toContain('src="broadcast-0000.png"');
    expect(html).toContain('src="broadcast-0001.png"');
    expect(html).toContain('src="ref-a.png"');
    expect(html).toContain('src="ref-b.png"');
    expect((html.match(/REFERENCE — unlabeled real capture, not training data/g) ?? []).length).toBe(2);
    // exactly the synthetic tiles' polygons — references never get one
    expect((html.match(/<polygon/g) ?? []).length).toBe(4); // 2 cards each, 2 synthetic tiles
  });

  it("renders a valid, non-empty page for zero tiles of either kind", () => {
    const html = buildBroadcastSampleSheetHtml([], []);
    expect(html.length).toBeGreaterThan(0);
  });

  it("carries a custom title through into the page", () => {
    const html = buildBroadcastSampleSheetHtml([], [], "My broadcast run");
    expect(html).toContain("My broadcast run");
  });
});
