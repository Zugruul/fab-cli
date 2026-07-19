import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildJsonProgram } from "./helpers/jsonProgram";
import {
  installHttpMock,
  restoreHttpMock,
  mockPool,
  type MockAgentHandle,
} from "./helpers/http-mock";

const SLUG = "pro-tour-example";

const COVERAGE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head><title>Pro Tour Example Coverage | Flesh and Blood TCG</title></head>
  <body>
    <article>
      <h1 class="entry-title">Pro Tour Example Coverage</h1>
      <div class="coverage-nav">
        <p>Standings:</p>
        <ul>
          <li><a href="/coverage/${SLUG}/standings/1/">Round 1</a></li>
        </ul>
        <p>Results:</p>
        <ul>
          <li><a href="/coverage/${SLUG}/results/1/">Round 1</a></li>
        </ul>
      </div>
    </article>
  </body>
</html>`;

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

describe("fabtcg coverage --path --live (CLI wiring)", () => {
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

  it("ambiguous player under --live prints candidates and exits without ever starting the poll loop (no extra coverage-index fetch)", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
      .reply(
        200,
        `<table>${matchRow({
          player1: "Alice Anderson",
          player1Hero: "Dorinthea",
          player2: "Alice Bishop",
          player2Hero: "Prism",
          winner: 1,
        })}</table>`,
        { headers: { "content-type": "text/html" } },
      );

    const program = buildJsonProgram();
    // Both mocked interceptors are registered exactly once (no `.persist()`);
    // if the live loop had started it would need a further coverage-index
    // fetch (unmocked → throws), which `restoreHttpMock`'s pending-interceptor
    // assertion also guards against either way.
    await program.parseAsync(
      ["fabtcg", "coverage", SLUG, "--path", "Alice", "--live"],
      { from: "user" },
    );

    const out = logs.join("\n");
    expect(out).toMatch(/2\s+players found/i);
    expect(out).toMatch(/Alice Anderson/);
    expect(out).toMatch(/Alice Bishop/);
  });

  it("--live with no --path/--search-player prints a usage error and exits without fetching pairings", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });

    const program = buildJsonProgram();
    await program.parseAsync(["fabtcg", "coverage", SLUG, "--live"], {
      from: "user",
    });

    const out = logs.join("\n");
    expect(out).toMatch(/--live requires --path or --search-player/);
  });

  it("--live combined with --json prints a rejection and never starts the poll loop or emits JSON", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      });

    const program = buildJsonProgram();
    // No interceptor is registered for /results/1/ or a second index fetch:
    // if the loop actually started (guard missing), this would fail loudly
    // via the unmatched-mock assertion, same as the ambiguous-player test.
    await program.parseAsync(
      ["fabtcg", "coverage", SLUG, "--path", "Alice", "--live", "--json"],
      { from: "user" },
    );

    const out = logs.join("\n");
    expect(out).toMatch(
      /--live.*not combinable with --json|--json.*not combinable with --live/i,
    );
    expect(out).not.toMatch(/^\{/);
  });

  it("--live with a single resolved match prints the static summary, then a live update line on the first tick, then stops cleanly on SIGINT", async () => {
    const tmpCacheDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "fab-cli-live-cli-cache-"),
    );
    vi.stubEnv("FAB_HTTP_CACHE_DIR", tmpCacheDir);

    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(200, COVERAGE_INDEX_HTML, {
        headers: { "content-type": "text/html" },
      })
      .persist();
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
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

    vi.useFakeTimers();
    const program = buildJsonProgram();
    const runPromise = program.parseAsync(
      [
        "fabtcg",
        "coverage",
        SLUG,
        "--path",
        "Alice",
        "--live",
        "--interval",
        "60",
      ],
      { from: "user" },
    );

    // Let the ambiguity check + initial summary fetches settle, then let the
    // first (unchanged) tick fire, then simulate Ctrl-C.
    await vi.advanceTimersByTimeAsync(60_000);
    process.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(0);
    await runPromise;
    vi.useRealTimers();

    const out = logs.join("\n");
    expect(out).toMatch(/Watching for live updates/);
    expect(out).toMatch(/Stopped/);

    await fs.promises.rm(tmpCacheDir, { recursive: true, force: true });
  });
});
