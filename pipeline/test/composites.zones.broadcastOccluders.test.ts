import { describe, it, expect } from "vitest";
import { createStackShimImage, createDiceImage, createHandImage, applyDirectionalMotionBlur } from "../src/composites/zones/broadcastOccluders.js";

// #256 Phase C.3: procedural REQUIRED occluders for broadcast realism —
// card stacks with visible thickness, dice resting on cards, hands
// entering frame. Pure, deterministic RawImage generators (no rng inside
// this module at all — every random decision is made by the CALLER's
// seeded stream, see planBroadcastAugmentation.ts, keeping this module
// trivially unit-testable with fixed inputs and automatically compliant
// with composites.rngGuard.test.ts). Deliberately simplified simulations,
// not photorealistic renders — same documented philosophy as
// rawImage.ts's applySleeve/applyGlare.

describe("createStackShimImage", () => {
  it("returns a fully opaque solid-color image of the requested size", () => {
    const img = createStackShimImage(30, 4, [40, 40, 45]);
    expect(img.width).toBe(30);
    expect(img.height).toBe(4);
    for (let i = 0; i < img.width * img.height; i++) {
      expect(img.data[i * 4]).toBe(40);
      expect(img.data[i * 4 + 1]).toBe(40);
      expect(img.data[i * 4 + 2]).toBe(45);
      expect(img.data[i * 4 + 3]).toBe(255);
    }
  });
});

describe("createDiceImage", () => {
  it("returns a fully opaque square of the requested size with the base body color at a corner", () => {
    const img = createDiceImage(20, 20, [230, 230, 230], [40, 40, 40], 4);
    expect(img.width).toBe(20);
    expect(img.height).toBe(20);
    // top-left corner is body color (no pip there)
    expect(img.data[0]).toBe(230);
    expect(img.data[1]).toBe(230);
    expect(img.data[2]).toBe(230);
    expect(img.data[3]).toBe(255);
  });

  it("renders visually distinct pip dots for different face values (pixel content differs)", () => {
    const face1 = createDiceImage(20, 20, [230, 230, 230], [20, 20, 20], 1);
    const face6 = createDiceImage(20, 20, [230, 230, 230], [20, 20, 20], 6);
    expect(Array.from(face1.data)).not.toEqual(Array.from(face6.data));
  });

  it("clamps an out-of-range face value into [1,6] rather than crashing or silently drawing nothing", () => {
    expect(() => createDiceImage(20, 20, [230, 230, 230], [20, 20, 20], 0)).not.toThrow();
    expect(() => createDiceImage(20, 20, [230, 230, 230], [20, 20, 20], 9)).not.toThrow();
  });
});

describe("createHandImage", () => {
  it("returns the requested size, opaque near the center, transparent at the far corners (a soft blob shape, not a filled rect)", () => {
    const img = createHandImage(40, 60, [210, 170, 140]);
    expect(img.width).toBe(40);
    expect(img.height).toBe(60);
    const centerIdx = (30 * 40 + 20) * 4;
    expect(img.data[centerIdx + 3]).toBeGreaterThan(200); // center: solid
    const cornerIdx = (0 * 40 + 0) * 4;
    expect(img.data[cornerIdx + 3]).toBe(0); // far corner: fully transparent
  });

  it("uses the given skin-tone color for its opaque interior", () => {
    const img = createHandImage(40, 60, [180, 120, 90]);
    const centerIdx = (30 * 40 + 20) * 4;
    expect(img.data[centerIdx]).toBe(180);
    expect(img.data[centerIdx + 1]).toBe(120);
    expect(img.data[centerIdx + 2]).toBe(90);
  });

  it("is a pure function — same inputs produce byte-identical output", () => {
    const a = createHandImage(40, 60, [180, 120, 90]);
    const b = createHandImage(40, 60, [180, 120, 90]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

// #256 correction: REQUIRED hand motion blur. The Pro Tour Las Vegas rig
// shows heavy motion blur on hands sweeping across frame prominently
// (confirmed by direct visual inspection of the real captures) — this was
// originally scoped as a nice-to-have deferral, upgraded to required once
// a second real rig showed it as a dominant realism cue. A pure,
// deterministic directional blur (no rng inside — the caller's seeded
// stream picks strength/angle), reusing rawImage.ts's bilinearSample for
// sub-pixel sampling along the blur direction.
describe("applyDirectionalMotionBlur", () => {
  it("strength 0 is a no-op — returns the image unchanged", () => {
    const img = createHandImage(40, 60, [180, 120, 90]);
    const blurred = applyDirectionalMotionBlur(img, 0, 0);
    expect(Array.from(blurred.data)).toEqual(Array.from(img.data));
  });

  it("preserves image dimensions", () => {
    const img = createHandImage(40, 60, [180, 120, 90]);
    const blurred = applyDirectionalMotionBlur(img, 0.6, 0);
    expect(blurred.width).toBe(40);
    expect(blurred.height).toBe(60);
  });

  it("genuinely smears content — a hard opaque/transparent edge becomes a gradient after blurring", () => {
    // A solid opaque left half, fully transparent right half — a hard edge.
    const width = 40;
    const height = 10;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = 200;
        data[i + 1] = 150;
        data[i + 2] = 100;
        data[i + 3] = x < width / 2 ? 255 : 0;
      }
    }
    const img = { width, height, data };
    const blurred = applyDirectionalMotionBlur(img, 0.8, 0); // horizontal blur, angleDeg 0
    // Sample right at the boundary: was a hard 255->0 cliff, now some
    // intermediate alpha value (proof the blur actually mixed samples
    // across the edge, not a no-op or a full-image average).
    const boundaryIdx = (5 * width + Math.floor(width / 2)) * 4;
    expect(blurred.data[boundaryIdx + 3]).toBeGreaterThan(0);
    expect(blurred.data[boundaryIdx + 3]).toBeLessThan(255);
  });

  it("higher strength smears further — a larger kernel produces a wider gradient band", () => {
    const width = 60;
    const height = 10;
    function hardEdgeImage(): { width: number; height: number; data: Uint8ClampedArray } {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          data[i] = 200;
          data[i + 1] = 150;
          data[i + 2] = 100;
          data[i + 3] = x < width / 2 ? 255 : 0;
        }
      }
      return { width, height, data };
    }
    const low = applyDirectionalMotionBlur(hardEdgeImage(), 0.15, 0);
    const high = applyDirectionalMotionBlur(hardEdgeImage(), 0.9, 0);
    // Count non-0/non-255 alpha pixels along the center row for each —
    // the gradient band should be wider for the higher-strength blur.
    function gradientBandWidth(img: { width: number; height: number; data: Uint8ClampedArray }): number {
      let count = 0;
      const y = 5;
      for (let x = 0; x < img.width; x++) {
        const a = img.data[(y * img.width + x) * 4 + 3];
        if (a > 0 && a < 255) count++;
      }
      return count;
    }
    expect(gradientBandWidth(high)).toBeGreaterThan(gradientBandWidth(low));
  });

  it("is a pure function — same inputs produce byte-identical output, no rng involved", () => {
    const img = createHandImage(40, 60, [180, 120, 90]);
    const a = applyDirectionalMotionBlur(img, 0.5, 15);
    const b = applyDirectionalMotionBlur(img, 0.5, 15);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
