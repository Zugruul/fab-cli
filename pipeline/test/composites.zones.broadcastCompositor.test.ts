import { describe, it, expect } from "vitest";
import { renderBroadcastFrame } from "../src/composites/zones/broadcastCompositor.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { CompositeCardLabel } from "../src/composites/types.js";
import type { BroadcastLayoutConfig } from "../src/composites/zones/broadcastLayout.js";

// #256 Phase C.4/C.5: assembles one full broadcast frame — procedural
// background, flat-color chrome placeholders per Phase B's measured
// config (documented simplified simulation, not photorealistic chrome —
// see this module's header), the merged near/far table warped into the
// play area via the SAME dstQuad feeding both pixels and label transform
// (broadcastGeometry.ts), and a REAL labeled card in the card-preview
// panel (region: "preview").

function solid(width: number, height: number, color: [number, number, number], alpha = 255): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = alpha;
  }
  return { width, height, data };
}

const LAYOUT: BroadcastLayoutConfig = {
  name: "test rig",
  playArea: { xFrac: 0.2, yFrac: 0.1, wFrac: 0.6, hFrac: 0.8 },
  chrome: [
    { kind: "scoreboard", rect: { xFrac: 0.0, yFrac: 0.0, wFrac: 1.0, hFrac: 0.1 } },
    { kind: "sidebar", side: "left", rect: { xFrac: 0.0, yFrac: 0.1, wFrac: 0.2, hFrac: 0.9 } },
    { kind: "sidebar", side: "right", rect: { xFrac: 0.8, yFrac: 0.1, wFrac: 0.2, hFrac: 0.9 } },
    { kind: "card-preview", side: "right", rect: { xFrac: 0.85, yFrac: 0.6, wFrac: 0.1, hFrac: 0.3 } },
  ],
};

function baseInput(overrides: Record<string, unknown> = {}) {
  const frameWidth = 200;
  const frameHeight = 150;
  return {
    frameWidth,
    frameHeight,
    frameBackground: solid(frameWidth, frameHeight, [5, 5, 5]),
    layout: LAYOUT,
    tableImage: solid(60, 60, [200, 0, 0]), // solid red "table"
    tableCardLabels: [] as CompositeCardLabel[],
    keystoneLeftFrac: 0,
    keystoneRightFrac: 0,
    previewCard: { printingId: "preview-card-a", image: solid(20, 28, [0, 200, 0]) }, // solid green "card"
    compositeId: "broadcast-0000",
    excludedCards: 0,
    cardBacksPlaced: 0,
    backgroundType: "procedural:solid" as const,
    backgroundHash: null,
    ...overrides,
  };
}

describe("renderBroadcastFrame — chrome placeholders", () => {
  it("paints a distinct color inside the scoreboard chrome region (not the raw background color)", () => {
    const { image } = renderBroadcastFrame(baseInput());
    const x = Math.round(0.5 * 200);
    const y = Math.round(0.05 * 150);
    const i = (y * 200 + x) * 4;
    expect([image.data[i], image.data[i + 1], image.data[i + 2]]).not.toEqual([5, 5, 5]);
  });

  it("paints a distinct color inside the sidebar chrome regions", () => {
    const { image } = renderBroadcastFrame(baseInput());
    const i = (Math.round(0.5 * 150) * 200 + Math.round(0.1 * 200)) * 4;
    expect([image.data[i], image.data[i + 1], image.data[i + 2]]).not.toEqual([5, 5, 5]);
  });
});

describe("renderBroadcastFrame — table warp", () => {
  it("the play area contains the warped table's color, not raw background or chrome color", () => {
    const { image } = renderBroadcastFrame(baseInput());
    // center of the play area rect
    const x = Math.round((0.2 + 0.6 / 2) * 200);
    const y = Math.round((0.1 + 0.8 / 2) * 150);
    const i = (y * 200 + x) * 4;
    expect(image.data[i]).toBeGreaterThan(150); // red channel from the solid-red table
    expect(image.data[i + 1]).toBeLessThan(50);
  });

  it("transforms table card labels' corners through the table homography (they must differ from the pre-transform table-local corners)", () => {
    const tableLabel: CompositeCardLabel = {
      printingId: "table-card-a",
      corners: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }],
      tags: [],
      visibleFraction: 1,
      region: "table",
    };
    const { label } = renderBroadcastFrame(baseInput({ tableCardLabels: [tableLabel] }));
    const out = label.cards.find((c) => c.printingId === "table-card-a")!;
    expect(out.region).toBe("table");
    expect(out.corners).not.toEqual(tableLabel.corners);
  });
});

describe("renderBroadcastFrame — card-preview panel", () => {
  it("paints the preview card's own color inside the card-preview chrome rect", () => {
    const { image } = renderBroadcastFrame(baseInput());
    const x = Math.round((0.85 + 0.1 / 2) * 200);
    const y = Math.round((0.6 + 0.3 / 2) * 150);
    const i = (y * 200 + x) * 4;
    expect(image.data[i + 1]).toBeGreaterThan(150); // green channel from the solid-green preview card
  });

  it("labels the preview card with region: 'preview' and its own printingId", () => {
    const { label } = renderBroadcastFrame(baseInput());
    const preview = label.cards.find((c) => c.printingId === "preview-card-a");
    expect(preview).toBeDefined();
    expect(preview!.region).toBe("preview");
  });

  it("the preview label's quad lands inside the card-preview chrome rect (not out on the table)", () => {
    const { label } = renderBroadcastFrame(baseInput());
    const preview = label.cards.find((c) => c.printingId === "preview-card-a")!;
    for (const p of preview.corners) {
      expect(p.x).toBeGreaterThanOrEqual(0.8 * 200 - 5);
      expect(p.x).toBeLessThanOrEqual(200 + 5);
    }
  });
});

describe("renderBroadcastFrame — manifest pass-through + determinism", () => {
  it("carries compositeId/excludedCards/cardBacksPlaced/backgroundType through unchanged", () => {
    const { label } = renderBroadcastFrame(baseInput({ excludedCards: 3, cardBacksPlaced: 2 }));
    expect(label.compositeId).toBe("broadcast-0000");
    expect(label.excludedCards).toBe(3);
    expect(label.cardBacksPlaced).toBe(2);
    expect(label.backgroundType).toBe("procedural:solid");
    expect(label.width).toBe(200);
    expect(label.height).toBe(150);
  });

  it("is deterministic — identical inputs produce byte-identical output", () => {
    const a = renderBroadcastFrame(baseInput());
    const b = renderBroadcastFrame(baseInput());
    expect(Array.from(a.image.data)).toEqual(Array.from(b.image.data));
    expect(a.label).toEqual(b.label);
  });
});
