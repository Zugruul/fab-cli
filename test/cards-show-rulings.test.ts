import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildJsonProgram } from "./helpers/jsonProgram";
import type { FabCard } from "../src/types";

function fabCard(overrides: Partial<FabCard> = {}): FabCard {
  return {
    cardIdentifier: "snatch-red",
    name: "Snatch",
    defaultImage: "https://example.com/snatch.png",
    specialImage: null,
    hero: null,
    isCardBack: false,
    keywords: [],
    pitch: 1,
    cost: 1,
    defense: 2,
    power: null,
    talents: [],
    classes: [],
    fusions: null,
    rarity: "Common",
    restrictedFormats: null,
    setIdentifiers: ["WTR"],
    specializations: null,
    subtypes: ["Action"],
    types: ["Action"],
    young: false,
    artists: ["Some Artist"],
    printings: [],
    matchingPrintings: [],
    oppositeSideCard: null,
    ...overrides,
  };
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function mockFetch({
  cards,
  cardVaultSearchResults,
  cardVaultRulings,
}: {
  cards: FabCard[];
  cardVaultSearchResults?: { card_id: string }[];
  cardVaultRulings?: unknown[];
}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("appsync-api")) {
      return jsonResponse({ data: { searchCards: cards } });
    }
    if (url.includes("/advanced-search/")) {
      return jsonResponse({
        count: cardVaultSearchResults?.length ?? 0,
        results: cardVaultSearchResults ?? [],
      });
    }
    if (url.includes("/card_id/")) {
      return jsonResponse({
        count: 1,
        results: [
          {
            card_id: cardVaultSearchResults?.[0]?.card_id ?? "unknown",
            card_type: "action",
            object_type: "card",
            cores: [],
            card_prints: [],
            card_legality: {},
            rulings_errata: cardVaultRulings ?? [],
          },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("fabrary cards show — Card Vault rulings section", () => {
  const originalToken = process.env.FABRARY_TOKEN;

  beforeEach(() => {
    process.env.FABRARY_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.FABRARY_TOKEN;
    else process.env.FABRARY_TOKEN = originalToken;
  });

  it("prints a distinct not-found note when there is no Card Vault match", async () => {
    mockFetch({ cards: [fabCard()], cardVaultSearchResults: [] });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "cards", "show", "snatch"], {
      from: "user",
    });

    const out = logs.join("\n");
    expect(out).toMatch(/not found on Card Vault/i);
    expect(out).not.toMatch(/no official rulings/i);
  });

  it('prints "no official rulings" when found with zero rulings', async () => {
    mockFetch({
      cards: [fabCard()],
      cardVaultSearchResults: [{ card_id: "snatch---snatch" }],
      cardVaultRulings: [],
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "cards", "show", "snatch"], {
      from: "user",
    });

    const out = logs.join("\n");
    expect(out).toMatch(/no official rulings/i);
    expect(out).not.toMatch(/not found on Card Vault/i);
  });

  it("prints a dated rulings list with a Card Vault source URL when rulings exist", async () => {
    mockFetch({
      cards: [fabCard()],
      cardVaultSearchResults: [{ card_id: "snatch---snatch" }],
      cardVaultRulings: [
        { date: "2021-01-01", text: "Older ruling text." },
        { date: "2023-06-15", text: "Newer ruling text." },
      ],
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "cards", "show", "snatch"], {
      from: "user",
    });

    const out = logs.join("\n");
    expect(out).toMatch(/Newer ruling text\./);
    expect(out).toMatch(/Older ruling text\./);
    expect(out.indexOf("Newer ruling text.")).toBeLessThan(
      out.indexOf("Older ruling text."),
    );
    expect(out).toMatch(
      /https:\/\/cardvault\.fabtcg\.com\/card\/snatch---snatch\//,
    );
    expect(out).not.toMatch(/no official rulings/i);
    expect(out).not.toMatch(/not found on Card Vault/i);
  });

  it("does not print a rulings section under --json", async () => {
    mockFetch({
      cards: [fabCard()],
      cardVaultSearchResults: [{ card_id: "snatch---snatch" }],
      cardVaultRulings: [{ date: "2023-01-01", text: "Some ruling." }],
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "cards", "show", "snatch", "--json"],
      { from: "user" },
    );

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed).toEqual({ card: fabCard() });
  });
});
