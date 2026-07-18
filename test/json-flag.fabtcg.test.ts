import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildJsonProgram } from "./helpers/jsonProgram";
import {
  installHttpMock,
  restoreHttpMock,
  mockPool,
  type MockAgentHandle,
} from "./helpers/http-mock";

const ANSI_RE = /\x1b\[/;

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
    await program.parseAsync(["fabtcg", "coverage", "pro-tour-example", "--json"], {
      from: "user",
    });

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
      .reply(200, COVERAGE_INDEX_HTML, { headers: { "content-type": "text/html" } });
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/standings/1/", method: "GET" })
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
      .reply(200, COVERAGE_INDEX_HTML, { headers: { "content-type": "text/html" } });
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/standings/1/", method: "GET" })
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
    expect(parsed.field.every((r: { hero: string }) => r.hero === "Dorinthea")).toBe(
      true,
    );
    expect(parsed).not.toHaveProperty("standings");
  });

  it("fabtcg coverage <event> --round <n> --field --json combines both sections in one object", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, { headers: { "content-type": "text/html" } });
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/standings/1/", method: "GET" })
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
});
