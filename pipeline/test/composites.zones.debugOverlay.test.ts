import { describe, it, expect } from "vitest";
import { renderZoneOverlay } from "../src/composites/zones/debugOverlay.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { ZoneMap } from "../src/composites/zones/zoneMap.js";

// #253: "verify your rects by rendering a debug overlay and EYEBALLING it
// yourself" — this is the pure pixel-drawing piece behind that check image,
// unit tested so the overlay itself isn't just trusted by eye.

function solidCanvas(width: number, height: number, color: [number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function pixelAt(img: RawImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

describe("renderZoneOverlay", () => {
  it("draws a colored border at the zone's rect boundary and leaves the interior untouched", () => {
    const canvas = solidCanvas(20, 20, [10, 10, 10]);
    const zoneMap: ZoneMap = { name: "t", zones: [{ id: "head", kind: "head", rect: { xFrac: 0.2, yFrac: 0.2, wFrac: 0.3, hFrac: 0.3 } }] };
    const overlaid = renderZoneOverlay(canvas, zoneMap, 1);

    // zone pixel rect: x0=4,y0=4,w=6,h=6 (x in [4,9], y in [4,9])
    const border = pixelAt(overlaid, 4, 7);
    expect(border[0]).not.toBe(10); // colored, not the original background
    expect(border[3]).toBe(255);

    // well inside the zone (not on the 1px stroke)
    const interior = pixelAt(overlaid, 7, 7);
    expect(interior).toEqual([10, 10, 10, 255]);

    // well outside the zone entirely
    const outside = pixelAt(overlaid, 0, 0);
    expect(outside).toEqual([10, 10, 10, 255]);
  });

  it("does not crash when a zone rect extends past the canvas edge", () => {
    const canvas = solidCanvas(10, 10, [5, 5, 5]);
    const zoneMap: ZoneMap = { name: "t", zones: [{ id: "edge", kind: "head", rect: { xFrac: 0.9, yFrac: 0.9, wFrac: 0.3, hFrac: 0.3 } }] };
    expect(() => renderZoneOverlay(canvas, zoneMap, 2)).not.toThrow();
  });

  it("draws every zone in a multi-zone map with distinguishable colors", () => {
    const canvas = solidCanvas(40, 20, [0, 0, 0]);
    const zoneMap: ZoneMap = {
      name: "t",
      zones: [
        { id: "a", kind: "head", rect: { xFrac: 0.0, yFrac: 0.0, wFrac: 0.2, hFrac: 0.5 } },
        { id: "b", kind: "chest", rect: { xFrac: 0.5, yFrac: 0.0, wFrac: 0.2, hFrac: 0.5 } },
      ],
    };
    const overlaid = renderZoneOverlay(canvas, zoneMap, 1);
    const borderA = pixelAt(overlaid, 0, 5);
    const borderB = pixelAt(overlaid, 20, 5);
    expect(borderA.slice(0, 3)).not.toEqual([0, 0, 0]);
    expect(borderB.slice(0, 3)).not.toEqual([0, 0, 0]);
  });
});
