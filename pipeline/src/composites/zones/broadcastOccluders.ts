/**
 * Procedural occluder image generators for `--mode broadcast` (#256 Phase
 * C.3) — the REQUIRED realism vocabulary the brief calls out: card stacks
 * with visible thickness, dice resting on cards, hands entering frame
 * (border-inset sleeves reuse rawImage.ts's existing applySleeve via the
 * ordinary "sleeved" tag — no new code needed for that one; card-clipping
 * at the play-area edge falls out of the amodal convention + near-edge
 * zone placement, also no new code here).
 *
 * Every function here is a PURE, deterministic RawImage builder — no rng
 * calls at all (this file lives under composites/zones/, so it's swept by
 * composites.rngGuard.test.ts's static Math.random grep like every other
 * file in the module; more importantly, ALL randomness for occluder
 * placement/appearance is drawn by the caller's seeded stream, see
 * planBroadcastAugmentation.ts, so this module stays trivially testable
 * with fixed inputs). Deliberately simplified simulations, not
 * photorealistic renders — same documented philosophy as rawImage.ts's
 * applySleeve/applyGlare (good enough for occlusion realism/variety, not a
 * claim of physical accuracy).
 *
 * Every image returned here is meant to be placed via the ordinary
 * geometry.ts/warp.ts pipeline (computeDestQuad + warpToQuad) with
 * CardPlacement.isOccluder: true — see compositor.ts's occluder handling
 * and test/composites.compositor.occluders.test.ts.
 */
import { bilinearSample } from "../rawImage.js";
import type { RawImage } from "../rawImage.js";

/**
 * A thin, fully-opaque solid-color slab — one "shim" layer simulating the
 * visible edge thickness of a stack of cards (deck / graveyard / pitch
 * pile) when several extra shim placements are pasted at small offsets
 * just behind the top (real or card-back) card — see
 * planBroadcastAugmentation.ts's stack-shim planning.
 */
export function createStackShimImage(width: number, height: number, color: [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = color;
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Pip-dot layout per standard six-sided-die face, as fractional (x,y)
 * positions on a 3x3 grid (0/0.5/1 of the die body). */
const DICE_PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};

/**
 * A square die body with pip dots for `face` (1-6, clamped into range —
 * an out-of-range value is a caller bug, not a reason to crash or render a
 * blank die). Fully opaque throughout (a die has no soft/transparent edge,
 * unlike a card's warped silhouette).
 */
export function createDiceImage(width: number, height: number, bodyColor: [number, number, number], pipColor: [number, number, number], face: number): RawImage {
  const clampedFace = Math.max(1, Math.min(6, Math.round(face)));
  const img = createStackShimImage(width, height, bodyColor);
  const pipRadius = Math.max(1, Math.round(Math.min(width, height) * 0.08));
  for (const [fx, fy] of DICE_PIP_LAYOUTS[clampedFace]) {
    const cx = fx * width;
    const cy = fy * height;
    const minX = Math.max(0, Math.floor(cx - pipRadius));
    const maxX = Math.min(width - 1, Math.ceil(cx + pipRadius));
    const minY = Math.max(0, Math.floor(cy - pipRadius));
    const maxY = Math.min(height - 1, Math.ceil(cy + pipRadius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > pipRadius * pipRadius) continue;
        const i = (y * width + x) * 4;
        img.data[i] = pipColor[0];
        img.data[i + 1] = pipColor[1];
        img.data[i + 2] = pipColor[2];
      }
    }
  }
  return img;
}

/**
 * A soft-edged elliptical "hand" blob in `skinTone` — a deliberately
 * abstract simplification (a real hand's silhouette is far more complex
 * than an ellipse), but a good-enough occluder shape for the purpose:
 * something with a solid opaque core and a falling-off, non-rectangular
 * edge, entering from wherever the caller centers/warps it via the
 * ordinary card-quad pipeline. Alpha falls off smoothly from fully opaque
 * at the center to fully transparent at/past the ellipse boundary, so it
 * composites without a hard rectangular edge.
 */
export function createHandImage(width: number, height: number, skinTone: [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = skinTone;
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  // Falloff band (as a fraction of the ellipse radius) over which alpha
  // ramps from 255 to 0, so the edge isn't a hard cutoff.
  const softEdgeFrac = 0.15;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const dist = Math.sqrt(nx * nx + ny * ny);
      let alpha: number;
      if (dist >= 1) alpha = 0;
      else if (dist <= 1 - softEdgeFrac) alpha = 255;
      else alpha = 255 * (1 - (dist - (1 - softEdgeFrac)) / softEdgeFrac);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = alpha;
    }
  }
  return { width, height, data };
}

/**
 * Directional motion blur — REQUIRED for `--mode broadcast`'s hand
 * occluder (#256 correction: the Pro Tour Las Vegas rig shows heavy
 * motion blur on hands sweeping across frame prominently; originally
 * scoped as a nice-to-have deferral, upgraded once a second real rig
 * showed it as a dominant realism cue). A pure box-blur along a straight
 * line at `angleDeg` (screen/pixel-space, same convention as
 * geometry.ts's rotationDeg): for every output pixel, averages
 * `sampleCount` bilinear samples spread evenly across a line of length
 * `kernelLength` centered on that pixel, both derived deterministically
 * from `strength` (0..1) and the image's own size — no rng, no
 * photorealistic claim (same "simplified simulation" philosophy as
 * rawImage.ts's applySleeve/applyGlare), just a real, visible directional
 * smear whose severity scales with `strength`.
 *
 * `strength <= 0` is an exact no-op (returns an unmodified copy) — a
 * legitimate, common draw (see planBroadcastAugmentation.ts's
 * blurStrengthDraw), not a special-cased skip.
 */
export function applyDirectionalMotionBlur(img: RawImage, strength: number, angleDeg: number): RawImage {
  if (strength <= 0) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };

  // Kernel spans up to 25% of the image's longer side at strength=1 — a
  // visible, but not image-obliterating, smear at the extreme.
  const maxKernelFrac = 0.25;
  const kernelLength = strength * maxKernelFrac * Math.max(img.width, img.height);
  const sampleCount = Math.max(3, Math.round(kernelLength));

  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);

  const data = new Uint8ClampedArray(img.width * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let s = 0; s < sampleCount; s++) {
        const t = (s / (sampleCount - 1) - 0.5) * kernelLength;
        const [sr, sg, sb, sa] = bilinearSample(img, x + 0.5 + dx * t, y + 0.5 + dy * t);
        r += sr;
        g += sg;
        b += sb;
        a += sa;
      }
      const i = (y * img.width + x) * 4;
      data[i] = r / sampleCount;
      data[i + 1] = g / sampleCount;
      data[i + 2] = b / sampleCount;
      data[i + 3] = a / sampleCount;
    }
  }
  return { width: img.width, height: img.height, data };
}
