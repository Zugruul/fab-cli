import { describe, it, expect } from "vitest";
import {
  createSolidImage,
  bilinearSample,
  compositeOver,
  applyBrightnessContrast,
  applySleeve,
  applyGlare,
  coverFitRawImage,
  applyGaussianBlur,
} from "../src/composites/rawImage.js";
import type { RawImage } from "../src/composites/rawImage.js";

function pixel(img: RawImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function makeImage(width: number, height: number, fillFn: (x: number, y: number) => [number, number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fillFn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

describe("createSolidImage", () => {
  it("fills every pixel with the given color and alpha", () => {
    const img = createSolidImage(3, 2, [10, 20, 30], 200);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        expect(pixel(img, x, y)).toEqual([10, 20, 30, 200]);
      }
    }
  });
});

describe("bilinearSample", () => {
  // 2x2: (0,0)=red (1,0)=green (0,1)=blue (1,1)=white
  const img = makeImage(2, 2, (x, y) => {
    if (x === 0 && y === 0) return [255, 0, 0, 255];
    if (x === 1 && y === 0) return [0, 255, 0, 255];
    if (x === 0 && y === 1) return [0, 0, 255, 255];
    return [255, 255, 255, 255];
  });

  it("returns the exact pixel at integer coordinates", () => {
    expect(bilinearSample(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(bilinearSample(img, 1, 0)).toEqual([0, 255, 0, 255]);
  });

  it("averages horizontally neighboring pixels at a half-integer x", () => {
    const [r, g, b, a] = bilinearSample(img, 0.5, 0);
    expect(r).toBeCloseTo(127.5, 0);
    expect(g).toBeCloseTo(127.5, 0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  it("returns fully transparent for any out-of-bounds query", () => {
    expect(bilinearSample(img, -1, 0)).toEqual([0, 0, 0, 0]);
    expect(bilinearSample(img, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(bilinearSample(img, 0, -0.01)).toEqual([0, 0, 0, 0]);
    expect(bilinearSample(img, 0, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe("compositeOver", () => {
  it("a fully opaque overlay completely replaces the base", () => {
    const base = createSolidImage(2, 2, [255, 0, 0], 255);
    const overlay = createSolidImage(2, 2, [0, 255, 0], 255);
    const result = compositeOver(base, overlay);
    expect(pixel(result, 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it("a fully transparent overlay leaves the base untouched", () => {
    const base = createSolidImage(2, 2, [255, 0, 0], 255);
    const overlay = createSolidImage(2, 2, [0, 255, 0], 0);
    const result = compositeOver(base, overlay);
    expect(pixel(result, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("blends a half-alpha overlay over an opaque base (standard 'over' compositing)", () => {
    const base = createSolidImage(1, 1, [255, 0, 0], 255);
    const overlay = createSolidImage(1, 1, [0, 255, 0], 128);
    const [r, g, b, a] = pixel(compositeOver(base, overlay), 0, 0);
    // aOver = 128/255; outA = aOver + 1*(1-aOver) = 1 (opaque base underneath)
    // r = 255*(1-aOver), g = 255*aOver, b = 0
    expect(r).toBeCloseTo(255 * (1 - 128 / 255), 0);
    expect(g).toBeCloseTo(255 * (128 / 255), 0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  it("does not mutate either input", () => {
    const base = createSolidImage(1, 1, [255, 0, 0], 255);
    const overlay = createSolidImage(1, 1, [0, 255, 0], 128);
    const baseCopy = new Uint8ClampedArray(base.data);
    const overlayCopy = new Uint8ClampedArray(overlay.data);
    compositeOver(base, overlay);
    expect(base.data).toEqual(baseCopy);
    expect(overlay.data).toEqual(overlayCopy);
  });
});

describe("applyBrightnessContrast", () => {
  it("brightens without changing alpha (hand-computed)", () => {
    // (100/255 - 0.5) * (1+0) + 0.5 + 0.2 = 0.592157 -> *255 = 151.0
    const img = createSolidImage(1, 1, [100, 100, 100], 255);
    const result = applyBrightnessContrast(img, 0.2, 0);
    const [r, , , a] = pixel(result, 0, 0);
    expect(r).toBeCloseTo(151, 0);
    expect(a).toBe(255);
  });

  it("applies contrast without changing alpha (hand-computed)", () => {
    // (200/255 - 0.5) * 1.5 + 0.5 = 0.926471 -> *255 = 236.25
    const img = createSolidImage(1, 1, [200, 200, 200], 255);
    const result = applyBrightnessContrast(img, 0, 0.5);
    const [r] = pixel(result, 0, 0);
    expect(r).toBeCloseTo(236.25, 0);
  });

  it("clamps to [0,255]", () => {
    const img = createSolidImage(1, 1, [250, 5, 128], 255);
    const bright = applyBrightnessContrast(img, 1, 0);
    const dark = applyBrightnessContrast(img, -1, 0);
    for (const c of bright.data.slice(0, 3)) expect(c).toBeLessThanOrEqual(255);
    for (const c of dark.data.slice(0, 3)) expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe("applySleeve", () => {
  it("lightens toward white proportional to intensity (hand-computed), only where alpha > 0", () => {
    const img = makeImage(2, 1, (x) => (x === 0 ? [100, 100, 100, 255] : [100, 100, 100, 0]));
    const result = applySleeve(img, 0.2);
    // opaque pixel: 100*0.8 + 255*0.2 = 131
    expect(pixel(result, 0, 0)[0]).toBeCloseTo(131, 0);
    // transparent pixel untouched (alpha stays 0)
    expect(pixel(result, 1, 0)[3]).toBe(0);
  });
});

describe("applyGlare", () => {
  it("boosts brightness near the glare band center and leaves far pixels alone", () => {
    // width=4,height=1 -> u=x/4, v=0 -> band=u; center=positionFrac*2=1.0
    const img = createSolidImage(4, 1, [100, 100, 100], 255);
    const result = applyGlare(img, 0.5, 0.4, 0.5);
    // x=3: u=0.75, dist=|0.75-1|=0.25, falloff=1-0.25/0.5=0.5, boost=255*0.4*0.5=51 -> 151
    expect(pixel(result, 3, 0)[0]).toBeCloseTo(151, 0);
    // x=2: u=0.5, dist=0.5, falloff=1-0.5/0.5=0 -> unchanged (100)
    expect(pixel(result, 2, 0)[0]).toBeCloseTo(100, 0);
  });

  it("never touches fully transparent pixels", () => {
    const img = createSolidImage(4, 1, [100, 100, 100], 0);
    const result = applyGlare(img, 0.5, 0.9, 0.9);
    expect(pixel(result, 3, 0)).toEqual([100, 100, 100, 0]);
  });
});

// #244: real background photos are decoded at whatever resolution/aspect
// the source file has — coverFitRawImage is the deterministic "make it
// fill the canvas" step at GENERATION time (distinct from importBackgrounds'
// import-time downscale-only cap). Boundary decision: UPSCALE when the
// source is smaller than the canvas (never letterbox a synthetic border
// into a background meant to look real), then always CENTER-crop any
// overflow — no seeded random crop offset, so this stays a pure function
// of its inputs (the composite's determinism contract never touches this).
describe("coverFitRawImage", () => {
  it("returns an image sized exactly to the target dimensions regardless of source aspect", () => {
    const img = createSolidImage(10, 10, [10, 20, 30], 255);
    const result = coverFitRawImage(img, 40, 25);
    expect(result.width).toBe(40);
    expect(result.height).toBe(25);
    expect(result.data.length).toBe(40 * 25 * 4);
  });

  it("upscales a source image smaller than the target — never letterboxes (fully opaque, no border)", () => {
    const img = createSolidImage(5, 5, [200, 50, 10], 255);
    const result = coverFitRawImage(img, 20, 20);
    for (let y = 0; y < 20; y += 4) {
      for (let x = 0; x < 20; x += 4) {
        const [r, g, b, a] = pixel(result, x, y);
        expect(r).toBeCloseTo(200, -1);
        expect(g).toBeCloseTo(50, -1);
        expect(b).toBeCloseTo(10, -1);
        expect(a).toBe(255);
      }
    }
  });

  it("center-crops a wider-than-target source along the horizontal axis (hand-computed)", () => {
    // 4-wide x 2-tall image, four distinct solid columns.
    const cols: [number, number, number, number][] = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 0, 255],
    ];
    const img = makeImage(4, 2, (x) => cols[x]);
    const result = coverFitRawImage(img, 2, 2);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    // scale = max(2/4, 2/2) = 1; offsetX = (4*1 - 2)/2 = 1 -> center columns
    // 1,2 (green, blue) survive; the outer red/yellow columns are cropped.
    expect(pixel(result, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixel(result, 1, 0)).toEqual([0, 0, 255, 255]);
  });

  it("never produces a transparent edge pixel from floating-point overshoot at the source boundary", () => {
    const img = createSolidImage(3, 3, [77, 88, 99], 255);
    const result = coverFitRawImage(img, 3, 3);
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i + 3]).toBe(255);
    }
  });

  it("is deterministic — same input always produces the same output (no seeded/random crop offset)", () => {
    const img = createSolidImage(7, 5, [1, 2, 3], 255);
    const a = coverFitRawImage(img, 30, 17);
    const b = coverFitRawImage(img, 30, 17);
    expect(a.data).toEqual(b.data);
  });
});

// #289: Gaussian blur augmentation closing the synthetic-to-real sharpness
// gap (see rawImage.ts's applyGaussianBlur doc + config.ts's blurSigma
// doc). Kill-first note: asserting "pixels changed" alone is not a lock —
// a buggy implementation that e.g. always returns the input unchanged, or
// one that darkens edges via implicit zero-padding instead of edge-clamp,
// would also make naive "some pixel differs" assertions pass. Every test
// below asserts DIRECTION + MAGNITUDE via laplacianVariance (the same
// sharpness proxy issue #289 measured with), or a specific edge-clamp
// invariant.

/** Discrete Laplacian-variance sharpness proxy (issue #289's own metric):
 * luminance, kernel [[0,1,0],[1,-4,1],[0,1,0]], variance of the response
 * over all interior pixels. Higher = sharper/more high-frequency detail. */
function laplacianVariance(img: RawImage): number {
  const { width, height, data } = img;
  const lum = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const responses: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      responses.push(-4 * lum(x, y) + lum(x - 1, y) + lum(x + 1, y) + lum(x, y - 1) + lum(x, y + 1));
    }
  }
  const mean = responses.reduce((a, b) => a + b, 0) / responses.length;
  return responses.reduce((a, b) => a + (b - mean) ** 2, 0) / responses.length;
}

/** High-frequency checkerboard test image — a solid-color image always has
 * zero Laplacian variance regardless of blur, so it can't distinguish "blur
 * applied" from "blur no-op'd"; a checkerboard gives blur something real to
 * remove. */
function checkerboard(size: number, cell = 2): RawImage {
  return makeImage(size, size, (x, y) => {
    const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
    const v = on ? 255 : 0;
    return [v, v, v, 255];
  });
}

describe("applyGaussianBlur", () => {
  it("sigma<=0 is a no-op: returns an unmutated copy, not the same reference", () => {
    const img = checkerboard(16);
    const result = applyGaussianBlur(img, 0);
    expect(result).not.toBe(img);
    expect(result.data).toEqual(img.data);
  });

  it("does not mutate the input image", () => {
    const img = checkerboard(16);
    const before = new Uint8ClampedArray(img.data);
    applyGaussianBlur(img, 2);
    expect(img.data).toEqual(before);
  });

  it("increasing sigma monotonically reduces Laplacian-variance sharpness, by a real margin each step (not just 'some pixel changed')", () => {
    const img = checkerboard(64);
    const v0 = laplacianVariance(img);
    const v1 = laplacianVariance(applyGaussianBlur(img, 1));
    const v2 = laplacianVariance(applyGaussianBlur(img, 2));
    const v4 = laplacianVariance(applyGaussianBlur(img, 4));

    expect(v1).toBeLessThan(v0);
    expect(v2).toBeLessThan(v1);
    expect(v4).toBeLessThan(v2);

    // Magnitude, not just direction: a mild sigma=1 blur on a checkerboard
    // this fine (2px cells) already removes the bulk of the high-frequency
    // energy — matches issue #289's own finding that even a MILD blur
    // (sigma=1.5) causes a large, not marginal, sharpness/mAP change.
    expect(v1).toBeLessThan(v0 * 0.5);
  });

  it("leaves the alpha channel untouched", () => {
    const img = makeImage(8, 8, (x) => (x < 4 ? [10, 20, 30, 60] : [200, 210, 220, 200]));
    const result = applyGaussianBlur(img, 2);
    for (let i = 3; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(img.data[i]);
    }
  });

  it("edge-clamps rather than sampling a black/transparent border: a uniform-color image stays uniform after blur", () => {
    // Kill-first target: an implementation that zero-pads (instead of
    // clamping) the border would visibly darken/lighten pixels near every
    // edge of a solid image — this would NOT be caught by a "some pixel
    // changed" test but IS caught here.
    const img = createSolidImage(20, 20, [123, 45, 67], 255);
    const result = applyGaussianBlur(img, 3);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const [r, g, b] = pixel(result, x, y);
        expect(r).toBeCloseTo(123, 0);
        expect(g).toBeCloseTo(45, 0);
        expect(b).toBeCloseTo(67, 0);
      }
    }
  });
});
