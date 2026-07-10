import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchCoverageIndex } from "../src/fabtcg";
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

describe("fetchCoverageIndex (offline, HTTP mocked)", () => {
  let mock: MockAgentHandle;

  beforeEach(() => {
    mock = installHttpMock();
  });

  afterEach(() => restoreHttpMock(mock));

  it("parses a captured coverage page fully offline", async () => {
    const html = readFixture("coverage-index.pro-tour-example.html");
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/coverage/pro-tour-example/", method: "GET" })
      .reply(200, html, { headers: { "content-type": "text/html" } });

    const result = await fetchCoverageIndex("pro-tour-example");

    expect(result.slug).toBe("pro-tour-example");
    expect(result.title).toBe("Pro Tour Example Coverage");
    expect(result.standingRounds).toEqual([1, 2]);
    expect(result.resultRounds).toEqual([1, 2, 3]);
    expect(result.hasFinalStandings).toBe(true);
  });

  it("fails loudly (does not hang or hit the real network) when a request is unmocked", async () => {
    // No interceptor registered for this slug at all — net connect is disabled
    // globally by installHttpMock(), so the underlying fetch must reject
    // immediately with undici's "mock not matched / net connect disabled"
    // error rather than silently succeeding or hitting the real fabtcg.com.
    let caught: unknown;
    try {
      await fetchCoverageIndex("totally-unmocked-slug");
      throw new Error(
        "expected fetchCoverageIndex to reject for an unmocked request",
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { cause?: unknown };
    const message = `${err.message} ${err.cause instanceof Error ? err.cause.message : ""}`;
    expect(message).toMatch(
      /mock dispatch not matched|net\.?connect disabled|fetch failed/i,
    );
  });
});
