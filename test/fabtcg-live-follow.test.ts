import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runLiveFollow } from "../src/fabtcg";
import {
  installHttpMock,
  restoreHttpMock,
  mockPool,
  type MockAgentHandle,
} from "./helpers/http-mock";

const SLUG = "pro-tour-example";

function indexHtml(opts: {
  resultRounds: number[];
  standingRounds: number[];
  hasFinal: boolean;
}): string {
  const standingsLis = opts.standingRounds
    .map(
      (r) =>
        `<li><a href="/coverage/${SLUG}/standings/${r}/">Round ${r}</a></li>`,
    )
    .join("\n");
  const finalLi = opts.hasFinal
    ? `<li><a href="/coverage/${SLUG}/final-standings/">Final Standings</a></li>`
    : "";
  const resultsLis = opts.resultRounds
    .map(
      (r) =>
        `<li><a href="/coverage/${SLUG}/results/${r}/">Round ${r}</a></li>`,
    )
    .join("\n");
  return `<!doctype html><html><head><title>Pro Tour Example Coverage | Flesh and Blood TCG</title></head>
  <body><article><h1 class="entry-title">Pro Tour Example Coverage</h1>
  <div class="coverage-nav">
    <p>Standings:</p><ul>${standingsLis}${finalLi}</ul>
    <p>Results:</p><ul>${resultsLis}</ul>
  </div></article></body></html>`;
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

function resultsHtml(rows: string[]): string {
  return `<table>${rows.join("\n")}</table>`;
}

function standingsHtml(rows: Array<[number, string, string, number]>): string {
  const trs = rows
    .map(
      ([rank, player, hero, wins]) =>
        `<tr><td>${rank}</td><td>${player}</td><td>${hero}</td><td>${wins}</td></tr>`,
    )
    .join("\n");
  return `<table>${trs}</table>`;
}

describe("runLiveFollow (offline, HTTP mocked, fake timers)", () => {
  let mock: MockAgentHandle;

  beforeEach(async () => {
    mock = installHttpMock();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await restoreHttpMock(mock);
  });

  it("seeds from the initial player path, then a new round appearing on a tick calls onUpdate exactly once with the correct content", async () => {
    // Seed: fetchPlayerPath internally hits the index page twice (direct +
    // format schedule) and round 1's pairings.
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: false }),
        { headers: { "content-type": "text/html" } },
      )
      .times(2);
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Dorinthea",
            player2: "Bob",
            player2Hero: "Prism",
            winner: 1,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );

    // First (real) poll tick: index now shows round 2 as well.
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({
          resultRounds: [1, 2],
          standingRounds: [1, 2],
          hasFinal: false,
        }),
        { headers: { "content-type": "text/html" } },
      );
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/2/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Dorinthea",
            player2: "Carol",
            player2Hero: "Iyslander",
            winner: 2,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );

    const onUpdate = vi.fn();
    const onFinal = vi.fn();
    const controller = new AbortController();

    const resultPromise = runLiveFollow(SLUG, "Alice", {
      onUpdate,
      onFinal,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const line = onUpdate.mock.calls[0][0] as string;
    expect(line).toMatch(/Round 2/);
    expect(line).toMatch(/Carol/);
    expect(line).toMatch(/Iyslander/);
    expect(line).toMatch(/L/); // Alice was player1, winner 2 -> loss

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;
    expect(result).toEqual({ reason: "aborted" });
    expect(onFinal).not.toHaveBeenCalled();
  });

  it("a tick with no new rounds calls onUpdate zero times", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: false }),
        { headers: { "content-type": "text/html" } },
      )
      .times(2);
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Dorinthea",
            player2: "Bob",
            player2Hero: "Prism",
            winner: 1,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );
    // Poll tick sees the SAME index — unchanged.
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: false }),
        { headers: { "content-type": "text/html" } },
      );

    const onUpdate = vi.fn();
    const onFinal = vi.fn();
    const controller = new AbortController();

    const resultPromise = runLiveFollow(SLUG, "Alice", {
      onUpdate,
      onFinal,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUpdate).not.toHaveBeenCalled();

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await resultPromise;
  });

  it("hasFinalStandings flipping true calls onFinal exactly once with the correct summary and resolves with reason final-standings, with no further ticks", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: false }),
        { headers: { "content-type": "text/html" } },
      )
      .times(2);
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Dorinthea",
            player2: "Bob",
            player2Hero: "Prism",
            winner: 1,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: true }),
        { headers: { "content-type": "text/html" } },
      );
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/final-standings/`, method: "GET" })
      .reply(200, standingsHtml([[3, "Alice", "Dorinthea", 6]]), {
        headers: { "content-type": "text/html" },
      });

    const onUpdate = vi.fn();
    const onFinal = vi.fn();
    const controller = new AbortController();

    const resultPromise = runLiveFollow(SLUG, "Alice", {
      onUpdate,
      onFinal,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await resultPromise;

    expect(onFinal).toHaveBeenCalledTimes(1);
    const summary = onFinal.mock.calls[0][0] as string;
    expect(summary).toMatch(/Alice/);
    expect(summary).toMatch(/rank 3|3/);
    expect(summary).toMatch(/6/);
    expect(result).toEqual({ reason: "final-standings" });

    // No further ticks — advancing more time should not trigger extra fetches.
    await vi.advanceTimersByTimeAsync(120_000);
  });

  it("aborting mid-wait resolves promptly with reason aborted, without waiting out the full remaining interval", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: false }),
        { headers: { "content-type": "text/html" } },
      )
      .times(2);
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Dorinthea",
            player2: "Bob",
            player2Hero: "Prism",
            winner: 1,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );

    const onUpdate = vi.fn();
    const onFinal = vi.fn();
    const controller = new AbortController();

    const resultPromise = runLiveFollow(SLUG, "Alice", {
      onUpdate,
      onFinal,
      signal: controller.signal,
    });

    // Halfway through the (real default) 60s interval — well before the
    // first tick would naturally fire.
    await vi.advanceTimersByTimeAsync(30_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    const result = await resultPromise;
    expect(result).toEqual({ reason: "aborted" });
    // No index re-fetch (2nd registered index interceptor) or final-standings
    // interceptor was needed — proven by restoreHttpMock's pending-interceptor
    // assertion below only counting the seed's 2 index calls.
  });

  it("aborting mid-tick, right after the index fetch resolves but before round-pairings fetching starts, returns aborted promptly instead of finishing the whole tick", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: false }),
        { headers: { "content-type": "text/html" } },
      )
      .times(2);
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Dorinthea",
            player2: "Bob",
            player2Hero: "Prism",
            winner: 1,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );

    const controller = new AbortController();

    // The poll tick's index fetch reports a new round 2 — but aborts the
    // signal as a side effect of resolving, simulating Ctrl-C landing right
    // between the index fetch and the round-pairings fetch it would trigger.
    // No interceptor for round 2's pairings is registered: if the abort
    // check between fetches is missing, the loop presses on into fetching
    // round 2 pairings and this test fails loudly (net connect disabled)
    // instead of resolving with {reason: "aborted"}.
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(() => {
        controller.abort();
        return {
          statusCode: 200,
          data: indexHtml({
            resultRounds: [1, 2],
            standingRounds: [1, 2],
            hasFinal: false,
          }),
          headers: { "content-type": "text/html" },
        };
      });

    const onUpdate = vi.fn();
    const onFinal = vi.fn();

    const resultPromise = runLiveFollow(SLUG, "Alice", {
      onUpdate,
      onFinal,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(60_000);

    const result = await resultPromise;
    expect(result).toEqual({ reason: "aborted" });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("resolves ambiguity via searchPlayerInEvent semantics: round diffing is format-agnostic across a dual-format event (a player's hero changes between rounds)", async () => {
    // Round 1 (e.g. Classic Constructed) then round 2 (e.g. Silver Age) —
    // same player, different hero — round-diffing must not special-case this.
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({ resultRounds: [1], standingRounds: [1], hasFinal: false }),
        { headers: { "content-type": "text/html" } },
      )
      .times(2);
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/1/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Teklovossen, Esteemed Magnate",
            player2: "Bob",
            player2Hero: "Prism",
            winner: 1,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/`, method: "GET" })
      .reply(
        200,
        indexHtml({
          resultRounds: [1, 2],
          standingRounds: [1, 2],
          hasFinal: false,
        }),
        { headers: { "content-type": "text/html" } },
      );
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: `/coverage/${SLUG}/results/2/`, method: "GET" })
      .reply(
        200,
        resultsHtml([
          matchRow({
            player1: "Alice",
            player1Hero: "Iyslander, Stormbind",
            player2: "Dave",
            player2Hero: "Levia",
            winner: 1,
          }),
        ]),
        { headers: { "content-type": "text/html" } },
      );

    const onUpdate = vi.fn();
    const controller = new AbortController();
    const resultPromise = runLiveFollow(SLUG, "Alice", {
      onUpdate,
      onFinal: vi.fn(),
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const line = onUpdate.mock.calls[0][0] as string;
    expect(line).toMatch(/Round 2/);
    expect(line).toMatch(/Dave/);
    expect(line).toMatch(/Levia/);
    expect(line).toMatch(/W/);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await resultPromise;
  });
});
