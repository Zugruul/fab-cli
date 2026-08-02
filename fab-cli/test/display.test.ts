import { describe, it, expect, vi, afterEach } from "vitest";
import { printCardDetail } from "../src/display";
import type { FabCard } from "../src/types";

function baseCard(overrides: Partial<FabCard> = {}): FabCard {
  return {
    cardIdentifier: "test-card",
    name: "Test Card",
    defaultImage: "",
    specialImage: null,
    hero: null,
    isCardBack: null,
    keywords: null,
    pitch: null,
    cost: null,
    defense: null,
    power: null,
    talents: null,
    classes: null,
    fusions: null,
    rarity: "Common",
    restrictedFormats: null,
    setIdentifiers: [],
    specializations: null,
    subtypes: [],
    types: ["Equipment"],
    young: null,
    artists: [],
    printings: [],
    matchingPrintings: [],
    oppositeSideCard: null,
    ...overrides,
  };
}

describe("printCardDetail — pitch rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression test: pitch === 0 (equipment / no-pitch cards) previously
  // threw `TypeError: fn is not a function`. The old code used
  // `["", chalk.red, chalk.yellow, chalk.blue]` for pitchColors, so index 0
  // resolved to the empty string "" (not undefined), which meant the
  // `?? chalk.white` fallback never kicked in and `fn` ended up being a
  // string instead of a callable chalk function.
  it("does not throw for a card with pitch 0 (e.g. equipment)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const card = baseCard({ pitch: 0 });

    expect(() => printCardDetail(card)).not.toThrow();

    const pitchLine = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes("Pitch:"));
    expect(pitchLine).toBeDefined();
    expect(pitchLine).toContain("0");
  });

  it("still renders correctly for red/yellow/blue pitch values", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const pitch of [1, 2, 3]) {
      const card = baseCard({ pitch });
      expect(() => printCardDetail(card)).not.toThrow();
    }
    const pitchLines = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("Pitch:"));
    expect(pitchLines).toHaveLength(3);
  });
});
