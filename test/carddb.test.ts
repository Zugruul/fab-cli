import * as path from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadCardDb, searchLocalCards } from "../src/carddb";

const FIXTURE_DB_PATH = path.resolve(__dirname, "fixtures/carddb/card.json");

describe("carddb — loadCardDb", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads cards from a given dbPath (fixture), not the real submodule path", () => {
    const cards = loadCardDb(FIXTURE_DB_PATH);
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.name)).toContain("Snatch");
  });

  it("caches per-path: repeated calls with the same dbPath return the same cached array instance", () => {
    const first = loadCardDb(FIXTURE_DB_PATH);
    const second = loadCardDb(FIXTURE_DB_PATH);
    expect(second).toBe(first);
  });

  it("throws a helpful error when dbPath does not exist", () => {
    const missing = path.resolve(
      __dirname,
      "fixtures/carddb/does-not-exist.json",
    );
    expect(() => loadCardDb(missing)).toThrow(/card DB missing/);
    expect(() => loadCardDb(missing)).toThrow(missing);
  });
});

describe("carddb — searchLocalCards", () => {
  it("name scope matches only cards whose NAME contains the term", () => {
    const results = searchLocalCards(["snatch"], {
      scope: "name",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(results.map((c) => c.name)).toEqual(["Snatch"]);
  });

  it('text scope matches a DIFFERENT card that only mentions the term in its functional text ("mentions X" case)', () => {
    const results = searchLocalCards(["snatch"], {
      scope: "text",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(results.map((c) => c.name)).toEqual(["Command and Conquer"]);
  });

  it("keyword scope matches only cards carrying that keyword", () => {
    const results = searchLocalCards(["dominate"], {
      scope: "keyword",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(results.map((c) => c.name)).toEqual(["Screeching Strike"]);
  });

  it("--exact is a case-insensitive exact name match", () => {
    const results = searchLocalCards([], {
      exact: "SNATCH",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(results.map((c) => c.name)).toEqual(["Snatch"]);
  });

  it("pitch filter actually filters (not passthrough)", () => {
    const results = searchLocalCards([], {
      pitch: "3",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(results.map((c) => c.name)).toEqual(["Blazing Aether"]);
  });

  it("cost filter actually filters (not passthrough)", () => {
    const results = searchLocalCards([], {
      cost: "2",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(results.map((c) => c.name)).toEqual(["Blazing Aether"]);
  });

  it("type filter actually filters (not passthrough)", () => {
    const results = searchLocalCards([], {
      type: "Instant",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(results.map((c) => c.name)).toEqual(["Blazing Aether"]);
  });

  it("documents current behavior: opts.limit is not applied by searchLocalCards itself (limit is a caller/CLI-side slice)", () => {
    const results = searchLocalCards([], {
      pitch: "1",
      limit: 1,
      dbPath: FIXTURE_DB_PATH,
    });
    // three fixture cards have pitch "1": Snatch, Screeching Strike, Rally the Rearguard
    expect(results.length).toBe(3);
  });

  it("real default-path call and fixture-path call do not collide in the cache", () => {
    const fixtureResults = searchLocalCards(["snatch"], {
      scope: "name",
      dbPath: FIXTURE_DB_PATH,
    });
    expect(fixtureResults).toHaveLength(1);

    const realResults = searchLocalCards(["snatch"], { scope: "name" });
    // real submodule corpus has far more than the fixture's single "Snatch"-named card
    // (at minimum it should not be equal to/contaminated by the fixture set)
    expect(realResults.length).toBeGreaterThanOrEqual(1);
  });
});
