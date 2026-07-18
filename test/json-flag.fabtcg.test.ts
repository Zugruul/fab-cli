import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildJsonProgram } from "./helpers/jsonProgram";
import {
  installHttpMock,
  restoreHttpMock,
  mockPool,
  type MockAgentHandle,
} from "./helpers/http-mock";

const ANSI_RE = new RegExp(String.fromCharCode(27) + "\\[");

const EVENTS_HTML = `<!doctype html><html><body>
<a class="fl-link-card-ssr" href="https://fabtcg.com/organised-play/pro-tour-example/">
  <div class="fl-link-card-ssr-content">
    <h3>Pro Tour Example</h3>
    <p>Apr 3-5, 2026 / Example City</p>
  </div>
</a>
</body></html>`;

const COVERAGE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head><title>Pro Tour Example Coverage | Flesh and Blood TCG</title></head>
  <body>
    <article>
      <h1 class="entry-title">Pro Tour Example Coverage</h1>
      <div class="coverage-nav">
        <p>Standings:</p>
        <ul>
          <li><a href="/coverage/pro-tour-example/standings/1/">Round 1</a></li>
          <li><a href="/coverage/pro-tour-example/final-standings/">Final Standings</a></li>
        </ul>
        <p>Results:</p>
        <ul>
          <li><a href="/coverage/pro-tour-example/results/1/">Round 1</a></li>
        </ul>
      </div>
    </article>
  </body>
</html>`;

function standingsHtml(rows: Array<[number, string, string, number]>): string {
  const trs = rows
    .map(
      ([rank, player, hero, wins]) =>
        `<tr><td>${rank}</td><td>${player}</td><td>${hero}</td><td>${wins}</td></tr>`,
    )
    .join("\n");
  return `<table>${trs}</table>`;
}

function matchRow(opts: {
  player1: string;
  player1Hero: string;
  player2: string;
  player2Hero: string;
  winner: 1 | 2;
}): string {
  const winnerText = opts.winner === 1 ? "Player 1 Win" : "Player 2 Win";
  return `<tr class="match-row">
    <td class="player-1-cell"><div class="player-text"><strong>${opts.player1}</strong><br/><span>${opts.player1Hero}</span></div></td>
    <td class="vs-cell"><span class="winner-pill">${winnerText}</span></td>
    <td class="player-2-cell"><div class="player-text"><strong>${opts.player2}</strong><br/><span>${opts.player2Hero}</span></div></td>
  </tr>`;
}

function decklistSearchResult(opts: {
  slug: string;
  url: string;
  player: string;
  hero: string;
  event: string;
}) {
  return {
    slug: opts.slug,
    link: opts.url,
    cmb2: {
      decklist_auto_fields: {
        decklist_hero: opts.hero,
        decklist_player_name: opts.player,
        decklist_event_name: opts.event,
      },
    },
  };
}

const DECKLIST_HTML = `<!doctype html><html><body><h1>Alice's list</h1></body></html>`;

