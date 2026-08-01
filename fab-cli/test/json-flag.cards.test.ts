import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildJsonProgram } from "./helpers/jsonProgram";
import type { FabCard } from "../src/types";

const ANSI_RE = new RegExp(String.fromCharCode(27) + "\\[");

function card(overrides: Partial<FabCard> = {}): FabCard {
  return {
    cardIdentifier: "prism-awakener-of-sol-red",
    name: "Prism, Awakener of Sol",
    defaultImage: "https://example.com/prism.png",
    specialImage: null,
    hero: "prism-awakener-of-sol",
    isCardBack: false,
    keywords: ["Go again"],
    pitch: 1,
    cost: null,
    defense: null,
    power: null,
    talents: ["Light"],
    classes: ["Illusionist"],
    fusions: null,
    rarity: "Legendary",
    restrictedFormats: null,
    setIdentifiers: ["OUT"],
    specializations: null,
    subtypes: [],
    types: ["Hero"],
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

function mockSearchCards(cards: FabCard[]) {
  return vi
    .spyOn(global, "fetch")
    .mockImplementation(async () =>
      jsonResponse({ data: { searchCards: cards } }),
    );
}

describe("--json flag: fabrary cards search/show", () => {
  const originalToken = process.env.FABRARY_TOKEN;

  beforeEach(() => {
    process.env.FABRARY_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.FABRARY_TOKEN;
    else process.env.FABRARY_TOKEN = originalToken;
  });

  it("fabrary cards search --json emits { cards } with no ANSI", async () => {
    const c1 = card({ cardIdentifier: "card-a", name: "Card A" });
    const c2 = card({ cardIdentifier: "card-b", name: "Card B" });
    mockSearchCards([c1, c2]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "cards", "search", "card", "--json"], {
      from: "user",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(ANSI_RE);
    const parsed = JSON.parse(logs[0]);
    expect(parsed).toEqual({ cards: [c1, c2] });
  });

  it("fabrary cards search -n <limit> --json slices the array", async () => {
    const c1 = card({ cardIdentifier: "card-a" });
    const c2 = card({ cardIdentifier: "card-b" });
    mockSearchCards([c1, c2]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "cards", "search", "card", "-n", "1", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].cardIdentifier).toBe("card-a");
  });

  it("fabrary cards show --json emits { card } for the first match only", async () => {
    const c1 = card({ cardIdentifier: "card-a", name: "First Match" });
    const c2 = card({ cardIdentifier: "card-b", name: "Second Match" });
    mockSearchCards([c1, c2]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(["fabrary", "cards", "show", "match", "--json"], {
      from: "user",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(ANSI_RE);
    const parsed = JSON.parse(logs[0]);
    expect(parsed).toEqual({ card: c1 });
  });

  it("fabrary cards show --json emits { card: null } when nothing matches", async () => {
    mockSearchCards([]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabrary", "cards", "show", "nonexistent", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed).toEqual({ card: null });
  });
});
