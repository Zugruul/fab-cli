/**
 * Assembles ONE full `--mode broadcast` frame (#256 Phase C.4/C.5):
 * procedural background, flat-color chrome placeholders (per Phase B's
 * measured pipeline/config/broadcast-layouts/*.json), the merged near/far
 * table warped into the play area, and a real labeled card in the
 * card-preview panel.
 *
 * Chrome is rendered as flat placeholder color rects, NOT photorealistic
 * broadcast graphics (#256 scope decision, documented here rather than
 * silently narrowed): this generator's job is chrome REGION realism —
 * teaching the detector "don't fire inside these excluded regions" and
 * giving a human eyeballing the sample sheet a recognizable frame layout
 * — not rendering a convincing scoreboard/webcam image, which would be
 * disproportionate effort for a synthetic-training-data generator and is
 * explicitly out of scope for this issue. Same "simplified simulation,
 * not photorealistic" philosophy rawImage.ts's applySleeve/applyGlare
 * already document.
 *
 * The table warp is THE single-source-of-truth pattern
 * broadcastGeometry.ts documents: one computeTableDestQuad call produces
 * `dstQuad`, fed to BOTH warpToQuad (pixels) and
 * transformTableLabelsThroughHomography (every table card's label) — see
 * that module's header for the full guarantee.
 *
 * The card-preview panel is a REAL, independently placed card (ordinary
 * computeDestQuad + warpToQuad, ANALOGOUS to a single per-card placement,
 * not part of the table at all) — physically disjoint from the play area
 * by construction (validateBroadcastLayoutConfig's play-area/chrome
 * overlap check), so it never participates in the table's occlusion
 * bookkeeping and is always fully visible (visibleFraction 1, always
 * included) — see types.ts's CompositeCardLabel.region doc for why a
 * detector should fire on it too.
 */
import { computeDestQuad } from "../geometry.js";
import { warpToQuad } from "../warp.js";
import { compositeOver } from "../rawImage.js";
import type { RawImage } from "../rawImage.js";
import { computeTableDestQuad, transformTableLabelsThroughHomography } from "./broadcastGeometry.js";
import type { BroadcastLayoutConfig } from "./broadcastLayout.js";
import type { CompositeCardLabel, CompositeLabel, CompositeBackgroundKind } from "../types.js";

/** A small, visually distinct placeholder palette, one entry per chrome
 * kind — good enough for eyeballing region boundaries, not a claim of
 * real broadcast-graphics appearance (see this module's header). */
const CHROME_PLACEHOLDER_COLORS: Record<string, [number, number, number]> = {
  scoreboard: [18, 24, 58],
  sidebar: [26, 28, 38],
  webcam: [52, 58, 78],
  "info-stack": [8, 8, 8],
};

function paintRect(canvas: RawImage, xFrac: number, yFrac: number, wFrac: number, hFrac: number, color: [number, number, number]): void {
  const x0 = Math.round(xFrac * canvas.width);
  const y0 = Math.round(yFrac * canvas.height);
  const x1 = Math.round((xFrac + wFrac) * canvas.width);
  const y1 = Math.round((yFrac + hFrac) * canvas.height);
  for (let y = Math.max(0, y0); y < Math.min(canvas.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(canvas.width, x1); x++) {
      const i = (y * canvas.width + x) * 4;
      canvas.data[i] = color[0];
      canvas.data[i + 1] = color[1];
      canvas.data[i + 2] = color[2];
      canvas.data[i + 3] = 255;
    }
  }
}

export interface RenderBroadcastFrameInput {
  frameWidth: number;
  frameHeight: number;
  /** Already exactly frameWidth x frameHeight — a procedural background,
   * NEVER a real capture (#256's honest constraint: real captures are
   * calibration/reference-only, never pasted-under synthetic content). */
  frameBackground: RawImage;
  layout: BroadcastLayoutConfig;
  /** The merged near/far table (twoPlayer.ts's mergeBroadcastTableRenders
   * output), in its own local pixel space. */
  tableImage: RawImage;
  /** That same merged table's card labels, in the SAME local pixel space
   * as `tableImage` — transformed by this function through the table
   * homography, never mutated in place. */
  tableCardLabels: CompositeCardLabel[];
  keystoneLeftFrac: number;
  keystoneRightFrac: number;
  previewCard: { printingId: string; image: RawImage };
  compositeId: string;
  excludedCards: number;
  cardBacksPlaced: number;
  backgroundType: CompositeBackgroundKind;
  backgroundHash: string | null;
}

