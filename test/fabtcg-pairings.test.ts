import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchRoundPairings } from "../src/fabtcg";
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

describe("fetchRoundPairings (offline, HTTP mocked)", () => {
  let mock: MockAgentHandle;

  beforeEach(() => {
    mock = installHttpMock();
  });

  afterEach(() => restoreHttpMock(mock));

  it("parses multiple match-row blocks from one results page, including a bye", async () => {
    const html = readFixture("results.pro-tour-example.round1.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/results/1/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const pairings = await fetchRoundPairings("pro-tour-example", 1);

    // Three <tr class="match-row"> blocks in the fixture: two normal
    // matches (one won by each player) and one bye.
    expect(pairings).toHaveLength(3);

    const [m1, m2, bye] = pairings;

    expect(m1).toEqual({
      round: 1,
      player1: "Jane Smith",
      player1Hero: "Teklovossen, Esteemed Magnate",
      player2: "John Doe",
      player2Hero: "Iyslander, Stormbind",
      winner: 1,
      isBye: false,
    });

    expect(m2).toEqual({
      round: 1,
      player1: "Alex Chen",
      player1Hero: "Prism, Awakener of Sol",
      player2: "Sam Rivers",
      player2Hero: "Dromai, Duskmother",
      winner: 2,
      isBye: false,
    });

    // Bye round: no player-2-cell at all in the fixture — parser must
    // synthesize player2 = "BYE", leave player2Hero null, mark isBye,
    // and not misread the "Bye" winner-pill text as a Player 1/2 win.
    expect(bye).toEqual({
      round: 1,
      player1: "Priya Patel",
      player1Hero: "Oscilio, Constella Intelligence",
      player2: "BYE",
      player2Hero: null,
      winner: null,
      isBye: true,
    });
  });

  it("reads whatever hero is shown for that specific round (dual-format hero differs round to round)", async () => {
    const html = readFixture("results.pro-tour-example.round6.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/results/6/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const pairings = await fetchRoundPairings("pro-tour-example", 6);

    expect(pairings).toHaveLength(1);
    // Same player as round 1 ("Jane Smith") but round 6 is a Silver Age
    // round in this fixture, so the hero span on the page reflects the
    // young/SA hero rather than the CC hero seen in round 1 — the parser
    // must faithfully report exactly what's on the page for this round,
    // not the round-1 hero.
    expect(pairings[0].player1).toBe("Jane Smith");
    expect(pairings[0].player1Hero).toBe("Iyslander, the Bloodwing (Young)");
    expect(pairings[0].player2Hero).toBe("Enigma");
    expect(pairings[0].winner).toBe(2);
    expect(pairings[0].isBye).toBe(false);
  });
});
