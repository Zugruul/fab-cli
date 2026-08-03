/**
 * Human-inspection sample sheet (SPEC-APP.md §8.7b AC: "sample sheet
 * renderable for human inspection"). Builds a single self-contained HTML
 * page: a grid of every composite image with its ground-truth quads drawn
 * as an SVG overlay — so a human can eyeball BOTH augmentation quality
 * (rotation/perspective/lighting/glare/sleeve variety) and label/pixel
 * fidelity (do the drawn quads actually trace the pasted cards?) in one
 * view, per this task's WHY section. References already-rendered
 * composite image files by relative path — this module does no image
 * decoding/encoding itself.
 */
import type { CompositeLabel } from "./types.js";

export interface SampleSheetEntry {
  fileName: string;
  label: CompositeLabel;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderEntry(entry: SampleSheetEntry): string {
  const { fileName, label } = entry;
  const polygons = label.cards
    .map((quad) => {
      const points = quad.corners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const tagTitle = quad.tags.length > 0 ? ` (${quad.tags.join(", ")})` : "";
      return `<polygon points="${points}" class="quad"><title>${escapeHtml(quad.printingId)}${escapeHtml(tagTitle)}</title></polygon>`;
    })
    .join("\n      ");

  return `
  <figure class="composite">
    <div class="frame">
      <img src="${escapeHtml(fileName)}" width="${label.width}" height="${label.height}" alt="${escapeHtml(label.compositeId)}">
      <svg viewBox="0 0 ${label.width} ${label.height}" preserveAspectRatio="none">
      ${polygons}
      </svg>
    </div>
    <figcaption>${escapeHtml(label.compositeId)} — ${label.cards.length} card(s) — ${escapeHtml(label.backgroundType)} background</figcaption>
  </figure>`;
}

export function buildSampleSheetHtml(entries: SampleSheetEntry[], title = "Composite sample sheet"): string {
  const body =
    entries.length === 0
      ? "<p>No composites in this run.</p>"
      : `<div class="grid">${entries.map(renderEntry).join("\n")}</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: sans-serif; background: #111; color: #eee; margin: 1.5rem; }
  .grid { display: flex; flex-wrap: wrap; gap: 1rem; }
  .composite { margin: 0; width: 260px; }
  .frame { position: relative; width: 100%; }
  .frame img { width: 100%; height: auto; display: block; }
  .frame svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
  .quad { fill: rgba(0, 255, 128, 0.12); stroke: #0f8; stroke-width: 2; vector-effect: non-scaling-stroke; }
  figcaption { font-size: 0.8rem; color: #aaa; margin-top: 0.25rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
}
