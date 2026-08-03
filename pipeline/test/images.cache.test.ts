import { describe, it, expect } from "vitest";
import { extensionFromUrl, cachePathFor } from "../src/images/cache.js";
import type { PrintingImageRef } from "../src/images/types.js";

describe("extensionFromUrl", () => {
  it("extracts a lowercase extension from a plain URL", () => {
    expect(extensionFromUrl("https://example.com/cards/MST131.PNG")).toBe(".png");
  });

  it("strips a query string before extracting the extension", () => {
    expect(extensionFromUrl("https://example.com/cards/MST131.webp?v=2")).toBe(".webp");
  });

  it("returns an empty string when there's no extension", () => {
    expect(extensionFromUrl("https://example.com/cards/MST131")).toBe("");
  });
});

describe("cachePathFor", () => {
  it("maps a printing ref to <cacheDir>/<printingId><ext> — keyed on printingId, not the human-readable print code", () => {
    const ref: PrintingImageRef = {
      printingId: "q9B6nmKrdz8HnQnJMpQdc",
      printCode: "MST131",
      cardName: "X",
      setId: "MST",
      imageUrl: "https://x/MST131.png",
    };
    expect(cachePathFor("/tmp/cache", ref)).toBe("/tmp/cache/q9B6nmKrdz8HnQnJMpQdc.png");
  });

  it("still produces a distinct path for two printings that share a print code but have different unique_ids", () => {
    const base = { printCode: "MST001", cardName: "X", setId: "MST" };
    const a: PrintingImageRef = { ...base, printingId: "p1", imageUrl: "https://x/MST001.png" };
    const b: PrintingImageRef = { ...base, printingId: "p2", imageUrl: "https://x/MST001-foil.png" };
    expect(cachePathFor("/cache", a)).not.toBe(cachePathFor("/cache", b));
  });
});