describe("--json flag: fabtcg events/coverage", () => {
  let mock: MockAgentHandle;
  const logs: string[] = [];

  beforeEach(() => {
    mock = installHttpMock();
    logs.length = 0;
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
  });

  afterEach(async () => {
    await restoreHttpMock(mock);
    vi.restoreAllMocks();
  });

  it("fabtcg events --json emits { events } with no ANSI", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/organised-play/", method: "GET" })
      .reply(200, EVENTS_HTML, { headers: { "content-type": "text/html" } });

    const program = buildJsonProgram();
    await program.parseAsync(["fabtcg", "events", "--json"], { from: "user" });

    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(ANSI_RE);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      name: "Pro Tour Example",
      slug: "pro-tour-example",
      date: "Apr 3-5, 2026",
      location: "Example City",
    });
  });

  it("fabtcg coverage <event> --json (default, no flags) emits { index }", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabtcg", "coverage", "pro-tour-example", "--json"],
      {
        from: "user",
      },
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(ANSI_RE);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.index.slug).toBe("pro-tour-example");
    expect(parsed.index.title).toBe("Pro Tour Example Coverage");
    expect(parsed.index.standingRounds).toEqual([1]);
    expect(parsed.index.hasFinalStandings).toBe(true);
  });

  it("fabtcg coverage <event> --round <n> --json emits { index, standings }", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/standings/1/",
        method: "GET",
      })
      .reply(
        200,
        standingsHtml([
          [1, "Alice", "Dorinthea", 5],
          [2, "Bob", "Prism", 4],
        ]),
        { headers: { "content-type": "text/html" } },
      );

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabtcg", "coverage", "pro-tour-example", "--round", "1", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.standings).toEqual([
      { rank: 1, player: "Alice", hero: "Dorinthea", wins: 5 },
      { rank: 2, player: "Bob", hero: "Prism", wins: 4 },
    ]);
    expect(parsed.index.slug).toBe("pro-tour-example");
    expect(parsed).not.toHaveProperty("field");
  });

  it("fabtcg coverage <event> --field --json emits { index, field } from the latest standings round", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/standings/1/",
        method: "GET",
      })
      .reply(
        200,
        standingsHtml([
          [1, "Alice", "Dorinthea", 5],
          [2, "Bob", "Dorinthea", 4],
        ]),
        { headers: { "content-type": "text/html" } },
      );

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabtcg", "coverage", "pro-tour-example", "--field", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.field).toHaveLength(2);
    expect(
      parsed.field.every((r: { hero: string }) => r.hero === "Dorinthea"),
    ).toBe(true);
    expect(parsed).not.toHaveProperty("standings");
  });

  it("fabtcg coverage <event> --round <n> --field --json combines both sections in one object", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/standings/1/",
        method: "GET",
      })
      .reply(200, standingsHtml([[1, "Alice", "Dorinthea", 5]]), {
        headers: { "content-type": "text/html" },
      })
      .persist();

    const program = buildJsonProgram();
    await program.parseAsync(
      [
        "fabtcg",
        "coverage",
        "pro-tour-example",
        "--round",
        "1",
        "--field",
        "--json",
      ],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed).toHaveProperty("standings");
    expect(parsed).toHaveProperty("field");
  });

  it("fabtcg coverage <event> --decklists --json emits { index, decklists } (list only, no player)", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/wp/v2/decklist?") && p.includes("search="),
        method: "GET",
      })
      .reply(
        200,
        JSON.stringify([
          decklistSearchResult({
            slug: "alice-pro-tour-example",
            url: "https://fabtcg.com/decklists/alice-pro-tour-example/",
            player: "Alice",
            hero: "Prism, Awakener of Sol",
            event: "Pro Tour Example",
          }),
        ]),
        { headers: { "content-type": "application/json" } },
      );

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabtcg", "coverage", "pro-tour-example", "--decklists", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.decklists).toEqual([
      {
        slug: "alice-pro-tour-example",
        url: "https://fabtcg.com/decklists/alice-pro-tour-example/",
        player: "Alice",
        hero: "Prism, Awakener of Sol",
        event: "Pro Tour Example",
        format: null,
      },
    ]);
    expect(parsed).not.toHaveProperty("decklist");
  });

  it("fabtcg coverage <event> --decklists --player <name> --json resolves a single match to { decklist }", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    const meta = decklistSearchResult({
      slug: "alice-pro-tour-example",
      url: "https://fabtcg.com/decklists/alice-pro-tour-example/",
      player: "Alice",
      hero: "Prism, Awakener of Sol",
      event: "Pro Tour Example",
    });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/wp/v2/decklist?") && p.includes("search="),
        method: "GET",
      })
      .reply(200, JSON.stringify([meta]), {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/api/wp/v2/decklist?slug=alice-pro-tour-example",
        method: "GET",
      })
      .reply(200, JSON.stringify([meta]), {
        headers: { "content-type": "application/json" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/decklists/alice-pro-tour-example/",
        method: "GET",
      })
      .reply(200, DECKLIST_HTML, { headers: { "content-type": "text/html" } });

    const program = buildJsonProgram();
    await program.parseAsync(
      [
        "fabtcg",
        "coverage",
        "pro-tour-example",
        "--decklists",
        "--player",
        "Alice",
        "--json",
      ],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.decklists).toHaveLength(1);
    expect(parsed.decklist).toMatchObject({
      slug: "alice-pro-tour-example",
      player: "Alice",
      hero: "Prism, Awakener of Sol",
      equipment: [],
      mainDeck: [],
    });
  });

  it("fabtcg coverage <event> --player <name> --json emits { decklists: [] } when nothing matches", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/wp/v2/decklist?") && p.includes("search="),
        method: "GET",
      })
      .reply(200, "[]", { headers: { "content-type": "application/json" } });

    const program = buildJsonProgram();
    await program.parseAsync(
      [
        "fabtcg",
        "coverage",
        "pro-tour-example",
        "--player",
        "Nobody",
        "--json",
      ],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.decklists).toEqual([]);
    expect(parsed).not.toHaveProperty("decklist");
  });

  it("fabtcg coverage <event> --player <name> --json emits only { decklists } (no decklist key) when multiple match", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/wp/v2/decklist?") && p.includes("search="),
        method: "GET",
      })
      .reply(
        200,
        JSON.stringify([
          decklistSearchResult({
            slug: "alice-cc-pro-tour-example",
            url: "https://fabtcg.com/decklists/alice-cc-pro-tour-example/",
            player: "Alice",
            hero: "Prism, Awakener of Sol",
            event: "Pro Tour Example",
          }),
          decklistSearchResult({
            slug: "alice-sa-pro-tour-example",
            url: "https://fabtcg.com/decklists/alice-sa-pro-tour-example/",
            player: "Alice",
            hero: "Iyslander, Stormbind",
            event: "Pro Tour Example",
          }),
        ]),
        { headers: { "content-type": "application/json" } },
      );

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabtcg", "coverage", "pro-tour-example", "--player", "Alice", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.decklists).toHaveLength(2);
    expect(parsed).not.toHaveProperty("decklist");
  });

  it("fabtcg coverage <event> --path <name> --json emits { index, path } when found", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      })
      .persist();
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/results/1/",
        method: "GET",
      })
      .reply(
        200,
        `<table>${matchRow({
          player1: "Alice",
          player1Hero: "Dorinthea",
          player2: "Bob",
          player2Hero: "Prism",
          winner: 1,
        })}</table>`,
        { headers: { "content-type": "text/html" } },
      )
      .persist();

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabtcg", "coverage", "pro-tour-example", "--path", "Alice", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.path).toBeTruthy();
    expect(parsed.path.player).toBe("Alice");
    expect(parsed.path.wins).toBe(1);
    expect(parsed.path.rounds).toHaveLength(1);
  });

  it("fabtcg coverage <event> --path <name> --json emits { path: null } (explicit) when no pairings found", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      })
      .persist();
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/results/1/",
        method: "GET",
      })
      .reply(
        200,
        `<table>${matchRow({
          player1: "Alice",
          player1Hero: "Dorinthea",
          player2: "Bob",
          player2Hero: "Prism",
          winner: 1,
        })}</table>`,
        { headers: { "content-type": "text/html" } },
      )
      .persist();

    const program = buildJsonProgram();
    await program.parseAsync(
      ["fabtcg", "coverage", "pro-tour-example", "--path", "Nobody", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed).toHaveProperty("path");
    expect(parsed.path).toBeNull();
  });

  it("fabtcg coverage <event> --search-player <name> --json emits { searchMatches: [] } when nothing matches", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/results/1/",
        method: "GET",
      })
      .reply(
        200,
        `<table>${matchRow({
          player1: "Alice",
          player1Hero: "Dorinthea",
          player2: "Bob",
          player2Hero: "Prism",
          winner: 1,
        })}</table>`,
        { headers: { "content-type": "text/html" } },
      );

    const program = buildJsonProgram();
    await program.parseAsync(
      [
        "fabtcg",
        "coverage",
        "pro-tour-example",
        "--search-player",
        "Nobody",
        "--json",
      ],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.searchMatches).toEqual([]);
    expect(parsed).not.toHaveProperty("path");
  });

  it("fabtcg coverage <event> --search-player <name> --json auto-runs path for a single match, emitting { searchMatches, path }", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      })
      .persist();
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/results/1/",
        method: "GET",
      })
      .reply(
        200,
        `<table>${matchRow({
          player1: "Alice",
          player1Hero: "Dorinthea",
          player2: "Bob",
          player2Hero: "Prism",
          winner: 1,
        })}</table>`,
        { headers: { "content-type": "text/html" } },
      )
      .persist();

    const program = buildJsonProgram();
    await program.parseAsync(
      [
        "fabtcg",
        "coverage",
        "pro-tour-example",
        "--search-player",
        "Alice",
        "--json",
      ],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.searchMatches).toEqual([
      { name: "Alice", hero: "Dorinthea" },
    ]);
    expect(parsed.path).toBeTruthy();
    expect(parsed.path.player).toBe("Alice");
  });

  it("fabtcg coverage <event> --search-player <name> --json emits only { searchMatches } (no path key) when multiple match", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/coverage/pro-tour-example/results/1/",
        method: "GET",
      })
      .reply(
        200,
        `<table>${matchRow({
          player1: "Alice One",
          player1Hero: "Dorinthea",
          player2: "Alice Two",
          player2Hero: "Prism",
          winner: 1,
        })}</table>`,
        { headers: { "content-type": "text/html" } },
      );

    const program = buildJsonProgram();
    await program.parseAsync(
      [
        "fabtcg",
        "coverage",
        "pro-tour-example",
        "--search-player",
        "Alice",
        "--json",
      ],
      { from: "user" },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.searchMatches).toHaveLength(2);
    expect(parsed).not.toHaveProperty("path");
  });
});
