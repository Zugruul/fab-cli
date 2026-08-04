import { describe, it, expect } from "vitest";
import { buildSampleSheetHtml } from "../src/composites/sampleSheet.js";
import type { CompositeLabel } from "../src/composites/types.js";

// APP-026 AC: "sample sheet renderable for human inspection" — an HTML page
// referencing the generated composites, with the label quads overlaid so a
// human can eyeball BOTH augmentation quality and label/pixel fidelity in
// one view (the two things this task's WHY section calls out as load-
// bearing for the downstream detector).

function label(id: string, cardCount = 1): CompositeLabel {
  return {
    compositeId: id,
    fileName: `${id}.png`,
    width: 200,
    height: 300,
    backgroundType: "procedural:gradient",
    backgroundHash: null,
    cards: Array.from({ length: cardCount }, (_, i) => ({
      printingId: `printing-${i}`,
      corners: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 220 },
        { x: 10, y: 220 },
      ] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
      tags: i === 0 ? ["sleeved"] : [],
    })),
  };
}

describe("buildSampleSheetHtml", () => {
  it("includes an <img> referencing each composite's fileName", () => {
    const html = buildSampleSheetHtml([{ fileName: "composite-0000.png", label: label("composite-0000") }]);
    expect(html).toContain('src="composite-0000.png"');
  });

  it("overlays an SVG polygon per pasted card, with points matching the label's corners", () => {
    const html = buildSampleSheetHtml([{ fileName: "composite-0000.png", label: label("composite-0000", 2) }]);
    // corners (10,20)-(110,20)-(110,220)-(10,220), fixed precision
    expect(html).toContain("10.0,20.0 110.0,20.0 110.0,220.0 10.0,220.0");
    expect((html.match(/<polygon/g) ?? []).length).toBe(2);
  });

  it("passes out-of-canvas (negative/beyond width or height) corner coordinates straight through unclamped (PR #238 review round 1: amodal labeling)", () => {
    const lbl = label("composite-0000");
    lbl.cards[0].corners = [
      { x: -15, y: -15 },
      { x: 115, y: -15 },
      { x: 115, y: 115 },
      { x: -15, y: 115 },
    ];
    const html = buildSampleSheetHtml([{ fileName: "composite-0000.png", label: lbl }]);
    expect(html).toContain("-15.0,-15.0 115.0,-15.0 115.0,115.0 -15.0,115.0");
  });

  it("sets the SVG viewBox to the composite's own width/height", () => {
    const html = buildSampleSheetHtml([{ fileName: "composite-0000.png", label: label("composite-0000") }]);
    expect(html).toContain('viewBox="0 0 200 300"');
  });

  it("renders one entry per composite, with the compositeId and card count visible", () => {
    const html = buildSampleSheetHtml([
      { fileName: "composite-0000.png", label: label("composite-0000", 1) },
      { fileName: "composite-0001.png", label: label("composite-0001", 3) },
    ]);
    expect(html).toContain("composite-0000");
    expect(html).toContain("composite-0001");
    expect((html.match(/<img/g) ?? []).length).toBe(2);
  });

  it("renders a valid, non-empty page for zero composites (never throws on an empty run)", () => {
    const html = buildSampleSheetHtml([]);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain("<img");
  });

  it("carries a custom title through into the page", () => {
    const html = buildSampleSheetHtml([{ fileName: "composite-0000.png", label: label("composite-0000") }], "My run");
    expect(html).toContain("My run");
  });
});
