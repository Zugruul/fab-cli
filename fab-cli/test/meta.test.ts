import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeMetaShift,
  resolveMetaFormat,
  resolveMetaPeriod,
} from "../src/meta";

// content.fabrary.net JSON shape: { heroResults: [{ heroIdentifier, results: [{ opposingHeroIdentifier, plays, wins }] }] }
function fabraryPayload(
  heroes: Array<{
    hero: string;
    matchups: Array<{ opponent: string; plays: number; wins: number }>;
  }>,
) {
  return {
    heroResults: heroes.map((h) => ({
      heroIdentifier: h.hero,
      results: h.matchups.map((m) => ({
        opposingHeroIdentifier: m.opponent,
        plays: m.plays,
        wins: m.wins,
      })),
    })),
  };
}

function mockFetchByPeriod(payloads: {
  "last-7-days": unknown;
  "last-30-days": unknown;
}) {
  return vi
    .spyOn(global, "fetch")
    .mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      const period = u.includes("last-7-days") ? "last-7-days" : "last-30-days";
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => payloads[period],
      } as Response;
    });
}

describe("resolveMetaFormat / resolveMetaPeriod (alias resolution)", () => {
  it("resolves short format aliases to fabrary URL slugs", () => {
    expect(resolveMetaFormat("cc")).toBe("classic-constructed");
    expect(resolveMetaFormat("sa")).toBe("silver-age");
    expect(resolveMetaFormat("ll")).toBe("living-legend");
    expect(resolveMetaFormat("upf")).toBe("ultimate-pit-fight");
  });

  it("resolves full format names to the same slugs, case-insensitively", () => {
    expect(resolveMetaFormat("Classic Constructed")).toBe(
      "classic-constructed",
    );
    expect(resolveMetaFormat("SILVER AGE")).toBe("silver-age");
  });

  it("passes through an unrecognized format as its lowercased/trimmed self", () => {
    expect(resolveMetaFormat("  Draft ")).toBe("draft");
  });

  it("resolves period shorthand and passes through everything else unchanged", () => {
    expect(resolveMetaPeriod("7d")).toBe("last-7-days");
    expect(resolveMetaPeriod("30d")).toBe("last-30-days");
    expect(resolveMetaPeriod("2026-04")).toBe("2026-04");
    expect(resolveMetaPeriod("holiday-clash")).toBe("holiday-clash");
  });
});

