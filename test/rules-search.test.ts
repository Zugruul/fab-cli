import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  installHttpMock,
  restoreHttpMock,
  mockPool,
  type MockAgentHandle,
} from "./helpers/http-mock";

const FIXTURES = path.join(__dirname, "fixtures", "rules");

vi.mock("../src/rulesDocs", async () => {
  const actual =
    await vi.importActual<typeof import("../src/rulesDocs")>(
      "../src/rulesDocs",
    );
  return { ...actual, updateRulesDocs: vi.fn().mockResolvedValue([]) };
});

import {
  syncRules,
  searchRules,
  showRulesChunk,
  resolveRulesRef,
  refreshLegality,
  matchRulesChunks,
  rankRulesChunks,
  slugSection,
  rebuildIndex,
  type RulesChunk,
} from "../src/rules";
import { updateRulesDocs } from "../src/rulesDocs";

const LEGALITY_HTML = () =>
  fs.readFileSync(path.join(FIXTURES, "legality-page.html"), "utf8");

describe("slugSection (exported for FAB-021 ref resolution)", () => {
  it("slugifies a section string", () => {
    expect(slugSection("1.1")).toBe("1-1");
    expect(slugSection("A player has an illegal deck")).toBe(
      "a-player-has-an-illegal-deck",
    );
  });
});

describe("rankRulesChunks — term-overlap ranking (pure, no I/O)", () => {
  const chunks: RulesChunk[] = [
    {
      document: "CR",
      section: "1.1",
      title: "Players",
      sourceUrl: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt",
      version: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      text: "A player is a person participating in the game.",
    },
    {
      document: "TRP",
      section: "1",
      title: "Tournament Information",
      sourceUrl: "https://rules.fabtcg.com/txt/latest/en-fab-trp.txt",
      version: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      text: "Tournaments comprise formats and rounds.",
    },
  ];

  it("ranks the chunk whose title+text matches more query terms first", () => {
    const results = rankRulesChunks(chunks, "player person", 8);
    expect(results[0].section).toBe("1.1");
  });

  it("returns an empty array for a query with only stopwords/no terms", () => {
    expect(rankRulesChunks(chunks, "the a", 8)).toEqual([]);
  });

  it("respects the limit", () => {
    const results = rankRulesChunks(chunks, "tournament player", 1);
    expect(results.length).toBe(1);
  });
});

describe("matchRulesChunks — ref resolution (pure, no I/O)", () => {
  const chunks: RulesChunk[] = [
    {
      document: "CR",
      section: "1.1",
      title: "Players",
      sourceUrl: "u",
      version: "v1",
      fetchedAt: "t",
      text: "text",
    },
    {
      document: "CPG",
      section: "a-player-has-an-illegal-deck",
      title: "A player has an illegal deck",
      sourceUrl: "u",
      version: "v1",
      fetchedAt: "t",
      text: "text",
    },
  ];

  it("resolves <document>/<section> case-insensitively", () => {
    const m = matchRulesChunks(chunks, "cr/1.1");
    expect(m.length).toBe(1);
    expect(m[0].document).toBe("CR");
  });

  it("resolves a bare slug matching a chunk's slugified section", () => {
    const m = matchRulesChunks(chunks, "a-player-has-an-illegal-deck");
    expect(m.length).toBe(1);
    expect(m[0].document).toBe("CPG");
  });

  it("returns no matches for an unknown ref", () => {
    expect(matchRulesChunks(chunks, "cr/9.9")).toEqual([]);
  });
});

