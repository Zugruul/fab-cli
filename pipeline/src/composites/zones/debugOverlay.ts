/**
 * Zone-map debug overlay (#253): draws each zone's rect boundary onto a
 * copy of the playmat image, so a hand-authored zone map can be verified
 * by eye against the real photo before it's trusted for generation. Pure
 * pixel math (rawImage.ts primitives only) — no codec dependency, easily
 * unit tested without ever decoding/encoding a real PNG.
 */
import type { RawImage } from "../rawImage.js";
import type { ZoneMap } from "./zoneMap.js";

/** A small, visually distinct palette, cycled per zone by index — good
 * enough for eyeballing 12 zones without two adjacent zones sharing a
 * color. */
const OVERLAY_COLORS: [number, number, number][] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 128, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 128, 0],
  [128, 0, 255],
];

function setPixel(img: RawImage, x: number, y: number, color: [number, number, number]): void {
  if (x < 0 || x >= img.width || y < 0 || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = color[0];
  img.data[i + 1] = color[1];
  img.data[i + 2] = color[2];
  img.data[i + 3] = 255;
}

/**
 * Draws a `strokeWidthPx`-thick rectangle outline for `zone.rect` (mapped
 * from normalized fractions to pixel coordinates) directly onto a mutable
 * copy of `playmat`. Silently clips at the canvas edge (setPixel's bounds
 * check) rather than crashing — a zone rect that runs slightly past the
 * canvas is a hand-authoring imprecision worth surfacing visually, not a
 * reason to abort the whole overlay render.
 */
export function renderZoneOverlay(playmat: RawImage, zoneMap: ZoneMap, strokeWidthPx = 3): RawImage {
  const out: RawImage = { width: playmat.width, height: playmat.height, data: new Uint8ClampedArray(playmat.data) };

  zoneMap.zones.forEach((zone, i) => {
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
    const x0 = Math.round(zone.rect.xFrac * playmat.width);
    const y0 = Math.round(zone.rect.yFrac * playmat.height);
    const w = Math.round(zone.rect.wFrac * playmat.width);
    const h = Math.round(zone.rect.hFrac * playmat.height);
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;

    for (let t = 0; t < strokeWidthPx; t++) {
      for (let x = x0; x <= x1; x++) {
        setPixel(out, x, y0 + t, color);
        setPixel(out, x, y1 - t, color);
      }
      for (let y = y0; y <= y1; y++) {
        setPixel(out, x0 + t, y, color);
        setPixel(out, x1 - t, y, color);
      }
    }
  });

  return out;
}
