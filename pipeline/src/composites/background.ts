/**
 * Procedural background generation (SPEC-APP.md §8.7b): solid/gradient/
 * noise/texture patterns, generated deterministically from already-
 * resolved `BackgroundParams` (all randomness is resolved upstream in
 * paramStream.ts's seeded draws — this module takes zero further random
 * decisions, so it stays a pure function of its inputs). Per the backlog
 * brief, real/photographic backgrounds are explicitly NOT vendored or
 * committed here — see loadExternalBackgroundRefs for the documented
 * future-extension hook (config.backgroundsDir).
 */
import fs from "node:fs";
import path from "node:path";
import { createSolidImage } from "./rawImage.js";
import type { RawImage } from "./rawImage.js";
import type { BackgroundType } from "./types.js";

export interface BackgroundParams {
  type: BackgroundType;
  colorA: [number, number, number];
  colorB: [number, number, number];
  /** Gradient direction, degrees. */
  angleDeg: number;
  /** Drives noise/texture pattern specifics — NOT a PRNG seed consumed
   * live here; it's just a number already drawn by paramStream.ts's rng,
   * used below as input to a pure positional hash/tiling function. */
  noiseSeed: number;
}

/** Deterministic pure hash of (x, y, seed) into [0, 1) — same bit-mixing
 * style as behavior/rng.ts's mulberry32, but keyed by POSITION rather
 * than being a stateful stream, so any pixel can be addressed directly
 * without replaying prior draws. Not Math.random, not stateful. */
function hash2D(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 15), 1 | h);
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function fillWith(width: number, height: number, colorAt: (x: number, y: number) => [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorAt(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

export function generateBackgroundRaw(width: number, height: number, params: BackgroundParams): RawImage {
  switch (params.type) {
    case "solid":
      return createSolidImage(width, height, params.colorA, 255);

    case "gradient": {
      const rad = (params.angleDeg * Math.PI) / 180;
      const dir = { x: Math.cos(rad), y: Math.sin(rad) };
      const corners = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
      const projections = corners.map((c) => c.x * dir.x + c.y * dir.y);
      const min = Math.min(...projections);
      const max = Math.max(...projections);
      const range = max - min || 1;
      return fillWith(width, height, (x, y) => {
        const proj = (x / width) * dir.x + (y / height) * dir.y;
        const t = Math.min(1, Math.max(0, (proj - min) / range));
        return lerpColor(params.colorA, params.colorB, t);
      });
    }

    case "noise":
      return fillWith(width, height, (x, y) => lerpColor(params.colorA, params.colorB, hash2D(x, y, params.noiseSeed)));

    case "texture": {
      const tileSize = 8 + (Math.abs(params.noiseSeed) % 24);
      return fillWith(width, height, (x, y) => {
        const tx = Math.floor(x / tileSize);
        const ty = Math.floor(y / tileSize);
        return (tx + ty) % 2 === 0 ? params.colorA : params.colorB;
      });
    }
  }
}

/**
 * Documented future-extension hook (APP-026 brief: "leave a documented
 * hook for a user-supplied backgrounds dir later"): lists usable image
 * files in `dir` (empty array if `dir` is null or doesn't exist/has none)
 * — never fabricates paths. Actual loading/resizing of an external
 * background into a RawImage is intentionally NOT wired into the
 * generator's default path (composites are always procedural per the
 * brief); a caller wanting real backgrounds decodes one of these paths
 * via imageIO.ts's decodeImageToRaw and resizes to canvas size itself.
 */
export function loadExternalBackgroundRefs(dir: string | null): string[] {
  if (!dir) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const exts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  return entries.filter((f) => exts.has(path.extname(f).toLowerCase())).sort();
}