export interface RenderBroadcastFrameResult {
  image: RawImage;
  label: CompositeLabel;
}

export function renderBroadcastFrame(input: RenderBroadcastFrameInput): RenderBroadcastFrameResult {
  let canvas: RawImage = { width: input.frameWidth, height: input.frameHeight, data: new Uint8ClampedArray(input.frameBackground.data) };

  // Chrome placeholders, in the config's own authored array order — later
  // entries (e.g. webcam/info-stack/card-preview, nested WITHIN a
  // sidebar) intentionally paint over earlier ones, matching the
  // committed config's own nesting.
  let previewRect: { xFrac: number; yFrac: number; wFrac: number; hFrac: number } | null = null;
  for (const region of input.layout.chrome) {
    if (region.kind === "card-preview") {
      previewRect = region.rect;
      continue; // handled below, after the table warp, with a real card
    }
    const color = CHROME_PLACEHOLDER_COLORS[region.kind] ?? [40, 40, 40];
    paintRect(canvas, region.rect.xFrac, region.rect.yFrac, region.rect.wFrac, region.rect.hFrac, color);
  }

  // Table-level keystone warp — see broadcastGeometry.ts's header for the
  // single-source-of-truth contract this dstQuad provides.
  const playArea = input.layout.playArea;
  const dstQuad = computeTableDestQuad(input.frameWidth, input.frameHeight, {
    centerXFrac: playArea.xFrac + playArea.wFrac / 2,
    centerYFrac: playArea.yFrac + playArea.hFrac / 2,
    tableWidthFrac: playArea.wFrac,
    tableHeightFrac: playArea.hFrac,
    perspectiveLeftEdgeFrac: input.keystoneLeftFrac,
    perspectiveRightEdgeFrac: input.keystoneRightFrac,
  });
  const warpedTable = warpToQuad(input.tableImage, dstQuad, input.frameWidth, input.frameHeight);
  canvas = compositeOver(canvas, warpedTable);
  const transformedTableLabels = transformTableLabelsThroughHomography(input.tableImage.width, input.tableImage.height, dstQuad, input.tableCardLabels);

  // Card-preview panel: an ordinary, independent card placement (NOT part
  // of the table), centered in its own chrome rect.
  const cards: CompositeCardLabel[] = [...transformedTableLabels];
  if (previewRect) {
    const aspectRatio = input.previewCard.image.width / input.previewCard.image.height;
    const previewDstQuad = computeDestQuad(input.frameWidth, input.frameHeight, aspectRatio, {
      centerXFrac: previewRect.xFrac + previewRect.wFrac / 2,
      centerYFrac: previewRect.yFrac + previewRect.hFrac / 2,
      rotationDeg: 0,
      // Fills the panel's own height (frame fraction, matching
      // computeDestQuad's cardHeightFrac convention) — a fixed constant,
      // not drawn from any rng stream (the preview panel's SIZE is a
      // layout property, not an augmentation roll; only WHICH card
      // appears there is planned, via previewCardDraw).
      cardHeightFrac: previewRect.hFrac * 0.85,
      perspectiveLeftFrac: 0,
      perspectiveRightFrac: 0,
    });
    const warpedPreview = warpToQuad(input.previewCard.image, previewDstQuad, input.frameWidth, input.frameHeight);
    canvas = compositeOver(canvas, warpedPreview);
    cards.push({ printingId: input.previewCard.printingId, corners: previewDstQuad, tags: [], visibleFraction: 1, region: "preview" });
  }

  const label: CompositeLabel = {
    compositeId: input.compositeId,
    fileName: `${input.compositeId}.png`,
    width: input.frameWidth,
    height: input.frameHeight,
    backgroundType: input.backgroundType,
    backgroundHash: input.backgroundHash,
    cards,
    excludedCards: input.excludedCards,
    cardBacksPlaced: input.cardBacksPlaced,
  };

  return { image: canvas, label };
}
