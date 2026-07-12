import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  fetchEurUsdRate,
  eurToUsd,
  usdToEur,
  isFxError,
  FxHttpError,
  FxDataError,
  type FxRate,
  type FetchFn,
} from "../../src/pricing/fx";

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "pricing", "fx");

function loadFixture(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"),
  );
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function fetchFnReturning(fixtureName: string): FetchFn {
  const fixture = loadFixture(fixtureName);
  return async () => jsonResponse(fixture);
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "fab-cli-fx-"));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("fetchEurUsdRate", () => {
  it("parses a valid frankfurter response into {rate, date, base, quote}", async () => {
    const fetchFn = fetchFnReturning("latest");

    const fx = await fetchEurUsdRate({ cacheDir: tmpDir, fetchFn });

    expect(fx).toEqual({
      rate: 1.0873,
      date: "2026-07-10",
      base: "EUR",
      quote: "USD",
    });
  });

  it("hits the cache on a second call and never re-invokes fetchFn", async () => {
    const fetchFn = vi.fn(fetchFnReturning("latest"));

    await fetchEurUsdRate({ cacheDir: tmpDir, fetchFn });
    const callsAfterFirst = fetchFn.mock.calls.length;
    await fetchEurUsdRate({ cacheDir: tmpDir, fetchFn });

    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);
  });

  it("--refresh bypasses the cache and calls fetchFn again", async () => {
    const fetchFn = vi.fn(fetchFnReturning("latest"));

    await fetchEurUsdRate({ cacheDir: tmpDir, fetchFn });
    const callsAfterFirst = fetchFn.mock.calls.length;
    await fetchEurUsdRate({ cacheDir: tmpDir, fetchFn, refresh: true });

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  describe("retry / backoff (SPEC-PRICE §6.4 sibling parity)", () => {
    it("retries once on 429 then succeeds", async () => {
      const fixture = loadFixture("latest");
      let calls = 0;
      const fetchFn: FetchFn = vi.fn(async () => {
        calls++;
        if (calls === 1) return jsonResponse({}, 429);
        return jsonResponse(fixture);
      });

      const fx = await fetchEurUsdRate({
        cacheDir: tmpDir,
        fetchFn,
        retryBaseMs: 1,
      });

      expect(fx.rate).toBe(1.0873);
      expect(calls).toBe(2);
    });

    it("retries on 5xx up to the attempt cap then throws a typed FxHttpError", async () => {
      const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 503));

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
      ).rejects.toThrow(FxHttpError);

      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it("does not retry on a non-retryable 4xx status", async () => {
      const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 404));

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
      ).rejects.toThrow(FxHttpError);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("a fetcher error propagates and is not cached (nothing written to disk)", async () => {
      const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 500));

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
      ).rejects.toThrow();

      expect(fs.existsSync(path.join(tmpDir, "fx-eur-usd.json"))).toBe(false);
    });
  });

  describe("malformed payloads -> typed FxDataError (no throw-through)", () => {
    it("rejects with FxDataError when the rates key is missing entirely", async () => {
      const fetchFn = fetchFnReturning("missing-rates-key");

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn }),
      ).rejects.toThrow(FxDataError);
    });

    it("rejects with FxDataError when rates is present but has no USD key", async () => {
      const fetchFn = fetchFnReturning("rates-without-usd");

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn }),
      ).rejects.toThrow(FxDataError);
    });

    it("rejects with FxDataError when USD is present but non-numeric", async () => {
      const fetchFn = fetchFnReturning("non-numeric-usd");

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn }),
      ).rejects.toThrow(FxDataError);
    });

    it("rejects with FxDataError (not a raw TypeError) when the response body is null", async () => {
      const fetchFn: FetchFn = async () => jsonResponse(null);

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn }),
      ).rejects.toThrow(FxDataError);

      try {
        await fetchEurUsdRate({ cacheDir: tmpDir, fetchFn, refresh: true });
        throw new Error("expected fetchEurUsdRate to reject");
      } catch (e) {
        expect(isFxError(e)).toBe(true);
      }
    });

    it("rejects with FxDataError when the response body is a non-object primitive", async () => {
      const fetchFn: FetchFn = async () => jsonResponse("not-an-object");

      await expect(
        fetchEurUsdRate({ cacheDir: tmpDir, fetchFn }),
      ).rejects.toThrow(FxDataError);
    });
  });
});

describe("isFxError", () => {
  it("is true for FxHttpError", () => {
    expect(isFxError(new FxHttpError("http://x", 503))).toBe(true);
  });

  it("is true for FxDataError", () => {
    expect(isFxError(new FxDataError("missing rates.USD"))).toBe(true);
  });

  it("is false for an unrelated Error", () => {
    expect(isFxError(new Error("boom"))).toBe(false);
  });

  it("is false for a non-error value", () => {
    expect(isFxError("boom")).toBe(false);
  });
});

describe("eurToUsd / usdToEur", () => {
  const fx: FxRate = {
    rate: 1.0873,
    date: "2026-07-10",
    base: "EUR",
    quote: "USD",
  };

  it("converts EUR to USD, rounded to 2 decimals", () => {
    expect(eurToUsd(10, fx)).toBe(10.87);
  });

  it("converts USD to EUR, rounded to 2 decimals", () => {
    expect(usdToEur(10.87, fx)).toBeCloseTo(10, 1);
  });

  it("round-trips within rounding tolerance", () => {
    const usd = eurToUsd(100, fx);
    const eur = usdToEur(usd, fx);
    expect(eur).toBeCloseTo(100, 0);
  });
});
