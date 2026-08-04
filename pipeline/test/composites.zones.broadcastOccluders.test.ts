import { describe, it, expect } from "vitest";
import { createStackShimImage, createDiceImage, createHandImage } from "../src/composites/zones/broadcastOccluders.js";

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
