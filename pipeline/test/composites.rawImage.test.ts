import { describe, it, expect } from "vitest";
import {
  createSolidImage,
  bilinearSample,
  compositeOver,
  applyBrightnessContrast,
  applySleeve,
  applyGlare,
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
