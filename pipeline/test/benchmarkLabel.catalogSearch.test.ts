import { describe, it, expect } from "vitest";
import { extractCatalogPrintings, resolvePrinting, resolveCandidates, searchByName } from "../src/benchmark-label/catalogSearch.js";
import type { RawCatalogCard } from "../src/benchmark-label/catalogSearch.js";

// Fixture shaped exactly like the real, verified live example from
// fab-cli/third_party/flesh-and-blood-cards/json/english/card.json:
// HER155 (Groundbreaker Crix) resolves to TWO printings with identical
// set/rarity/foiling/art_variations and different unique_ids (front/back
// image variants of the same promo). This is the case #258's brief calls
// out as a merge blocker if silently auto-picked.
const HER155_CARDS: RawCatalogCard[] = [
  {
    name: "Groundbreaker Crix",
    printings: [
      {
        unique_id: "NfgpFKBWBtrdbLGMmQQbh",
        id: "HER155",
        set_id: "HER",
        edition: "N",
        foiling: "C",
        rarity: "P",
        art_variations: ["FA"],
        image_url: "https://example.com/HER155-MV.webp",
      },
      {
        unique_id: "GFPgDWrmnhCdBtTWhfzMK",
        id: "HER155",
        set_id: "HER",
        edition: "N",
        foiling: "C",
        rarity: "P",
        art_variations: ["FA"],
        image_url: "https://example.com/HER155-MV_BACK.webp",
      },
    ],
  },
];

// Fixture shaped like the real ARC000 case: two editions of the same
// print code, disambiguated by an edition marker.
const ARC000_CARDS: RawCatalogCard[] = [
  {
    name: "Eye of Ophidia",
    printings: [
      {
        unique_id: "JmtWDDGWhTCR9B9KKK8kz",
        id: "ARC000",
        set_id: "ARC",
        edition: "F",
        foiling: "C",
        rarity: "F",
        art_variations: [],
        image_url: "https://example.com/ARC000.png",
      },
      {
        unique_id: "LFK7TmwkKLMQPLHfkLdmM",
        id: "ARC000",
        set_id: "ARC",
        edition: "U",
        foiling: "R",
        rarity: "F",
        art_variations: [],
        image_url: "https://example.com/U-ARC000.png",
      },
    ],
  },
];

const SIMPLE_CARDS: RawCatalogCard[] = [
  {
    name: "Command and Conquer",
    printings: [
      {
        unique_id: "p1",
        id: "MST001",
        set_id: "MST",
        edition: "N",
        foiling: "S",
        rarity: "M",
        art_variations: [],
        image_url: "https://example.com/MST001.png",
      },
    ],
  },
];

describe("extractCatalogPrintings", () => {
  it("extracts one entry per printing with printingId = unique_id", () => {
    const entries = extractCatalogPrintings(SIMPLE_CARDS);
    expect(entries).toEqual([
      {
        printingId: "p1",
        printCode: "MST001",
        cardName: "Command and Conquer",
        setId: "MST",
        edition: "N",
        foiling: "S",
        rarity: "M",
        artVariations: [],
        imageUrl: "https://example.com/MST001.png",
      },
    ]);
  });

  it("skips a printing with no image_url or unique_id, same discipline as images/catalog.ts", () => {
    const cards: RawCatalogCard[] = [{ name: "X", printings: [{ id: "X001", set_id: "SET" }] }];
    expect(extractCatalogPrintings(cards)).toEqual([]);
  });
});

describe("searchByName", () => {
  it("matches case-insensitively on a substring", () => {
    const entries = extractCatalogPrintings(SIMPLE_CARDS);
    expect(searchByName(entries, "conquer")).toHaveLength(1);
    expect(searchByName(entries, "COMMAND")).toHaveLength(1);
    expect(searchByName(entries, "nope")).toHaveLength(0);
  });
});

describe("resolvePrinting — never auto-picks an ambiguous printing", () => {
  it("HER155 (Groundbreaker Crix): two identical-metadata printings surface as ambiguous, not a silent first match", () => {
    const entries = extractCatalogPrintings(HER155_CARDS);
    const result = resolvePrinting(entries, { printCode: "HER155", edition: null });

    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") throw new Error("expected ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.printingId).sort()).toEqual(
      ["GFPgDWrmnhCdBtTWhfzMK", "NfgpFKBWBtrdbLGMmQQbh"].sort(),
    );
  });

  it("ARC000: an edition hint from the filename (-U) narrows two candidates to a unique resolution", () => {
    const entries = extractCatalogPrintings(ARC000_CARDS);
    const ambiguous = resolvePrinting(entries, { printCode: "ARC000", edition: null });
    expect(ambiguous.status).toBe("ambiguous");

    const resolved = resolvePrinting(entries, { printCode: "ARC000", edition: "U" });
    expect(resolved.status).toBe("unique");
    if (resolved.status !== "unique") throw new Error("expected unique");
    expect(resolved.printing.printingId).toBe("LFK7TmwkKLMQPLHfkLdmM");
  });

  it("a print code with exactly one printing resolves uniquely", () => {
    const entries = extractCatalogPrintings(SIMPLE_CARDS);
    const result = resolvePrinting(entries, { printCode: "MST001", edition: null });
    expect(result.status).toBe("unique");
    if (result.status !== "unique") throw new Error("expected unique");
    expect(result.printing.printingId).toBe("p1");
  });

  it("an unknown print code resolves to not-found (never a guessed candidate)", () => {
    const entries = extractCatalogPrintings(SIMPLE_CARDS);
    const result = resolvePrinting(entries, { printCode: "ZZZ999", edition: null });
    expect(result.status).toBe("not-found");
  });

  it("no print code at all (name-only hint) is always ambiguous or not-found, never unique — the picker must always be shown", () => {
    const entries = extractCatalogPrintings(HER155_CARDS);
    const result = resolvePrinting(entries, { printCode: null, edition: null });
    expect(result.status).not.toBe("unique");
  });
});

describe("resolveCandidates — combined code+name resolution used by the server", () => {
  it("prefers an exact code match when it resolves uniquely, ignoring an irrelevant name query", () => {
    const entries = extractCatalogPrintings(SIMPLE_CARDS);
    const result = resolveCandidates(entries, { printCode: "MST001", edition: null, nameQuery: "something else entirely" });
    expect(result.status).toBe("unique");
  });

  it("an ambiguous code match stays ambiguous — never silently widened into a broader name search", () => {
    const entries = extractCatalogPrintings(HER155_CARDS);
    const result = resolveCandidates(entries, { printCode: "HER155", edition: null, nameQuery: "groundbreaker crix" });
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") throw new Error("expected ambiguous");
    expect(result.candidates).toHaveLength(2);
  });

  it("falls back to a name search when the code doesn't resolve at all", () => {
    const entries = extractCatalogPrintings(SIMPLE_CARDS);
    const result = resolveCandidates(entries, { printCode: "ZZZ999", edition: null, nameQuery: "command and conquer" });
    expect(result.status).toBe("unique");
    if (result.status !== "unique") throw new Error("expected unique");
    expect(result.printing.printingId).toBe("p1");
  });

  it("no code and no name query resolves to not-found rather than guessing", () => {
    const entries = extractCatalogPrintings(SIMPLE_CARDS);
    const result = resolveCandidates(entries, { printCode: null, edition: null, nameQuery: null });
    expect(result.status).toBe("not-found");
  });
});
