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
 * Cover-fit resize (#244): scales `img` up or down (uniformly, aspect
 * preserved) so it fully covers a `targetWidth`x`targetHeight` canvas,
 * then center-crops any overflow — never letterboxes. This is the
 * generation-time step that turns an arbitrary real background photo into
 * a full-bleed canvas background.
 *
 * Boundary decision (task #244): UPSCALING a source smaller than the
 * canvas is intentional, not a bug — a bordered/letterboxed background
 * would read as an obvious synthetic artifact, whereas a slightly-
 * softened upscaled crop still looks like a plausible real surface (the
 * import pipeline's own downscale-only cap, imageIO.ts's
 * decodeAndNormalizeBackground, is a separate, earlier concern: capping
 * oversized SOURCE photos, not this generation-time fit).
 *
 * The crop offset is always the exact center — never a seeded random
 * offset — so this stays a pure function of its inputs and never touches
 * the composite's rng stream (paramStream.ts's determinism contract is
 * unaffected by which portion of a background photo ends up visible).
 * Uses bilinearSample (same sampling as warp.ts); source coordinates are
 * clamped just inside the source bounds to avoid a stray fully-
 * transparent edge pixel from floating-point overshoot exactly at the
 * boundary.
 */
export function coverFitRawImage(img: RawImage, targetWidth: number, targetHeight: number): RawImage {
  const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
  const scaledW = img.width * scale;
  const scaledH = img.height * scale;
  const offsetX = (scaledW - targetWidth) / 2;
  const offsetY = (scaledH - targetHeight) / 2;

  const data = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const maxX = img.width - 1e-4;
  const maxY = img.height - 1e-4;
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(Math.max((x + offsetX) / scale, 0), maxX);
      const srcY = Math.min(Math.max((y + offsetY) / scale, 0), maxY);
      const [r, g, b, a] = bilinearSample(img, srcX, srcY);
      const i = (y * targetWidth + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width: targetWidth, height: targetHeight, data };
}

/**
 * Separable Gaussian blur (#289): the dominant measured term of the
 * synthetic-to-real detector gap is sharpness, not noise or lighting — a
 * mild blur (sigma=1.5) cost 68% of mAP on held-out synthetic composites
 * while realistic sensor noise cost ~0% (see config.ts's blurSigma doc
 * and the issue for the full measurement). This is a standard, separable
 * (horizontal pass then vertical pass) Gaussian low-pass filter applied to
 * RGB channels only — alpha is passed through untouched, mirroring
 * applyBrightnessContrast's "alpha itself is untouched" convention (this
 * runs on the fully composited, already-opaque canvas, so alpha blurring
 * would have no visible effect anyway).
 *
 * Edge-clamped (same clamp-to-edge convention as coverFitRawImage /
 * bilinearSample) rather than zero-padded — a zero-padded border would
 * visibly darken every edge of the canvas, an obvious synthetic artifact
 * real photos don't have.
 *
 * `sigma <= 0` is a no-op (returns an unmutated copy) rather than
 * throwing, mirroring applyBrightnessContrast(img, 0, 0)'s legal no-op
 * shape — compositor.ts's caller only invokes this when a composite's
 * blur roll actually fired (see paramStream.ts's `blur` draw), but this
 * function stays defensively sane for any other caller too.
 */
export function applyGaussianBlur(img: RawImage, sigma: number): RawImage {
  if (sigma <= 0) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };

  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let kernelSum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(v);
    kernelSum += v;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= kernelSum;

  const { width, height, data } = img;
  const clampX = (x: number): number => Math.min(Math.max(x, 0), width - 1);
  const clampY = (y: number): number => Math.min(Math.max(y, 0), height - 1);

  // Horizontal pass into a Float64 buffer (RGB only — alpha carried
  // through unfiltered at the end) to avoid compounding rounding error
  // before the vertical pass.
  const horizontal = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = clampX(x + k);
        const si = (y * width + sx) * 4;
        const w = kernel[k + radius];
        r += data[si] * w;
        g += data[si + 1] * w;
        b += data[si + 2] * w;
      }
      const di = (y * width + x) * 3;
      horizontal[di] = r;
      horizontal[di + 1] = g;
      horizontal[di + 2] = b;
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = clampY(y + k);
        const si = (sy * width + x) * 3;
        const w = kernel[k + radius];
        r += horizontal[si] * w;
        g += horizontal[si + 1] * w;
        b += horizontal[si + 2] * w;
      }
      const di = (y * width + x) * 4;
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = b;
      out[di + 3] = data[di + 3];
    }
  }
  return { width, height, data: out };
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
