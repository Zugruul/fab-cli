import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPrepSheet } from "../src/prep";
import type { AlgoliaDeck } from "../src/types";

type Route = {
  match: (url: string, init?: RequestInit) => boolean;
  json: unknown;
};

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function installFetchRouter(routes: Route[]) {
  return vi
    .spyOn(global, "fetch")
    .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const route = routes.find((r) => r.match(u, init));
      if (!route) throw new Error(`Unmocked fetch: ${u} body=${init?.body}`);
      return jsonResponse(route.json);
    });
}

function deck(overrides: Partial<AlgoliaDeck> = {}): AlgoliaDeck {
  return {
    deckId: "deck-1",
    name: "Test Deck",
    author: "tester",
    hero: "Hero X",
    heroIdentifier: "hero-x",
    format: "Classic Constructed",
    cards: ["card-a"],
    hasMatchups: true,
    hasNotes: false,
    hasResults: true,
    hasYoutube: false,
    isPrecon: false,
    isTournament: false,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    objectID: "deck-1",
    ...overrides,
  };
}

function algoliaSearchRoute(hits: AlgoliaDeck[]): Route {
  return {
    match: (u: string) =>
      u.includes("4e2ysy5y4i-dsn.algolia.net") && u.includes("queries"),
    json: {
      results: [
        {
          hits,
          nbHits: hits.length,
          page: 0,
          nbPages: 1,
          hitsPerPage: 50,
          facets: {},
        },
      ],
    },
  };
}

function metaRoute(payload: unknown): Route {
  return {
    match: (u: string) => u.includes("content.fabrary.net"),
    json: payload,
  };
}

function getResultsRoute(deckId: string, wins: number, losses: number): Route {
  const results = [
    ...Array.from({ length: wins }, (_, i) => ({
      result: "Won",
      source: "FaBrary",
      notes: null,
      deckId,
      gameId: `w${i}`,
      turns: 8,
      firstPlayer: true,
      cardResults: [],
    })),
    ...Array.from({ length: losses }, (_, i) => ({
      result: "Lost",
      source: "FaBrary",
      notes: null,
      deckId,
      gameId: `l${i}`,
      turns: 8,
      firstPlayer: true,
      cardResults: [],
    })),
  ];
  return {
    match: (u: string, init?: RequestInit) => {
      if (!u.includes("appsync-api")) return false;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return (
        String(body.query ?? "").includes("getResults") &&
        body.variables?.deckId === deckId
      );
    },
    json: { data: { getResults: { nextToken: null, results } } },
  };
}

function getDeckRoute(
  deckId: string,
  matchups: Array<{
    matchupId: string;
    name: string;
    preferredTurnOrder: string | null;
    notes: string | null;
  }>,
): Route {
  return {
    match: (u: string, init?: RequestInit) => {
      if (!u.includes("appsync-api")) return false;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return (
        String(body.query ?? "").includes("getDeck(") &&
        body.variables?.deckId === deckId
      );
    },
    json: {
      data: {
        getDeck: {
          deckCards: [
            {
              cardIdentifier: "card-a",
              quantity: 2,
              sideboardQuantity: 0,
              maybeQuantity: 0,
              matchupQuantities: matchups.length
                ? [
                    {
                      matchupId: matchups[0].matchupId,
                      quantity: 0,
                      sideboardQuantity: 0,
                    },
                  ]
                : null,
              card: {
                types: ["Action"],
                subtypes: [],
                pitch: 1,
                cost: 1,
                power: 1,
                defense: 0,
                keywords: [],
                talents: [],
                classes: [],
                rarity: "Common",
              },
            },
            {
              cardIdentifier: "card-b",
              quantity: 0,
              sideboardQuantity: 2,
              maybeQuantity: 0,
              matchupQuantities: matchups.length
                ? [
                    {
                      matchupId: matchups[0].matchupId,
                      quantity: 0,
                      sideboardQuantity: 2,
                    },
                  ]
                : null,
              card: {
                types: ["Action"],
                subtypes: [],
                pitch: 2,
                cost: 2,
                power: 2,
                defense: 0,
                keywords: [],
                talents: [],
                classes: [],
                rarity: "Common",
              },
            },
          ],
          matchups,
        },
      },
    },
  };
}

