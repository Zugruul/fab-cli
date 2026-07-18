import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildJsonProgram } from "./helpers/jsonProgram";
import type { AlgoliaDeck } from "../src/types";

const ANSI_RE = /\x1b\[/;

function deck(overrides: Partial<AlgoliaDeck> = {}): AlgoliaDeck {
  return {
    deckId: "deck-1",
    name: "Test Deck",
    author: "tester",
    hero: "Prism, Awakener of Sol",
    heroIdentifier: "prism-awakener-of-sol",
    format: "Classic Constructed",
    cards: ["card-a"],
    hasMatchups: false,
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

function algoliaSearchRoute(hits: AlgoliaDeck[]) {
  return {
    match: (u: string) => u.includes("4e2ysy5y4i-dsn.algolia.net") && u.includes("queries"),
    json: {
      results: [
        { hits, nbHits: hits.length, page: 0, nbPages: 1, hitsPerPage: 50, facets: {} },
      ],
    },
  };
}

function algoliaGetDeckRoute(d: AlgoliaDeck) {
  return {
    match: (u: string) =>
      u.includes("4e2ysy5y4i-dsn.algolia.net/1/indexes/public_decks/"),
    json: d,
  };
}

function graphqlRoute(matchQuery: string, data: unknown) {
  return {
    match: (u: string, init?: RequestInit) => {
      if (!u.includes("appsync-api")) return false;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return String(body.query ?? "").includes(matchQuery);
    },
    json: { data },
  };
}

function metaRoute(payload: unknown) {
  return {
    match: (u: string) => u.includes("content.fabrary.net"),
    json: payload,
  };
}

describe("--json flag: fabrary search/top/deck/meta", () => {
  const originalToken = process.env.FABRARY_TOKEN;

  beforeEach(() => {
    process.env.FABRARY_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.FABRARY_TOKEN;
    else process.env.FABRARY_TOKEN = originalToken;
  });

  it("fabrary search --json emits { decks, page, nbPages } with no ANSI", async () => {
    const d = deck({ name: "Sunder Aggro" });
    installFetchRouter([algoliaSearchRoute([d])]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => {
      logs.push(s);
    });

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "search", "-q", "sunder", "--json"], {
      from: "user",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(ANSI_RE);
    const parsed = JSON.parse(logs[0]);
    expect(parsed).toEqual({ decks: [d], page: 0, nbPages: 1 });
  });

  it("fabrary top (default) --json emits { decks } with computed win rates", async () => {
    const d1 = deck({ deckId: "d1", name: "Deck One" });
    const d2 = deck({ deckId: "d2", name: "Deck Two" });
    installFetchRouter([
      algoliaSearchRoute([d1, d2]),
      graphqlRoute("getResults", {
        getResults: {
          nextToken: null,
          results: [
            { result: "Won", source: "FaBrary", notes: null, deckId: "d1", gameId: "g1", turns: 8, firstPlayer: true, cardResults: [] },
            { result: "Won", source: "FaBrary", notes: null, deckId: "d1", gameId: "g2", turns: 9, firstPlayer: false, cardResults: [] },
            { result: "Lost", source: "FaBrary", notes: null, deckId: "d1", gameId: "g3", turns: 7, firstPlayer: true, cardResults: [] },
          ],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "top", "--min-games", "1", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[logs.length - 1]);
    expect(parsed.decks).toHaveLength(2);
    const one = parsed.decks.find((x: { deckId: string }) => x.deckId === "d1");
    expect(one.wins).toBe(2);
    expect(one.losses).toBe(1);
    expect(one.total).toBe(3);
    expect(one.winRate).toBeCloseTo(2 / 3);
    expect(logs.every((l) => !ANSI_RE.test(l))).toBe(true);
  });

  it("fabrary top --per-hero --json emits { perHero }", async () => {
    const d1 = deck({ deckId: "d1" });
    installFetchRouter([
      algoliaSearchRoute([d1]),
      graphqlRoute("getResults", {
        getResults: {
          nextToken: null,
          results: [
            { result: "Won", source: "FaBrary", notes: null, deckId: "d1", gameId: "g1", turns: 8, firstPlayer: true, cardResults: [] },
          ],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "top", "--per-hero", "--min-games", "1", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[logs.length - 1]);
    expect(parsed).toHaveProperty("perHero");
    expect(parsed.perHero).toHaveLength(1);
    expect(parsed.perHero[0].topWinRate.winRate).toBeCloseTo(1);
  });

  it("fabrary top --top-n --json emits { heroGroups }", async () => {
    const d1 = deck({ deckId: "d1" });
    installFetchRouter([
      algoliaSearchRoute([d1]),
      graphqlRoute("getResults", {
        getResults: {
          nextToken: null,
          results: [
            { result: "Won", source: "FaBrary", notes: null, deckId: "d1", gameId: "g1", turns: 8, firstPlayer: true, cardResults: [] },
          ],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "top", "--top-n", "2", "--min-games", "1", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[logs.length - 1]);
    expect(parsed).toHaveProperty("heroGroups");
    expect(parsed.heroGroups[0].decks).toHaveLength(1);
  });

  it("fabrary top --top-n --by-class --json emits { classGroups }", async () => {
    const d1 = deck({ deckId: "d1", heroIdentifier: "prism-awakener-of-sol" });
    installFetchRouter([
      algoliaSearchRoute([d1]),
      graphqlRoute("getResults", {
        getResults: {
          nextToken: null,
          results: [
            { result: "Won", source: "FaBrary", notes: null, deckId: "d1", gameId: "g1", turns: 8, firstPlayer: true, cardResults: [] },
          ],
        },
      }),
      graphqlRoute("searchCards", {
        searchCards: [
          {
            cardIdentifier: "prism-awakener-of-sol",
            name: "Prism, Awakener of Sol",
            defaultImage: "",
            specialImage: null,
            hero: "prism-awakener-of-sol",
            isCardBack: false,
            keywords: [],
            pitch: null,
            cost: null,
            defense: null,
            power: null,
            talents: ["Light"],
            classes: ["Illusionist"],
            fusions: null,
            rarity: "Legendary",
            restrictedFormats: null,
            setIdentifiers: [],
            specializations: null,
            subtypes: [],
            types: ["Hero"],
            young: false,
            artists: [],
            printings: [],
            matchingPrintings: [],
            oppositeSideCard: null,
          },
        ],
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      [
        "fabrary",
        "top",
        "--top-n",
        "2",
        "--by-class",
        "--min-games",
        "1",
        "--json",
      ],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[logs.length - 1]);
    expect(parsed).toHaveProperty("classGroups");
    expect(parsed.classGroups[0].className).toBe("Illusionist");
  });

  it("fabrary deck <id> --json (default, all sections) includes decklist/matchups/stats", async () => {
    const d = deck({ deckId: "deck-x", name: "Combo Deck" });
    installFetchRouter([
      algoliaGetDeckRoute(d),
      graphqlRoute("getResults", {
        getResults: {
          nextToken: null,
          results: [
            { result: "Won", source: "FaBrary", notes: null, deckId: "deck-x", gameId: "g1", turns: 8, firstPlayer: true, cardResults: [{ cardIdentifier: "card-a", blocked: 0, pitched: 1, played: 2 }] },
            { result: "Lost", source: "FaBrary", notes: null, deckId: "deck-x", gameId: "g2", turns: 6, firstPlayer: false, cardResults: [] },
          ],
        },
      }),
      graphqlRoute("getDeck", {
        getDeck: {
          deckCards: [
            {
              cardIdentifier: "card-a",
              quantity: 3,
              sideboardQuantity: 1,
              maybeQuantity: 0,
              matchupQuantities: [{ matchupId: "m1", quantity: 2, sideboardQuantity: 0 }],
              card: { types: ["Action"], subtypes: [], pitch: 1, cost: 2, power: 3, defense: 0, keywords: [], talents: [], classes: [], rarity: "Common" },
            },
          ],
          matchups: [
            { matchupId: "m1", name: "vs Prism", preferredTurnOrder: "first", notes: "Race them." },
          ],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "deck", "deck-x", "--json"], {
      from: "user",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(ANSI_RE);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.decklist.deck.name).toBe("Combo Deck");
    expect(parsed.decklist.winRateStats).toEqual({ wins: 1, losses: 1, total: 2, winRate: 0.5 });
    expect(parsed.matchups).toHaveLength(1);
    expect(parsed.matchups[0].matchup.name).toBe("vs Prism");
    expect(parsed.matchups[0].cards).toEqual([{ cardIdentifier: "card-a", quantity: 2 }]);
    expect(parsed.stats.deckName).toBe("Combo Deck");
    expect(parsed.stats.resultStats.wins).toBe(1);
    expect(parsed.stats.resultStats.losses).toBe(1);
    // bySource is a Map in-process — must be flattened, not serialized to {}
    expect(parsed.stats.resultStats.bySource.FaBrary.total).toBe(2);
    // deckStats has Map-valued distributions too
    expect(parsed.stats.deckStats.typeDist.Action).toBe(3);
  });

  it("fabrary deck <id> --decklist-only --json emits only { decklist }", async () => {
    const d = deck({ deckId: "deck-y" });
    installFetchRouter([
      algoliaGetDeckRoute(d),
      graphqlRoute("getResults", { getResults: { nextToken: null, results: [] } }),
      graphqlRoute("getDeck", {
        getDeck: {
          deckCards: [
            { cardIdentifier: "card-a", quantity: 2, sideboardQuantity: 0, maybeQuantity: 0, matchupQuantities: null, card: { types: ["Action"], subtypes: [], pitch: 1, cost: 1, power: 1, defense: 0, keywords: [], talents: [], classes: [], rarity: "Common" } },
          ],
          matchups: [],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "deck", "deck-y", "--decklist-only", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed).toHaveProperty("decklist");
    expect(parsed).not.toHaveProperty("matchups");
    expect(parsed).not.toHaveProperty("stats");
  });

  it("fabrary deck <id> --matchups-only --json emits only { matchups }", async () => {
    const d = deck({ deckId: "deck-z" });
    installFetchRouter([
      algoliaGetDeckRoute(d),
      graphqlRoute("getResults", { getResults: { nextToken: null, results: [] } }),
      graphqlRoute("getDeck", {
        getDeck: {
          deckCards: [
            { cardIdentifier: "card-a", quantity: 2, sideboardQuantity: 0, maybeQuantity: 0, matchupQuantities: [{ matchupId: "m1", quantity: 1, sideboardQuantity: 0 }], card: { types: ["Action"], subtypes: [], pitch: 1, cost: 1, power: 1, defense: 0, keywords: [], talents: [], classes: [], rarity: "Common" } },
          ],
          matchups: [{ matchupId: "m1", name: "vs Levia", preferredTurnOrder: null, notes: null }],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "deck", "deck-z", "--matchups-only", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(Object.keys(parsed)).toEqual(["matchups"]);
    expect(parsed.matchups[0].cards).toEqual([{ cardIdentifier: "card-a", quantity: 1 }]);
  });

  it("fabrary deck <id> --stats-only --json emits only { stats }", async () => {
    const d = deck({ deckId: "deck-w" });
    installFetchRouter([
      algoliaGetDeckRoute(d),
      graphqlRoute("getResults", {
        getResults: {
          nextToken: null,
          results: [
            { result: "Won", source: "Talishar", notes: null, deckId: "deck-w", gameId: "g1", turns: 5, firstPlayer: true, cardResults: [] },
          ],
        },
      }),
      graphqlRoute("getDeck", {
        getDeck: {
          deckCards: [
            { cardIdentifier: "card-a", quantity: 2, sideboardQuantity: 0, maybeQuantity: 0, matchupQuantities: null, card: { types: ["Action"], subtypes: [], pitch: 1, cost: 1, power: 1, defense: 0, keywords: [], talents: [], classes: [], rarity: "Common" } },
          ],
          matchups: [],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "deck", "deck-w", "--stats-only", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(Object.keys(parsed)).toEqual(["stats"]);
    expect(parsed.stats.resultStats.bySource.Talishar.wins).toBe(1);
  });

  it("fabrary deck <id> --matchup <name> --json emits { deck, matchup, cards }", async () => {
    const d = deck({ deckId: "deck-m" });
    installFetchRouter([
      algoliaGetDeckRoute(d),
      graphqlRoute("getResults", { getResults: { nextToken: null, results: [] } }),
      graphqlRoute("getDeck", {
        getDeck: {
          deckCards: [
            { cardIdentifier: "card-a", quantity: 2, sideboardQuantity: 0, maybeQuantity: 0, matchupQuantities: [{ matchupId: "m1", quantity: 4, sideboardQuantity: 0 }], card: { types: ["Action"], subtypes: [], pitch: 1, cost: 1, power: 1, defense: 0, keywords: [], talents: [], classes: [], rarity: "Common" } },
          ],
          matchups: [{ matchupId: "m1", name: "vs Prism", preferredTurnOrder: "first", notes: null }],
        },
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "deck", "deck-m", "--matchup", "prism", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.matchup.name).toBe("vs Prism");
    expect(parsed.cards).toEqual([{ cardIdentifier: "card-a", quantity: 4 }]);
    expect(parsed.deck.deckId).toBe("deck-m");
  });

  it("fabrary meta --json emits { heroes } sorted by win rate, zero-game heroes excluded", async () => {
    installFetchRouter([
      metaRoute({
        heroResults: [
          {
            heroIdentifier: "dorinthea-ironsong",
            results: [{ opposingHeroIdentifier: "prism", plays: 10, wins: 8 }],
          },
          {
            heroIdentifier: "levia-shadowborn",
            results: [{ opposingHeroIdentifier: "prism", plays: 10, wins: 2 }],
          },
          { heroIdentifier: "unplayed-hero", results: [] },
        ],
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "meta", "--json"], { from: "user" });

    const parsed = JSON.parse(logs[0]);
    expect(parsed.heroes.map((h: { hero: string }) => h.hero)).toEqual([
      "dorinthea-ironsong",
      "levia-shadowborn",
    ]);
    expect(parsed.heroes[0].overallWinRate).toBeCloseTo(0.8);
  });

  it("fabrary meta --hero <id> --json emits { hero: HeroMetaRow }", async () => {
    installFetchRouter([
      metaRoute({
        heroResults: [
          {
            heroIdentifier: "dorinthea-ironsong",
            results: [{ opposingHeroIdentifier: "prism", plays: 10, wins: 8 }],
          },
        ],
      }),
    ]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "meta", "--hero", "dorinthea", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.hero.hero).toBe("dorinthea-ironsong");
    expect(parsed.hero.matchups).toHaveLength(1);
  });

  it("fabrary meta --list-periods --json emits { periods }", async () => {
    // getSeasonPeriods() hits fabrary.net directly for season discovery; mock
    // it to a non-ok response so it falls back to [] without touching the network.
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
      text: async () => "",
    } as Response);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "meta", "--list-periods", "--json"], {
      from: "user",
    });

    const parsed = JSON.parse(logs[0]);
    expect(parsed).toHaveProperty("periods");
    expect(Array.isArray(parsed.periods)).toBe(true);
    expect(parsed.periods.length).toBeGreaterThan(0);
  });
});