describe("computeMetaShift — momentum + adjustment math", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("computes momentum as winRate7d - winRate30d for a hero present in both windows", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        {
          hero: "dorinthea-ironsong",
          matchups: [{ opponent: "prism", plays: 20, wins: 14 }],
        }, // 70%
      ]),
      "last-30-days": fabraryPayload([
        {
          hero: "dorinthea-ironsong",
          matchups: [{ opponent: "prism", plays: 80, wins: 40 }],
        }, // 50%
      ]),
    });

    const rows = await computeMetaShift({ format: "cc" });
    const row = rows.find((r) => r.hero === "dorinthea-ironsong")!;
    expect(row.winRate7d).toBeCloseTo(0.7);
    expect(row.winRate30d).toBeCloseTo(0.5);
    expect(row.momentum).toBeCloseTo(0.2);
    expect(row.games7d).toBe(20);
    expect(row.games30d).toBe(80);
  });

  it("handles a hero with 0 games in one window (new hero, or one that disappeared)", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        {
          hero: "brand-new-hero",
          matchups: [{ opponent: "prism", plays: 5, wins: 3 }],
        },
      ]),
      "last-30-days": fabraryPayload([]), // no data at all 30 days back
    });

    const rows = await computeMetaShift({ format: "cc" });
    const row = rows.find((r) => r.hero === "brand-new-hero")!;
    expect(row.games30d).toBe(0);
    expect(row.winRate30d).toBe(0); // no divide-by-zero NaN
    expect(row.winRate7d).toBeCloseTo(0.6);
    expect(row.momentum).toBeCloseTo(0.6); // 0.6 - 0
  });

  it("excludes a banned hero entirely from the results", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        { hero: "banned-hero", matchups: [] },
        {
          hero: "prism",
          matchups: [{ opponent: "banned-hero", plays: 10, wins: 4 }],
        },
      ]),
      "last-30-days": fabraryPayload([
        { hero: "banned-hero", matchups: [] },
        {
          hero: "prism",
          matchups: [{ opponent: "banned-hero", plays: 40, wins: 16 }],
        },
      ]),
    });

    const rows = await computeMetaShift({ format: "cc", ban: ["banned-hero"] });
    expect(rows.find((r) => r.hero === "banned-hero")).toBeUndefined();
  });

  it("boosts adjustedWinRate for a hero that struggled against a now-banned hero", async () => {
    // prism went 4/10 (40%) vs banned-hero on at least 3 games -> should get a boost
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        { hero: "banned-hero", matchups: [] },
        {
          hero: "prism",
          matchups: [
            { opponent: "banned-hero", plays: 10, wins: 4 },
            { opponent: "other-hero", plays: 10, wins: 5 },
          ],
        },
      ]),
      "last-30-days": fabraryPayload([{ hero: "prism", matchups: [] }]),
    });

    const rows = await computeMetaShift({ format: "cc", ban: ["banned-hero"] });
    const prism = rows.find((r) => r.hero === "prism")!;
    // wr7 = 9/20 = 0.45; lossRate vs banned = 0.6, share = 10/20 = 0.5, boost = 0.6*0.5*0.8 = 0.24
    expect(prism.adjustedWinRate).toBeGreaterThan(prism.winRate7d);
    expect(prism.adjustedWinRate).toBeCloseTo(Math.min(1, 0.45 + 0.24));
  });

  it("applies a flat -0.06 penalty to a nerfed hero's adjustedWinRate, clamped to [0,1]", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        {
          hero: "nerfed-hero",
          matchups: [{ opponent: "prism", plays: 10, wins: 1 }],
        }, // wr7 = 0.1
      ]),
      "last-30-days": fabraryPayload([]),
    });

    const rows = await computeMetaShift({
      format: "cc",
      nerf: ["nerfed-hero"],
    });
    const row = rows.find((r) => r.hero === "nerfed-hero")!;
    expect(row.winRate7d).toBeCloseTo(0.1);
    // clamped at 0 since 0.1 - 0.06 = 0.04 > 0, so no clamping needed here; verify exact value
    expect(row.adjustedWinRate).toBeCloseTo(0.04);
  });

  it("clamps adjustedWinRate to 0 when the nerf penalty would push it negative", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        {
          hero: "barely-winning-hero",
          matchups: [{ opponent: "prism", plays: 10, wins: 0 }],
        }, // wr7 = 0
      ]),
      "last-30-days": fabraryPayload([]),
    });

    const rows = await computeMetaShift({
      format: "cc",
      nerf: ["barely-winning-hero"],
    });
    const row = rows.find((r) => r.hero === "barely-winning-hero")!;
    expect(row.adjustedWinRate).toBe(0);
  });

  it("excludes heroes listed in --exclude without affecting others", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        {
          hero: "hidden-hero",
          matchups: [{ opponent: "prism", plays: 10, wins: 5 }],
        },
        {
          hero: "visible-hero",
          matchups: [{ opponent: "prism", plays: 10, wins: 5 }],
        },
      ]),
      "last-30-days": fabraryPayload([]),
    });

    const rows = await computeMetaShift({
      format: "cc",
      exclude: ["hidden-hero"],
    });
    expect(rows.find((r) => r.hero === "hidden-hero")).toBeUndefined();
    expect(rows.find((r) => r.hero === "visible-hero")).toBeDefined();
  });

  it("returns an empty array when both windows have no data at all", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([]),
      "last-30-days": fabraryPayload([]),
    });
    const rows = await computeMetaShift({ format: "cc" });
    expect(rows).toEqual([]);
  });

  it("sorts results by adjustedWinRate descending", async () => {
    mockFetchByPeriod({
      "last-7-days": fabraryPayload([
        { hero: "low", matchups: [{ opponent: "x", plays: 10, wins: 2 }] },
        { hero: "high", matchups: [{ opponent: "x", plays: 10, wins: 9 }] },
        { hero: "mid", matchups: [{ opponent: "x", plays: 10, wins: 5 }] },
      ]),
      "last-30-days": fabraryPayload([]),
    });
    const rows = await computeMetaShift({ format: "cc" });
    expect(rows.map((r) => r.hero)).toEqual(["high", "mid", "low"]);
  });
});