describe("buildPrepSheet", () => {
  const originalToken = process.env.FABRARY_TOKEN;

  beforeEach(() => {
    process.env.FABRARY_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.FABRARY_TOKEN;
    else process.env.FABRARY_TOKEN = originalToken;
  });

  it("aggregates meta win-rate/games AND per-deck matchup guides for multiple decks", async () => {
    const d1 = deck({ deckId: "deck-1", name: "Deck One" });
    const d2 = deck({ deckId: "deck-2", name: "Deck Two", author: "other" });

    installFetchRouter([
      metaRoute({
        heroResults: [
          {
            heroIdentifier: "hero-x",
            results: [
              { opposingHeroIdentifier: "hero-y", plays: 20, wins: 12 },
            ],
          },
        ],
      }),
      algoliaSearchRoute([d1, d2]),
      getResultsRoute("deck-1", 6, 1),
      getResultsRoute("deck-2", 5, 1),
      // deck-1 has a Y-specific guide, matched via partial name "heroy"
      getDeckRoute("deck-1", [
        {
          matchupId: "m1",
          name: "vs HeroY Aggro",
          preferredTurnOrder: "first",
          notes: "Race them down.",
        },
      ]),
      // deck-2 has no guide at all for Y
      getDeckRoute("deck-2", []),
    ]);

    const sheet = await buildPrepSheet("hero-x", "heroy", { format: "cc" });

    expect(sheet.matchupStat).not.toBeNull();
    expect(sheet.matchupStat?.games).toBe(20);
    expect(sheet.matchupStat?.winRate).toBeCloseTo(12 / 20);

    expect(sheet.deckGuides).toHaveLength(1);
    const guide = sheet.deckGuides[0];
    expect(guide.deckId).toBe("deck-1");
    expect(guide.deckName).toBe("Deck One");
    expect(guide.author).toBe("tester");
    expect(guide.matchup.name).toBe("vs HeroY Aggro");
    expect(guide.matchup.preferredTurnOrder).toBe("first");
    expect(guide.matchup.notes).toBe("Race them down.");
    // card-a: 2 -> 0 override => removed; card-b: sideboard override 2 => added
    expect(guide.cardDiff.removed).toEqual([
      { cardIdentifier: "card-a", quantity: 2, pitch: 1 },
    ]);
    expect(guide.cardDiff.added).toEqual([
      { cardIdentifier: "card-b", quantity: 2, pitch: 2 },
    ]);

    expect(sheet.decksWithoutGuide).toBe(1);
  });

  it("matchupStat is null with a distinct explanatory reason when no meta data exists for X-vs-Y", async () => {
    const d1 = deck({ deckId: "deck-1" });
    installFetchRouter([
      metaRoute({
        heroResults: [{ heroIdentifier: "hero-x", results: [] }],
      }),
      algoliaSearchRoute([d1]),
      getResultsRoute("deck-1", 6, 1),
      getDeckRoute("deck-1", []),
    ]);

    const sheet = await buildPrepSheet("hero-x", "heroy", { format: "cc" });

    expect(sheet.matchupStat).toBeNull();
    expect(sheet.noMatchupStatReason).toMatch(/no.*meta data/i);
    expect(sheet.noMatchupStatReason).toMatch(/hero-x/i);
    expect(sheet.noMatchupStatReason).toMatch(/heroy/i);
  });

  it("deckGuides is empty with a distinct explanatory reason when meta data exists but no top decks have a Y-specific guide", async () => {
    const d1 = deck({ deckId: "deck-1" });
    installFetchRouter([
      metaRoute({
        heroResults: [
          {
            heroIdentifier: "hero-x",
            results: [
              { opposingHeroIdentifier: "hero-y", plays: 20, wins: 12 },
            ],
          },
        ],
      }),
      algoliaSearchRoute([d1]),
      getResultsRoute("deck-1", 6, 1),
      getDeckRoute("deck-1", []), // no guide at all
    ]);

    const sheet = await buildPrepSheet("hero-x", "heroy", { format: "cc" });

    expect(sheet.matchupStat).not.toBeNull();
    expect(sheet.deckGuides).toHaveLength(0);
    expect(sheet.decksWithoutGuide).toBe(1);
    expect(sheet.noDeckGuidesReason).toMatch(/no deck-specific/i);
    expect(sheet.noDeckGuidesReason).not.toEqual(sheet.noMatchupStatReason);
  });

  it("reuses deck --matchup's partial-name-match semantics (case-insensitive substring on matchup name)", async () => {
    const d1 = deck({ deckId: "deck-1" });
    installFetchRouter([
      metaRoute({
        heroResults: [
          {
            heroIdentifier: "hero-x",
            results: [{ opposingHeroIdentifier: "hero-y", plays: 4, wins: 2 }],
          },
        ],
      }),
      algoliaSearchRoute([d1]),
      getResultsRoute("deck-1", 6, 1),
      getDeckRoute("deck-1", [
        {
          matchupId: "m1",
          name: "VS HERO Y CONTROL",
          preferredTurnOrder: null,
          notes: null,
        },
      ]),
    ]);

    // Partial, lowercase --vs input should still resolve against an uppercase matchup name,
    // matching `deck --matchup <name>`'s case-insensitive substring semantics.
    const sheet = await buildPrepSheet("hero-x", "hero y", { format: "cc" });

    expect(sheet.deckGuides).toHaveLength(1);
    expect(sheet.deckGuides[0].matchup.name).toBe("VS HERO Y CONTROL");
  });
});
