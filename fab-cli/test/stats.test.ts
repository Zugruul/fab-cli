import { describe, it, expect } from "vitest";
import { computeDeckStats, computeResultStats } from "../src/stats";
import type { DeckCard, CardData } from "../src/graphql";
import type { GameResult } from "../src/types";

function cardData(overrides: Partial<CardData> = {}): CardData {
  return {
    types: ["Action"],
    subtypes: [],
    pitch: null,
    cost: null,
    power: null,
    defense: null,
    keywords: [],
    talents: [],
    classes: [],
    rarity: "Common",
    ...overrides,
  };
}

function deckCard(
  cardIdentifier: string,
  quantity: number,
  data: Partial<CardData> | null,
): DeckCard {
  return {
    cardIdentifier,
    quantity,
    sideboardQuantity: 0,
    maybeQuantity: 0,
    matchupQuantities: null,
    cardData: data === null ? null : cardData(data),
  };
}

describe("computeDeckStats", () => {
  it("returns all-zero stats for an empty deck", () => {
    const stats = computeDeckStats([]);
    expect(stats.mainDeckTotal).toBe(0);
    expect(stats.pitch).toEqual({
      red: 0,
      yellow: 0,
      blue: 0,
      none: 0,
      total: 0,
      redPct: 0,
      yellowPct: 0,
      bluePct: 0,
      nonePct: 0,
      avgPitch: 0,
    });
    expect(stats.avgCost).toBe(0);
    expect(stats.avgPower).toBe(0);
    expect(stats.avgDefense).toBe(0);
    expect(stats.costDist.size).toBe(0);
    expect(stats.handDraw.probAtLeastOneBlue).toBe(0);
  });

  it("computes pitch distribution, averages, and card-action counts for a realistic main deck", () => {
    // Realistic mini deck (17 cards): 6 red attacks, 6 yellow attacks, 3 blue attacks, 2 equipment (no pitch)
    const mainCards: DeckCard[] = [
      deckCard("red-attack-a", 3, {
        types: ["Action", "Attack"],
        pitch: 1,
        cost: 1,
        power: 3,
        defense: 2,
      }),
      deckCard("red-attack-b", 3, {
        types: ["Action", "Attack"],
        pitch: 1,
        cost: 2,
        power: 4,
        defense: 2,
      }),
      deckCard("yellow-attack-a", 3, {
        types: ["Action", "Attack"],
        pitch: 2,
        cost: 2,
        power: 5,
        defense: 3,
      }),
      deckCard("yellow-attack-b", 3, {
        types: ["Action", "Attack"],
        pitch: 2,
        cost: 3,
        power: 6,
        defense: 3,
      }),
      deckCard("blue-attack", 3, {
        types: ["Action", "Attack"],
        pitch: 3,
        cost: 3,
        power: 7,
        defense: 3,
        keywords: ["Go again"],
      }),
      deckCard("equipment-head", 1, {
        types: ["Equipment"],
        subtypes: ["Head"],
        pitch: null,
        cost: null,
        power: null,
        defense: 1,
      }),
      deckCard("equipment-chest", 1, {
        types: ["Equipment"],
        subtypes: ["Chest"],
        pitch: null,
        cost: null,
        power: null,
        defense: 2,
      }),
    ];

    const stats = computeDeckStats(mainCards);

    expect(stats.mainDeckTotal).toBe(17);
    expect(stats.pitch.red).toBe(6);
    expect(stats.pitch.yellow).toBe(6);
    expect(stats.pitch.blue).toBe(3);
    expect(stats.pitch.none).toBe(2);
    expect(stats.pitch.total).toBe(17);
    expect(stats.pitch.redPct).toBeCloseTo(6 / 17);
    expect(stats.pitch.yellowPct).toBeCloseTo(6 / 17);
    expect(stats.pitch.bluePct).toBeCloseTo(3 / 17);
    expect(stats.pitch.nonePct).toBeCloseTo(2 / 17);
    // avgPitch is over the 15 pitchable copies only (1*6 + 2*6 + 3*3)/15
    expect(stats.pitch.avgPitch).toBeCloseTo((1 * 6 + 2 * 6 + 3 * 3) / 15);

    // cost/power/defense averages only count cards where the stat is defined
    // costs defined for all 15 attack copies (equipment has cost: null)
    const expectedAvgCost = (1 * 3 + 2 * 3 + 2 * 3 + 3 * 3 + 3 * 3) / 15;
    expect(stats.avgCost).toBeCloseTo(expectedAvgCost);
    // defense defined for all 17 copies (attacks + equipment)
    const expectedAvgDefense =
      (2 * 3 + 2 * 3 + 3 * 3 + 3 * 3 + 3 * 3 + 1 * 1 + 2 * 1) / 17;
    expect(stats.avgDefense).toBeCloseTo(expectedAvgDefense);

    // card actions
    expect(stats.cardActions.canPitch).toBe(15); // only the pitchable attacks
    expect(stats.cardActions.canPlay).toBe(15); // cost defined only on attacks
    expect(stats.cardActions.canBlock).toBe(17); // defense defined on everything
    expect(stats.cardActions.canAttack).toBe(15); // power defined only on attacks
    expect(stats.cardActions.canPitchPct).toBeCloseTo(15 / 17);

    // type/subtype/talent/keyword distributions
    expect(stats.typeDist.get("Action")).toBe(15);
    expect(stats.typeDist.get("Equipment")).toBe(2);
    expect(stats.subtypeDist.get("Head")).toBe(1);
    expect(stats.keywordCounts.get("Go again")).toBe(3);

    // hand-draw probabilities: probAtLeastOneBlue over 17 cards, 3 blue, drawing 4
    expect(stats.handDraw.probAtLeastOneBlue).toBeGreaterThan(0);
    expect(stats.handDraw.probAtLeastOneBlue).toBeLessThan(1);
    // Go again count of 3 in a 17-card deck drawing 4 — same shape as blue
    expect(stats.handDraw.probAtLeastOneGoAgain).toBeCloseTo(
      stats.handDraw.probAtLeastOneBlue,
    );
    expect(stats.handDraw.expectedResources).toBeCloseTo(
      stats.pitch.avgPitch * 4,
    );
  });

  it("treats a card with null cardData as having no cost/pitch/power/defense (all fall into 'none' bucket)", () => {
    const mainCards: DeckCard[] = [deckCard("unknown-card", 2, null)];
    const stats = computeDeckStats(mainCards);
    expect(stats.mainDeckTotal).toBe(2);
    expect(stats.pitch.none).toBe(2);
    expect(stats.cardActions.canPlay).toBe(0);
    expect(stats.cardActions.canPitch).toBe(0);
    expect(stats.cardActions.canBlock).toBe(0);
    expect(stats.cardActions.canAttack).toBe(0);
    expect(stats.typeDist.size).toBe(0);
  });

  it("guarantees every card in the deck has 100% probability when it fills the whole deck (probAtLeastOne edge)", () => {
    // 4 identical blue cards is a degenerate deck, but exercises K >= N-ish boundary logic
    const mainCards: DeckCard[] = [
      deckCard("all-blue", 4, { pitch: 3, cost: 1, power: 1, defense: 1 }),
    ];
    const stats = computeDeckStats(mainCards);
    expect(stats.handDraw.probAtLeastOneBlue).toBe(1); // K (4) >= N (4)
    expect(stats.handDraw.probAtLeastOneRed).toBe(0); // K = 0
  });
});

