import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseCardRuling,
  fetchCardRulings,
  type CardVaultCard,
} from "../src/cardvault";

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERROR",
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function cardVaultCard(overrides: Partial<CardVaultCard> = {}): CardVaultCard {
  return {
    card_id: "snatch---snatch",
    card_type: "action",
    object_type: "card",
    cores: [],
    card_prints: [],
    card_legality: {},
    rulings_errata: [],
    ...overrides,
  };
}

describe("parseCardRuling", () => {
  it("parses { date, text } shape", () => {
    expect(parseCardRuling({ date: "2024-01-01", text: "A ruling." })).toEqual(
      { date: "2024-01-01", text: "A ruling.", raw: { date: "2024-01-01", text: "A ruling." } },
    );
  });

  it("parses { ruling_date, ruling_text } shape", () => {
    const entry = { ruling_date: "2023-05-05", ruling_text: "Another ruling." };
    expect(parseCardRuling(entry)).toEqual({
      date: "2023-05-05",
      text: "Another ruling.",
      raw: entry,
    });
  });

  it("parses { created_at, description } shape", () => {
    const entry = { created_at: "2022-02-02", description: "Errata note." };
    expect(parseCardRuling(entry)).toEqual({
      date: "2022-02-02",
      text: "Errata note.",
      raw: entry,
    });
  });

  it("parses { body } shape with no date", () => {
    const entry = { body: "Body-only ruling." };
    expect(parseCardRuling(entry)).toEqual({
      date: null,
      text: "Body-only ruling.",
      raw: entry,
    });
  });

  it("degrades gracefully on an unrecognized object shape (no throw)", () => {
    const entry = { foo: "bar", baz: 42 };
    expect(() => parseCardRuling(entry)).not.toThrow();
    const result = parseCardRuling(entry);
    expect(result.date).toBeNull();
    expect(result.text).toBe(String(entry));
    expect(result.raw).toBe(entry);
  });

  it("degrades gracefully on a primitive entry (no throw)", () => {
    expect(parseCardRuling("just a string")).toEqual({
      date: null,
      text: "just a string",
      raw: "just a string",
    });
    expect(parseCardRuling(null)).toEqual({
      date: null,
      text: "null",
      raw: null,
    });
  });
});

describe("fetchCardRulings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed, most-recent-first rulings when the card is found with rulings", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/advanced-search/")) {
        return jsonResponse({
          count: 1,
          results: [{ card_id: "snatch---snatch" }],
        });
      }
      if (url.includes("/card_id/")) {
        return jsonResponse({
          count: 1,
          results: [
            cardVaultCard({
              rulings_errata: [
                { date: "2021-01-01", text: "Older ruling." },
                { date: "2023-06-15", text: "Newer ruling." },
                { text: "Undated ruling." },
              ],
            }),
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const rulings = await fetchCardRulings("Snatch");
    expect(rulings).not.toBeNull();
    expect(rulings!.map((r) => r.text)).toEqual([
      "Newer ruling.",
      "Older ruling.",
      "Undated ruling.",
    ]);
  });

  it("returns [] when the card is found on Card Vault with zero rulings", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/advanced-search/")) {
        return jsonResponse({
          count: 1,
          results: [{ card_id: "some-card---some-card" }],
        });
      }
      if (url.includes("/card_id/")) {
        return jsonResponse({
          count: 1,
          results: [cardVaultCard({ rulings_errata: [] })],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const rulings = await fetchCardRulings("Some Card");
    expect(rulings).toEqual([]);
  });

  it("returns null when no Card Vault match is found", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/advanced-search/")) {
        return jsonResponse({ count: 0, results: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const rulings = await fetchCardRulings("Nonexistent Card");
    expect(rulings).toBeNull();
  });

  it("returns null on a network/HTTP error rather than throwing", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      throw new Error("network down");
    });

    const rulings = await fetchCardRulings("Anything");
    expect(rulings).toBeNull();
  });

  it("returns null when search succeeds but the detail fetch errors", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/advanced-search/")) {
        return jsonResponse({
          count: 1,
          results: [{ card_id: "some-card---some-card" }],
        });
      }
      if (url.includes("/card_id/")) {
        return jsonResponse({}, false, 500);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const rulings = await fetchCardRulings("Some Card");
    expect(rulings).toBeNull();
  });
});
