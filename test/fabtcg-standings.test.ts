import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchStandings } from "../src/fabtcg";
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

describe("fetchStandings (offline, HTTP mocked)", () => {
  let mock: MockAgentHandle;

  beforeEach(() => {
    mock = installHttpMock();
  });

  afterEach(() => restoreHttpMock(mock));

  it("parses a numbered round standings page, skipping malformed rows", async () => {
    const html = readFixture("standings.pro-tour-example.round1.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/standings/1/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const rows = await fetchStandings("pro-tour-example", 1);

    // The header <tr> has <th> cells only (0 <td> cells) and the
    // "Incomplete Row" <tr> has 2 <td> cells — both must be skipped
    // (fewer than 3 <td> cells = not a real standings row).
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.player)).toEqual([
      "Jane Smith",
      "John Doe",
      "Alex Chen",
    ]);
    expect(rows[0]).toEqual({
      rank: 1,
      player: "Jane Smith",
      hero: "Teklovossen, Esteemed Magnate",
      wins: 1,
    });
    expect(rows[2]).toEqual({
      rank: 4,
      player: "Alex Chen",
      hero: "Prism, Awakener of Sol",
      wins: 0,
    });
  });

  it("parses the final-standings page (different URL path than a numbered round)", async () => {
    const html = readFixture("standings.pro-tour-example.final.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/final-standings/",
        method: "GET",
      })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const rows = await fetchStandings("pro-tour-example", "final");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rank: 1,
      player: "Jane Smith",
      hero: "Teklovossen, Esteemed Magnate",
      wins: 12,
    });
    expect(rows[1]).toEqual({
      rank: 2,
      player: "Alex Chen",
      hero: "Prism, Awakener of Sol",
      wins: 11,
    });
  });
});