describe("searchRules / showRulesChunk — TTL refresh + legality-live", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;
  let rulesDir: string;
  let cpgPdfPath: string;

  beforeEach(() => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-rules-search-"));
    kbDir = path.join(tmpRoot, "kb", "rules");
    rulesDir = path.join(tmpRoot, "fab-rules-src");
    cpgPdfPath = path.join(FIXTURES, "cpg-fixture.pdf");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, "en-fab-cr.txt"),
      "1 Preface\nComprehensive Rules preface text.\n1.1 Players\nA player is a person.\n",
    );
    fs.writeFileSync(
      path.join(rulesDir, "en-fab-trp.txt"),
      "1 Tournament Information\nTournaments comprise formats.\n",
    );
    fs.writeFileSync(
      path.join(rulesDir, "en-fab-ppg.txt"),
      "1 General\nThis guide covers infractions.\n",
    );
    fs.writeFileSync(
      path.join(rulesDir, "VERSIONS.txt"),
      "en-fab-cr.txt  last-modified: Wed, 10 Jun 2026 19:43:38 GMT  lines: 4\n" +
        "en-fab-trp.txt  last-modified: Wed, 10 Jun 2026 19:43:38 GMT  lines: 2\n" +
        "en-fab-ppg.txt  last-modified: Wed, 10 Jun 2026 19:43:38 GMT  lines: 2\n",
    );
    vi.mocked(updateRulesDocs).mockClear();
  });

  afterEach(async () => {
    await restoreHttpMock(mock);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function mockLegalityOnce(): void {
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(200, LEGALITY_HTML());
  }

  async function buildFreshKb(): Promise<void> {
    mockLegalityOnce();
    await syncRules({ kbDir, rulesDir, cpgPdfPath });
  }

  it("offline search: a fresh KB + a non-legality query never touches the network", async () => {
    await buildFreshKb();
    // No interceptors registered below — any fetch attempt would throw.
    const results = await searchRules("player", { kbDir, ttlMs: 999_999_999 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((c) => c.document === "CR")).toBe(true);
  });

  it("stale/missing index triggers a full refresh via syncRules() before searching", async () => {
    // No index.json at all yet == infinitely stale (mirrors lore.ts).
    mockLegalityOnce();
    const results = await searchRules("player", {
      kbDir,
      rulesDir,
      cpgPdfPath,
      ttlMs: 999_999_999,
    });
    expect(updateRulesDocs).toHaveBeenCalledTimes(1);
    expect(results.some((c) => c.document === "CR")).toBe(true);
  });

  it("a stale index older than the TTL triggers a refresh even when it exists", async () => {
    await buildFreshKb();
    // Force builtAt into the past directly in the index file.
    const idxPath = path.join(kbDir, "index.json");
    const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
    idx.builtAt = new Date(Date.now() - 999_999_999).toISOString();
    fs.writeFileSync(idxPath, JSON.stringify(idx));
    vi.mocked(updateRulesDocs).mockClear();

    mockLegalityOnce();
    await searchRules("player", { kbDir, rulesDir, cpgPdfPath, ttlMs: 1000 });
    expect(updateRulesDocs).toHaveBeenCalledTimes(1);
  });

  it("a legality-touching search hits the network live, every single call across multiple calls — counts exactly one fetch per call (mock call-count assertion)", async () => {
    await buildFreshKb();
    let calls = 0;
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(() => {
        calls++;
        return { statusCode: 200, data: LEGALITY_HTML() };
      })
      .persist();

    await searchRules("legend", { kbDir, ttlMs: 999_999_999 });
    expect(calls).toBe(1);
    await searchRules("legend", { kbDir, ttlMs: 999_999_999 });
    expect(calls).toBe(2);
    await searchRules("legend", { kbDir, ttlMs: 999_999_999 });
    expect(calls).toBe(3);
  });

  it("does not double-fetch legality within one invocation when the TTL path already ran a full sync", async () => {
    // Missing index == stale, triggers syncRules() (which itself refreshes legality once).
    // A legality-touching result from that same call must NOT trigger a second fetch.
    let calls = 0;
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(() => {
        calls++;
        return { statusCode: 200, data: LEGALITY_HTML() };
      })
      .persist();

    const results = await searchRules("legend", {
      kbDir,
      rulesDir,
      cpgPdfPath,
      ttlMs: 999_999_999,
    });
    expect(results.some((c) => c.document === "legality")).toBe(true);
    expect(calls).toBe(1);
  });

  it("offline show: a fresh KB + a non-legality ref never touches the network", async () => {
    await buildFreshKb();
    const chunk = await showRulesChunk("cr/1.1", { kbDir, ttlMs: 999_999_999 });
    expect(chunk?.document).toBe("CR");
    expect(chunk?.section).toBe("1.1");
  });

  it("show on a legality ref refreshes legality live", async () => {
    await buildFreshKb();
    let calls = 0;
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(() => {
        calls++;
        return { statusCode: 200, data: LEGALITY_HTML() };
      })
      .persist();

    const chunk = await showRulesChunk("legality/current", {
      kbDir,
      ttlMs: 999_999_999,
    });
    expect(chunk?.document).toBe("legality");
    expect(calls).toBe(1);
    await showRulesChunk("legality/current", { kbDir, ttlMs: 999_999_999 });
    expect(calls).toBe(2);
  });

  it("resolveRulesRef returns candidates for an ambiguous/no-match ref instead of guessing", async () => {
    await buildFreshKb();
    const { chunk, candidates } = await resolveRulesRef("cr/9.9.9", {
      kbDir,
      ttlMs: 999_999_999,
    });
    expect(chunk).toBeNull();
    expect(candidates).toEqual([]);
  });

  it("refreshLegality() is the same function syncRules() uses internally (no drift) — calling it standalone updates the on-disk chunk", async () => {
    await buildFreshKb();
    const before = fs.readFileSync(
      path.join(kbDir, "legality", "current.md"),
      "utf8",
    );
    mockLegalityOnce();
    const result = await refreshLegality({ kbDir });
    expect(result.status).toBe("ok");
    const after = fs.readFileSync(
      path.join(kbDir, "legality", "current.md"),
      "utf8",
    );
    expect(after).toContain("fetched_at");
    // rebuilding index picks up the refreshed chunk too
    const idx = rebuildIndex(kbDir);
    expect(idx.chunks.some((c) => c.document === "legality")).toBe(true);
    expect(before).toBeTruthy();
  });
});
