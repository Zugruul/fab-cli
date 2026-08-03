/**
 * Raw RGBA pixel-buffer helpers (SPEC-APP.md §8.7b). Everything here is
 * pure pixel math with no image-codec dependency — sharp only appears at
 * the decode/encode boundary (imageIO.ts). All effects are intentionally
 * simplified simulations (documented per-function), not photorealistic
 * renders — good enough for augmentation variety, not a claim of physical
 * accuracy.
 */

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, length = width*height*4. */
  data: Uint8ClampedArray;
}

export function createSolidImage(width: number, height: number, color: [number, number, number], alpha = 255): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = color;
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = alpha;
  }
  return { width, height, data };
}

/** Bilinear sample at floating-point (x, y), edge-clamped within the
 * image; fully transparent [0,0,0,0] for any out-of-bounds query. */
export function bilinearSample(img: RawImage, x: number, y: number): [number, number, number, number] {
  if (x < 0 || x >= img.width || y < 0 || y >= img.height) return [0, 0, 0, 0];

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (px: number, py: number, ch: number): number => img.data[(py * img.width + px) * 4 + ch];
  const lerp = (a: number, bVal: number, t: number): number => a + (bVal - a) * t;

  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let ch = 0; ch < 4; ch++) {
    const top = lerp(at(x0, y0, ch), at(x1, y0, ch), fx);
    const bottom = lerp(at(x0, y1, ch), at(x1, y1, ch), fx);
    result[ch] = lerp(top, bottom, fy);
  }
  return result;
}

/** Standard "over" alpha compositing, `overlay` painted on top of `base`
 * — both must be the same width/height. Non-mutating. */
export function compositeOver(base: RawImage, overlay: RawImage): RawImage {
  const out = new Uint8ClampedArray(base.data.length);
  for (let i = 0; i < base.width * base.height; i++) {
    const bi = i * 4;
    const aOver = overlay.data[bi + 3] / 255;
    const aBase = base.data[bi + 3] / 255;
    const outA = aOver + aBase * (1 - aOver);
    for (let ch = 0; ch < 3; ch++) {
      out[bi + ch] = outA > 0 ? (overlay.data[bi + ch] * aOver + base.data[bi + ch] * aBase * (1 - aOver)) / outA : 0;
    }
    out[bi + 3] = outA * 255;
  }
  return { width: base.width, height: base.height, data: out };
}

/** Global lighting post-process: standard brightness/contrast adjustment
 * in normalized [0,1] space, applied uniformly to every pixel regardless
 * of alpha (this is meant to run on the whole, already-fully-opaque
 * composited canvas). Alpha itself is untouched. */
export function applyBrightnessContrast(img: RawImage, brightnessDelta: number, contrastDelta: number): RawImage {
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < img.width * img.height; i++) {
    const bi = i * 4;
    for (let ch = 0; ch < 3; ch++) {
      const normalized = img.data[bi + ch] / 255;
      const adjusted = (normalized - 0.5) * (1 + contrastDelta) + 0.5 + brightnessDelta;
      out[bi + ch] = adjusted * 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/** Simulated card-sleeve look: lightens RGB toward white by `intensity`,
 * only where alpha > 0 (never touches padding pixels outside the card's
 * own warped silhouette). Alpha untouched. */
export function applySleeve(img: RawImage, intensity = 0.18): RawImage {
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < img.width * img.height; i++) {
    const bi = i * 4;
    if (img.data[bi + 3] === 0) continue;
    for (let ch = 0; ch < 3; ch++) {
      out[bi + ch] = img.data[bi + ch] * (1 - intensity) + 255 * intensity;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Simulated glare streak: a diagonal brightness boost with triangular
 * falloff, centered at `positionFrac` (0..1, mapped onto the diagonal
 * band coordinate `u+v` which ranges 0..2) with half-width `bandWidth`,
 * only where alpha > 0.
 */
export function applyGlare(img: RawImage, positionFrac: number, intensity = 0.4, bandWidth = 0.35): RawImage {
  const out = new Uint8ClampedArray(img.data);
  const center = positionFrac * 2;
  for (let y = 0; y < img.height; y++) {
    const v = y / img.height;
    for (let x = 0; x < img.width; x++) {
      const bi = (y * img.width + x) * 4;
      if (img.data[bi + 3] === 0) continue;
      const u = x / img.width;
      const dist = Math.abs(u + v - center);
      const falloff = Math.max(0, 1 - dist / bandWidth);
      if (falloff === 0) continue;
      const boost = 255 * intensity * falloff;
      for (let ch = 0; ch < 3; ch++) out[bi + ch] = img.data[bi + ch] + boost;
    }
  }
  return { width: img.width, height: img.height, data: out };
}
