import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchDecklistCards } from "../src/fabtcg";
import {
  installHttpMock,
  restoreHttpMock,
  mockPool,
  type MockAgentHandle,
} from "./helpers/http-mock";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "fabtcg");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

const HAPPY_META = [
  {
    slug: "pro-tour-example-jane-smith",
    link: "https://fabtcg.com/decklists/pro-tour-example-jane-smith/",
    cmb2: {
      decklist_auto_fields: {
        decklist_hero: "Teklovossen, Esteemed Magnate",
        decklist_player_name: "Jane Smith",
        decklist_event_name: "Pro Tour Example",
      },
    },
  },
];

describe("fetchDecklistCards (offline, HTTP mocked)", () => {
  let mock: MockAgentHandle;

  beforeEach(() => {
    mock = installHttpMock();
  });

  afterEach(() => restoreHttpMock(mock));

  it("happy path: parses meta, format, equipment, and sorted/deduped main deck", async () => {
    const html = readFixture("decklist.pro-tour-example.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=pro-tour-example-jane-smith",
        method: "GET",
      })
      .reply(200, HAPPY_META, {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/pro-tour-example-jane-smith/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const result = await fetchDecklistCards("pro-tour-example-jane-smith");

    expect(result).not.toBeNull();
    expect(result!.player).toBe("Jane Smith");
    expect(result!.hero).toBe("Teklovossen, Esteemed Magnate");
    expect(result!.event).toBe("Pro Tour Example");
    expect(result!.format).toBe("Classic Constructed");
    expect(result!.slug).toBe("pro-tour-example-jane-smith");
    expect(result!.url).toBe(
      "https://fabtcg.com/decklists/pro-tour-example-jane-smith/",
    );

    // "Hero, Weapons, Equipment" comment label → equipment section,
    // detected via the /hero.*weapon.*equipment/i branch of the regex.
    expect(result!.equipment).toEqual([
      { quantity: 1, name: "Dorinthea Ironsong", pitch: null },
      { quantity: 1, name: "Excalibur, Ex Astris", pitch: null },
      { quantity: 1, name: "Tome of Fyendal", pitch: null },
    ]);

    // Main deck: sorted pitch 1 → 2/3 → null, alphabetical within a pitch,
    // and the cross-view "Sink Below" dup (once from the Red Pitch
    // container, once re-listed under Blue Pitch with a "(red)" name
    // suffix) collapsed to a single entry.
    expect(result!.mainDeck).toEqual([
      { quantity: 2, name: "Command and Conquer", pitch: 1 },
      { quantity: 3, name: "Sink Below", pitch: 1 },
      { quantity: 2, name: "Rouse the Ancients", pitch: 3 },
      { quantity: 1, name: "Story of Tomorrow", pitch: 3 },
      { quantity: 1, name: "Adaptation", pitch: null },
    ]);
  });

  it("equipment vs main-deck section detection via the comment-label regex", async () => {
    const html = readFixture("decklist.pro-tour-example.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=pro-tour-example-jane-smith",
        method: "GET",
      })
      .reply(200, HAPPY_META, {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/pro-tour-example-jane-smith/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const result = await fetchDecklistCards("pro-tour-example-jane-smith");

    // The equipment section's cards must never leak into mainDeck...
    const mainNames = result!.mainDeck.map((c) => c.name);
    expect(mainNames).not.toContain("Dorinthea Ironsong");
    expect(mainNames).not.toContain("Excalibur, Ex Astris");
    // ...and vice versa.
    const equipNames = result!.equipment.map((c) => c.name);
    expect(equipNames).not.toContain("Sink Below");
  });

  it("infers pitch from a name suffix, which wins over a conflicting label", async () => {
    const html = readFixture("decklist.pro-tour-example.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=pro-tour-example-jane-smith",
        method: "GET",
      })
      .reply(200, HAPPY_META, {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/pro-tour-example-jane-smith/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const result = await fetchDecklistCards("pro-tour-example-jane-smith");

    // "Rouse the Ancients (blu)" sits under a "Yellow Pitch" comment —
    // the "(blu)" name suffix must win, giving pitch 3 (not 2), and the
    // " (blu)" suffix must be stripped from the returned name.
    const rouse = result!.mainDeck.find((c) => c.name === "Rouse the Ancients");
    expect(rouse).toEqual({
      quantity: 2,
      name: "Rouse the Ancients",
      pitch: 3,
    });
    expect(result!.mainDeck.some((c) => c.name.includes("(blu)"))).toBe(false);

    // A card with no name suffix under the same "Yellow Pitch" label
    // would fall back to the label-inferred pitch — here "Sink Below (red)"
    // (under "Blue Pitch") demonstrates the name suffix ("red" → pitch 1)
    // overriding the label ("Blue Pitch" → pitch 3).
    const sinkBelow = result!.mainDeck.find((c) => c.name === "Sink Below");
    expect(sinkBelow?.pitch).toBe(1);
  });

  it("dedupes a card+pitch combo that appears in more than one cards-container", async () => {
    const html = readFixture("decklist.pro-tour-example.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=pro-tour-example-jane-smith",
        method: "GET",
      })
      .reply(200, HAPPY_META, {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/pro-tour-example-jane-smith/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const result = await fetchDecklistCards("pro-tour-example-jane-smith");

    // "Sink Below" (pitch 1) appears in the Red Pitch container directly,
    // and again in the Blue Pitch container via a "(red)" name suffix —
    // same name + same resolved pitch — so it must appear exactly once.
    const sinkBelowEntries = result!.mainDeck.filter(
      (c) => c.name === "Sink Below",
    );
    expect(sinkBelowEntries).toHaveLength(1);
    expect(sinkBelowEntries[0].quantity).toBe(3);
  });

  it("sorts main deck by pitch (1→2→3→null) then alphabetically within a pitch", async () => {
    const html = readFixture("decklist.pro-tour-example.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=pro-tour-example-jane-smith",
        method: "GET",
      })
      .reply(200, HAPPY_META, {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/pro-tour-example-jane-smith/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const result = await fetchDecklistCards("pro-tour-example-jane-smith");

    const pitches = result!.mainDeck.map((c) => c.pitch);
    expect(pitches).toEqual([1, 1, 3, 3, null]);

    // Alphabetical within pitch 1: "Command and Conquer" before "Sink Below".
    expect(result!.mainDeck[0].name).toBe("Command and Conquer");
    expect(result!.mainDeck[1].name).toBe("Sink Below");
    // Alphabetical within pitch 3: "Rouse the Ancients" before "Story of Tomorrow".
    expect(result!.mainDeck[2].name).toBe("Rouse the Ancients");
    expect(result!.mainDeck[3].name).toBe("Story of Tomorrow");
    // The no-pitch card sorts last.
    expect(result!.mainDeck[4].name).toBe("Adaptation");
  });

  it("still attempts the HTML fetch via the fallback URL when the WP API returns non-ok", async () => {
    const html = readFixture("decklist.no-meta-fallback.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=no-meta-slug",
        method: "GET",
      })
      .reply(404, "not found");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/no-meta-slug/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const result = await fetchDecklistCards("no-meta-slug");

    expect(result).not.toBeNull();
    // No WP metadata available: falls back to blank player/hero/event and
    // the constructed fallback URL, but still parses the HTML successfully.
    expect(result!.player).toBe("");
    expect(result!.hero).toBe("");
    expect(result!.event).toBe("");
    expect(result!.slug).toBe("no-meta-slug");
    expect(result!.url).toBe("https://fabtcg.com/decklists/no-meta-slug/");
    // format stays null since there is no `meta` object to attach it to.
    expect(result!.format).toBeNull();
    expect(result!.equipment).toEqual([
      { quantity: 1, name: "Prism, Awakener of Sol", pitch: null },
    ]);
    expect(result!.mainDeck).toEqual([
      { quantity: 2, name: "Snatch", pitch: 3 },
    ]);
  });

  it("returns null when the HTML page fetch fails, even with valid WP metadata", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=pro-tour-example-jane-smith",
        method: "GET",
      })
      .reply(200, HAPPY_META, {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/pro-tour-example-jane-smith/",
        method: "GET",
      })
      .reply(404, "not found");

    const result = await fetchDecklistCards("pro-tour-example-jane-smith");

    expect(result).toBeNull();
  });
});
