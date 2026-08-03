import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { extractPrintingImageRefs, loadCardsFromFile } from "../src/images/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "images");

describe("extractPrintingImageRefs", () => {
  it("extracts one ref per printing, keyed on the printing's own unique_id", () => {
    const cards = [
      {
        name: "Command and Conquer",
        printings: [
          { unique_id: "p1", id: "MST001", set_id: "MST", image_url: "https://example.com/MST001.png" },
          { unique_id: "p2", id: "MST001", set_id: "MST", image_url: "https://example.com/MST001-foil.png" },
        ],
      },
    ];
    const refs = extractPrintingImageRefs(cards);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.printingId)).toEqual(["p1", "p2"]);
    expect(refs[0]).toEqual({
      printingId: "p1",
      printCode: "MST001",
      cardName: "Command and Conquer",
      setId: "MST",
      imageUrl: "https://example.com/MST001.png",
    });
  });

  it("skips a printing with no image_url instead of fabricating one", () => {
    const cards = [{ name: "X", printings: [{ unique_id: "p1", id: "X001", set_id: "SET" }] }];
    expect(extractPrintingImageRefs(cards)).toEqual([]);
  });

  it("skips a printing missing unique_id (can't be safely cache-keyed)", () => {
    const cards = [
      { name: "X", printings: [{ id: "X001", set_id: "SET", image_url: "https://example.com/x.png" }] },
    ];
    expect(extractPrintingImageRefs(cards)).toEqual([]);
  });

  it("does not conflate two different card names that happen to share the same human-readable print code", () => {
    // Mirrors a real the-fab-cube case: dual-faced/fusion entries share the
    // set+number `id` (e.g. "ENG025" for both "Inner Chi" and "A Drop in the
    // Ocean") but are different cards with different unique_id/images —
    // `id` alone is NOT a safe per-image key.
    const cards = [
      {
        name: "Inner Chi",
        printings: [{ unique_id: "front", id: "ENG025", set_id: "MST", image_url: "https://example.com/ENG025.png" }],
      },
      {
        name: "A Drop in the Ocean",
        printings: [
          { unique_id: "back", id: "ENG025", set_id: "MST", image_url: "https://example.com/ENG025_BACK.png" },
        ],
      },
    ];
    const refs = extractPrintingImageRefs(cards);
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((r) => r.printingId)).size).toBe(2);
  });

  it("sorts by printingId for deterministic --limit behavior", () => {
    const cards = [
      {
        name: "X",
        printings: [
          { unique_id: "zzz", id: "A", set_id: "S", image_url: "https://e/a.png" },
          { unique_id: "aaa", id: "B", set_id: "S", image_url: "https://e/b.png" },
        ],
      },
    ];
    expect(extractPrintingImageRefs(cards).map((r) => r.printingId)).toEqual(["aaa", "zzz"]);
  });

  it("skips a printing whose image_url is an empty string", () => {
    const cards = [{ name: "X", printings: [{ unique_id: "p1", id: "X001", set_id: "SET", image_url: "" }] }];
    expect(extractPrintingImageRefs(cards)).toEqual([]);
  });

  it("tolerates a card with no printings array at all", () => {
    const cards = [{ name: "X" }];
    expect(extractPrintingImageRefs(cards)).toEqual([]);
  });
});

describe("loadCardsFromFile", () => {
  it("reads and parses a vendored-shaped card.json fixture", () => {
    const cards = loadCardsFromFile(path.join(FIXTURES, "tiny-card.json"));
    const refs = extractPrintingImageRefs(cards);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((r) => typeof r.printingId === "string" && r.printingId.length > 0)).toBe(true);
  });
});

// Sanity check that the fixture file actually exists and is readable JSON,
// so a future edit to it can't silently break the test above without a
// clear signal of why.
describe("fixture sanity", () => {
  it("tiny-card.json fixture parses as an array", () => {
    const raw = fs.readFileSync(path.join(FIXTURES, "tiny-card.json"), "utf8");
    expect(Array.isArray(JSON.parse(raw))).toBe(true);
  });
});