function game(overrides: Partial<GameResult> = {}): GameResult {
  return {
    result: "Won",
    source: "FaBrary",
    notes: null,
    deckId: "deck-1",
    gameId: null,
    turns: null,
    firstPlayer: null,
    cardResults: null,
    ...overrides,
  };
}

describe("computeResultStats", () => {
  it("returns zeroed stats and a null summary for an empty result set", () => {
    const stats = computeResultStats([]);
    expect(stats).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      total: 0,
      winRate: 0,
      bySource: new Map(),
      summary: null,
    });
  });

  it("computes win rate, draws are counted but excluded from the winRate denominator implicitly via total", () => {
    const results = [
      game({ result: "Won" }),
      game({ result: "Won" }),
      game({ result: "Lost" }),
      game({ result: "Draw" }),
    ];
    const stats = computeResultStats(results);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.draws).toBe(1);
    expect(stats.total).toBe(4); // total includes draws (differs from computeWinRate in graphql.ts)
    expect(stats.winRate).toBeCloseTo(2 / 4);
  });

  it("groups by source, treating a null/missing source as 'Unknown'", () => {
    const results = [
      game({ result: "Won", source: "FaBrary" }),
      game({ result: "Lost", source: "FaBrary" }),
      game({ result: "Won", source: "Talishar" }),
      game({ result: "Won", source: null }),
    ];
    const stats = computeResultStats(results);
    expect(stats.bySource.get("FaBrary")).toEqual({
      wins: 1,
      losses: 1,
      total: 2,
      winRate: 0.5,
    });
    expect(stats.bySource.get("Talishar")).toEqual({
      wins: 1,
      losses: 0,
      total: 1,
      winRate: 1,
    });
    expect(stats.bySource.get("Unknown")).toEqual({
      wins: 1,
      losses: 0,
      total: 1,
      winRate: 1,
    });
  });

  it("returns a null summary when no game carries per-game data (firstPlayer/turns/cardResults all absent)", () => {
    const results = [game({ result: "Won" }), game({ result: "Lost" })];
    const stats = computeResultStats(results);
    expect(stats.summary).toBeNull();
  });

  it("computes going-first/second win rates, avg turns, and per-card usage when per-game data is present", () => {
    const results: GameResult[] = [
      game({
        result: "Won",
        firstPlayer: true,
        turns: 8,
        cardResults: [
          { cardIdentifier: "sword", blocked: 0, pitched: 1, played: 2 },
          { cardIdentifier: "shield", blocked: 3, pitched: 0, played: 0 },
        ],
      }),
      game({
        result: "Lost",
        firstPlayer: true,
        turns: 10,
        cardResults: [
          { cardIdentifier: "sword", blocked: 0, pitched: 0, played: 1 },
        ],
      }),
      game({
        result: "Won",
        firstPlayer: false,
        turns: 6,
        cardResults: [
          { cardIdentifier: "shield", blocked: 1, pitched: 0, played: 0 },
        ],
      }),
      game({ result: "Draw", firstPlayer: false, turns: 12, cardResults: [] }),
    ];
    const stats = computeResultStats(results);
    expect(stats.summary).not.toBeNull();
    const summary = stats.summary!;

    expect(summary.goingFirstTotal).toBe(2);
    expect(summary.goingFirstWins).toBe(1);
    expect(summary.goingFirstWinRate).toBeCloseTo(0.5);
    expect(summary.goingSecondTotal).toBe(2);
    expect(summary.goingSecondWins).toBe(1);
    expect(summary.goingSecondWinRate).toBeCloseTo(0.5);

    expect(summary.avgTurns).toBeCloseTo((8 + 10 + 6 + 12) / 4);
    expect(summary.avgTurnsWins).toBeCloseTo((8 + 6) / 2);
    expect(summary.avgTurnsLosses).toBeCloseTo(10);

    const sword = summary.cardUsage.find((c) => c.cardIdentifier === "sword")!;
    expect(sword.pitched).toBe(1);
    expect(sword.played).toBe(3);
    expect(sword.blocked).toBe(0);
    expect(sword.seen).toBe(4);

    const shield = summary.cardUsage.find(
      (c) => c.cardIdentifier === "shield",
    )!;
    expect(shield.blocked).toBe(4);
    expect(shield.seen).toBe(4);

    // sorted by seen desc, ties broken by original insertion (both are 4 here)
    expect(summary.cardUsage[0].seen).toBeGreaterThanOrEqual(
      summary.cardUsage[1].seen,
    );
  });

  it("treats a draw with no firstPlayer/turns/cardResults as not contributing per-game data on its own, but still counts toward wins/losses if other games do", () => {
    const results: GameResult[] = [
      game({ result: "Won", firstPlayer: true, turns: 5, cardResults: [] }),
      game({ result: "Draw" }), // no per-game data on this one
    ];
    const stats = computeResultStats(results);
    expect(stats.draws).toBe(1);
    expect(stats.summary).not.toBeNull();
    expect(stats.summary!.goingFirstTotal).toBe(1);
    expect(stats.summary!.avgTurns).toBeCloseTo(5); // the draw's null turns doesn't pollute the average
  });
});
