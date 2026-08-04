/**
 * Dedicated sample sheet for `--mode broadcast` (#256 Phase D): synthetic
 * broadcast renders WITH label overlays, interleaved with real imported
 * captures shown as UNLABELED reference material — issue #256's honest
 * constraint restated visually: these real screenshots have no
 * ground-truth labels and must never be mistaken for training data.
 * Every single reference tile carries an explicit, unconditional
 * "REFERENCE — unlabeled real capture, not training data" marker baked
 * directly onto the tile (not just a caption a reader could skim past) —
 * a human must never be able to confuse one for the other.
 *
 * Reuses sampleSheet.ts's exact per-card overlay fidelity (polygon quads,
 * visibleFraction tooltip, excluded-count caption) for synthetic tiles —
 * this module's `renderSyntheticTile` is a broadcast-aware sibling of
 * that file's own (unexported) per-entry renderer, extended with the
 * region ("table"/"preview") discriminator so a human can tell a
 * preview-panel label from an on-table one at a glance.
 */
import type { CompositeLabel } from "../types.js";
import type { SampleSheetEntry } from "../sampleSheet.js";
import type { CaptureFraming } from "../importCaptures.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface BroadcastReferenceEntry {
  /** File name of the imported capture PNG, relative to wherever the
   * sample sheet HTML itself is written (the caller is responsible for
   * making these resolvable, e.g. by co-locating the sheet with the
   * captures dir or using a relative/absolute path as fileName). */
  fileName: string;
  framing: CaptureFraming;
}

function renderSyntheticTile(entry: SampleSheetEntry): string {
  const { fileName, label } = entry;
  const polygons = label.cards
    .map((quad) => {
      const points = quad.corners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const visibleFractionLabel = ` vis=${Math.round(quad.visibleFraction * 100)}%`;
      const regionLabel = ` region=${quad.region}`;
      const tagTitle = quad.tags.length > 0 ? ` (${quad.tags.join(", ")})` : "";
      return `<polygon points="${points}" class="quad quad-${quad.region}"><title>${escapeHtml(quad.printingId)}${escapeHtml(visibleFractionLabel)}${escapeHtml(regionLabel)}${escapeHtml(tagTitle)}</title></polygon>`;
    })
    .join("\n      ");
  const excludedSuffix = label.excludedCards > 0 ? ` (${label.excludedCards} excluded)` : "";
  const regionSummary = label.cards.length > 0 ? ` — regions: ${[...new Set(label.cards.map((c) => c.region))].join(", ")}` : "";

  return `
  <figure class="composite synthetic">
    <div class="frame">
      <img src="${escapeHtml(fileName)}" width="${label.width}" height="${label.height}" alt="${escapeHtml(label.compositeId)}">
      <svg viewBox="0 0 ${label.width} ${label.height}" preserveAspectRatio="none">
      ${polygons}
      </svg>
    </div>
    <figcaption>SYNTHETIC — ${escapeHtml(label.compositeId)} — ${label.cards.length} card(s)${escapeHtml(excludedSuffix)}${escapeHtml(regionSummary)}</figcaption>
  </figure>`;
}

function renderReferenceTile(entry: BroadcastReferenceEntry): string {
  return `
  <figure class="composite reference">
    <div class="frame">
      <img src="${escapeHtml(entry.fileName)}" alt="reference capture ${escapeHtml(entry.fileName)}">
      <div class="reference-banner">REFERENCE — unlabeled real capture, not training data</div>
    </div>
    <figcaption>REFERENCE (${escapeHtml(entry.framing)}) — ${escapeHtml(entry.fileName)}</figcaption>
  </figure>`;
}

/** Interleaves synthetic and reference tiles one-for-one (synthetic,
 * reference, synthetic, reference, ...) until one list runs out, then
 * appends whatever remains of the longer list — a simple, deterministic,
 * order-preserving zip (never reorders within either list). */
function interleave<A, B>(a: A[], b: B[]): (A | B)[] {
  const out: (A | B)[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

function isSyntheticEntry(v: SampleSheetEntry | BroadcastReferenceEntry): v is SampleSheetEntry {
  return "label" in v;
}

export function buildBroadcastSampleSheetHtml(
  synthetic: SampleSheetEntry[],
  references: BroadcastReferenceEntry[],
  title = "Broadcast composite sample sheet",
): string {
  const tiles = interleave(synthetic, references);
  const body =
    tiles.length === 0
      ? "<p>No tiles in this run.</p>"
      : `<div class="grid">${tiles.map((t) => (isSyntheticEntry(t) ? renderSyntheticTile(t) : renderReferenceTile(t))).join("\n")}</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: sans-serif; background: #111; color: #eee; margin: 1.5rem; }
  .grid { display: flex; flex-wrap: wrap; gap: 1rem; }
  .composite { margin: 0; width: 320px; }
  .frame { position: relative; width: 100%; }
  .frame img { width: 100%; height: auto; display: block; }
  .frame svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
  .quad { fill: rgba(0, 255, 128, 0.12); stroke: #0f8; stroke-width: 2; vector-effect: non-scaling-stroke; }
  .quad-preview { fill: rgba(255, 180, 0, 0.15); stroke: #fb0; }
  figcaption { font-size: 0.8rem; color: #aaa; margin-top: 0.25rem; }
  .composite.synthetic figcaption { color: #7f7; }
  .composite.reference .frame { border: 4px solid #f44; }
  .composite.reference figcaption { color: #f88; font-weight: bold; }
  .reference-banner {
    position: absolute; top: 0; left: 0; right: 0;
    background: rgba(200, 20, 20, 0.85); color: #fff;
    font-size: 0.75rem; font-weight: bold; text-align: center;
    padding: 0.3rem; text-transform: uppercase;
  }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
}

// Re-exported for callers building CompositeLabel/SampleSheetEntry values
// alongside this module (no new type introduced beyond what's declared
// above — kept as a type-only re-export for import convenience).
export type { CompositeLabel };
