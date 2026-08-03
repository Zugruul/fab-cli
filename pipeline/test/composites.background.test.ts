import { describe, it, expect } from "vitest";
import { generateBackgroundRaw } from "../src/composites/background.js";
import type { BackgroundParams } from "../src/composites/background.js";

function pixel(img: { width: number; data: Uint8ClampedArray }, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function params(overrides: Partial<BackgroundParams> = {}): BackgroundParams {
  return { type: "solid", colorA: [10, 20, 30], colorB: [200, 100, 50], angleDeg: 0, noiseSeed: 0, ...overrides };
}

describe("generateBackgroundRaw — solid", () => {
  it("fills every pixel with colorA, fully opaque", () => {
    const img = generateBackgroundRaw(3, 2, params({ type: "solid" }));
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        expect(pixel(img, x, y)).toEqual([10, 20, 30, 255]);
      }
    }
  });
});

describe("generateBackgroundRaw — gradient", () => {
  it("interpolates colorA -> colorB along a horizontal (angleDeg=0) direction (hand-computed)", () => {
    const img = generateBackgroundRaw(4, 1, params({ type: "gradient", colorA: [0, 0, 0], colorB: [200, 100, 60], angleDeg: 0 }));
    expect(pixel(img, 0, 0)).toEqual([0, 0, 0, 255]);
    // x=3 of width 4 -> t = 3/4 = 0.75 -> r=0.75*200=150, g=0.75*100=75, b=0.75*60=45
    const [r, g, b] = pixel(img, 3, 0);
    expect(r).toBeCloseTo(150, 0);
    expect(g).toBeCloseTo(75, 0);
    expect(b).toBeCloseTo(45, 0);
  });

  it("is monotonic along the gradient axis", () => {
    const img = generateBackgroundRaw(10, 1, params({ type: "gradient", colorA: [0, 0, 0], colorB: [255, 255, 255], angleDeg: 0 }));
    let last = -1;
    for (let x = 0; x < 10; x++) {
      const [r] = pixel(img, x, 0);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe("generateBackgroundRaw — noise", () => {
  it("is deterministic: same size + params produce byte-identical output", () => {
    const a = generateBackgroundRaw(16, 16, params({ type: "noise", noiseSeed: 42 }));
    const b = generateBackgroundRaw(16, 16, params({ type: "noise", noiseSeed: 42 }));
    expect(a.data).toEqual(b.data);
  });

  it("a different noiseSeed produces a different image", () => {
    const a = generateBackgroundRaw(16, 16, params({ type: "noise", noiseSeed: 1 }));
    const b = generateBackgroundRaw(16, 16, params({ type: "noise", noiseSeed: 2 }));
    expect(a.data).not.toEqual(b.data);
  });

  it("stays fully opaque and within [colorA, colorB]-blended bounds per channel", () => {
    const img = generateBackgroundRaw(8, 8, params({ type: "noise", colorA: [0, 0, 0], colorB: [100, 100, 100], noiseSeed: 7 }));
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBeGreaterThanOrEqual(0);
      expect(img.data[i]).toBeLessThanOrEqual(100);
      expect(img.data[i + 3]).toBe(255);
    }
  });
});

describe("generateBackgroundRaw — texture", () => {
  it("produces a deterministic checkerboard whose tile size derives from noiseSeed (hand-computed for noiseSeed=0 -> tileSize=8)", () => {
    const img = generateBackgroundRaw(24, 8, params({ type: "texture", colorA: [0, 0, 0], colorB: [255, 255, 255], noiseSeed: 0 }));
    expect(pixel(img, 0, 0)[0]).toBe(0); // tile (0,0) -> colorA
    expect(pixel(img, 8, 0)[0]).toBe(255); // tile (1,0) -> colorB
    expect(pixel(img, 16, 0)[0]).toBe(0); // tile (2,0) -> colorA
  });

  it("is deterministic given the same params", () => {
    const a = generateBackgroundRaw(20, 20, params({ type: "texture", noiseSeed: 5 }));
    const b = generateBackgroundRaw(20, 20, params({ type: "texture", noiseSeed: 5 }));
    expect(a.data).toEqual(b.data);
  });
});
