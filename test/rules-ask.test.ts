import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  installHttpMock,
  restoreHttpMock,
  type MockAgentHandle,
} from "./helpers/http-mock";

vi.mock("../src/rulesDocs", async () => {
  const actual =
    await vi.importActual<typeof import("../src/rulesDocs")>(
      "../src/rulesDocs",
    );
  return { ...actual, updateRulesDocs: vi.fn().mockResolvedValue([]) };
});

import {
  askRules,
  rankRulesChunks,
  rankRulesChunksScored,
  syncRules,
  JUDGE_DISCORD_URL,
  ASK_RULES_ESCALATION_FOOTER,
  type RulesChunk,
} from "../src/rules";
import * as rulesModule from "../src/rules";
import { registerRules } from "../src/commands/rules";

describe("rankRulesChunksScored — pure logic, no I/O", () => {
  const chunks: RulesChunk[] = [
    {
      document: "CR",
      section: "1.1",
      title: "Players",
      sourceUrl: "u",
      version: "v1",
      fetchedAt: "t",
      text: "A player is a person participating in the game.",
    },
    {
      document: "TRP",
      section: "1",
      title: "Tournament Information",
      sourceUrl: "u",
      version: "v1",
      fetchedAt: "t",
      text: "Tournaments comprise formats and rounds.",
    },
  ];

  it("returns score/matchedTerms/totalTerms alongside the chunk", () => {
    const results = rankRulesChunksScored(chunks, "player person", 8);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.section).toBe("1.1");
    expect(results[0].totalTerms).toBe(2);
    expect(results[0].matchedTerms).toBe(2);
    expect(typeof results[0].score).toBe("number");
  });

  it("returns an empty array for a stopword-only query", () => {
    expect(rankRulesChunksScored(chunks, "the a", 8)).toEqual([]);
  });

  it("respects the limit", () => {
    const results = rankRulesChunksScored(chunks, "tournament player", 1);
    expect(results.length).toBe(1);
  });

  it("reports a lower matchedTerms/totalTerms ratio for a partially-matching query", () => {
    const results = rankRulesChunksScored(chunks, "player foobar bazqux", 8);
    expect(results[0].chunk.section).toBe("1.1");
    expect(results[0].totalTerms).toBe(3);
    expect(results[0].matchedTerms).toBe(1);
  });
});

describe("rankRulesChunks — thin wrapper over rankRulesChunksScored (unchanged external behavior)", () => {
  const chunks: RulesChunk[] = [
    {
      document: "CR",
      section: "1.1",
      title: "Players",
      sourceUrl: "u",
      version: "v1",
      fetchedAt: "t",
      text: "A player is a person participating in the game.",
    },
    {
      document: "TRP",
      section: "1",
      title: "Tournament Information",
      sourceUrl: "u",
      version: "v1",
      fetchedAt: "t",
      text: "Tournaments comprise formats and rounds.",
    },
  ];

  it("returns exactly the .chunk projection of rankRulesChunksScored, in the same order", () => {
    const scored = rankRulesChunksScored(chunks, "player tournament", 8);
    const plain = rankRulesChunks(chunks, "player tournament", 8);
    expect(plain).toEqual(scored.map((r) => r.chunk));
  });

  it("still returns an empty array for a stopword-only query", () => {
    expect(rankRulesChunks(chunks, "the a", 8)).toEqual([]);
  });
});

describe("askRules — composition over searchRules (FAB-022)", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;
  let rulesDir: string;
  let cpgPdfPath: string;

  const FIXTURES = path.join(__dirname, "fixtures", "rules");

  beforeEach(async () => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-rules-ask-"));
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
    // Legality fetched once during syncRules(); queries below never touch
    // legality content again so no further network interceptors are needed.
    const { mockPool } = await import("./helpers/http-mock");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(
        200,
        fs.readFileSync(path.join(FIXTURES, "legality-page.html"), "utf8"),
      );
    await syncRules({ kbDir, rulesDir, cpgPdfPath });
  });

  afterEach(async () => {
    await restoreHttpMock(mock);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("a clear match returns confident: true with non-empty passages", async () => {
    const result = await askRules("player person", {
      kbDir,
      ttlMs: 999_999_999,
    });
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.confident).toBe(true);
  });

  it("a query with zero matches returns confident: false and no passages", async () => {
    const result = await askRules("zzyxlmnop qwertyuiop", {
      kbDir,
      ttlMs: 999_999_999,
    });
    expect(result.passages).toEqual([]);
    expect(result.confident).toBe(false);
  });

  it("a weak match (fewer than half the terms hit the top result) returns confident: false despite non-empty passages", async () => {
    const result = await askRules("player foobar bazqux", {
      kbDir,
      ttlMs: 999_999_999,
    });
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.confident).toBe(false);
  });
});

describe("askRules — confidence must track passages[0] across a mid-call legality content change", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;
  let rulesDir: string;
  let cpgPdfPath: string;

  const FIXTURES = path.join(__dirname, "fixtures", "rules");
  const QUERY = "eligible format legend";

  beforeEach(async () => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-rules-ask-flip-"));
    kbDir = path.join(tmpRoot, "kb", "rules");
    rulesDir = path.join(tmpRoot, "fab-rules-src");
    cpgPdfPath = path.join(FIXTURES, "cpg-fixture.pdf");
    fs.mkdirSync(rulesDir, { recursive: true });
    // TRP is the initial top match for QUERY (matches only "format", weak
    // 1/3 ratio) — deliberately not confident-worthy on its own.
    fs.writeFileSync(
      path.join(rulesDir, "en-fab-trp.txt"),
      "1 Tournament Rules\nAll decks must meet the format requirements. Format legality follows tournament format guidelines.\n",
    );
    fs.writeFileSync(
      path.join(rulesDir, "en-fab-cr.txt"),
      "1 Preface\nComprehensive Rules preface text.\n1.1 Players\nA player is a person.\n",
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
    // Initial legality fetch (consumed by syncRules() below): barely
    // touches the query terms (weak 1/3 ratio, lower score than TRP).
    const { mockPool } = await import("./helpers/http-mock");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(
        200,
        "<main><article><h1>Card Legality Policy</h1><p>This page lists " +
          "banned and restricted cards. Every deck must be legal for its " +
          "format.</p></article></main>",
      );
    await syncRules({ kbDir, rulesDir, cpgPdfPath });
  });

  afterEach(async () => {
    await restoreHttpMock(mock);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("a realistic legality content change mid-call promotes legality to passages[0], and confident must agree with it — not a stale/independently-reread top", async () => {
    // The query itself matches the legality chunk (weakly), so
    // `searchRules()` triggers a live legality refetch mid-call (§7.4, I2).
    // This second response is a realistic rewording/expansion — not
    // adversarial keyword-stuffing — that legitimately raises legality's
    // score above TRP's (the pre-refresh top): now a full 3/3 term match
    // vs. TRP's weak 1/3.
    const { mockPool } = await import("./helpers/http-mock");
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(
        200,
        "<main><article><h1>Card Legality Policy</h1><p>Eligible decks " +
          "must meet the format requirements. Format eligibility also " +
          "depends on the Living Legend rotation; legend status changes " +
          "rotation eligibility every season.</p></article></main>",
      );

    const result = await askRules(QUERY, { kbDir, ttlMs: 999_999_999 });

    // The legality chunk now genuinely outranks everything else — it must
    // be what's actually shown first, and `confident` must be judged from
    // that same top passage (full 3/3 match => confident), never from an
    // independent re-rank that disagrees with what passages[0] shows.
    expect(result.passages[0]?.document).toBe("legality");
    expect(result.confident).toBe(true);
  });
});

describe("rules ask CLI — escalation footer always present, highlighted on low confidence", () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let askSpy: ReturnType<typeof vi.spyOn>;

  function buildProgram(): Command {
    const program = new Command();
    program.name("fab-cli").exitOverride();
    registerRules(program);
    return program;
  }

  function chunk(overrides: Partial<RulesChunk> = {}): RulesChunk {
    return {
      document: "CR",
      section: "1.1",
      title: "Players",
      sourceUrl: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt",
      version: "v1",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      text: "A player is a person participating in the game.",
      ...overrides,
    };
  }

  beforeEach(() => {
    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    askSpy = vi.spyOn(rulesModule, "askRules");
  });

  afterEach(() => {
    logSpy.mockRestore();
    askSpy.mockRestore();
  });

  it("confident answer: shows passages + the escalation footer verbatim, no low-confidence highlight", async () => {
    askSpy.mockResolvedValue({ passages: [chunk()], confident: true });
    const program = buildProgram();
    await program.parseAsync(["rules", "ask", "player person"], {
      from: "user",
    });
    const output = logs.join("\n");
    expect(output).toContain("Players");
    expect(output).toContain(ASK_RULES_ESCALATION_FOOTER);
    expect(output).toContain(JUDGE_DISCORD_URL);
    expect(output).not.toContain("don't clearly settle");
  });

  it("zero-result query: no passages, highlighted footer, Discord URL still present verbatim", async () => {
    askSpy.mockResolvedValue({ passages: [], confident: false });
    const program = buildProgram();
    await program.parseAsync(["rules", "ask", "zzyxlmnop qwertyuiop"], {
      from: "user",
    });
    const output = logs.join("\n");
    expect(output).toContain("don't clearly settle");
    expect(output).toContain(ASK_RULES_ESCALATION_FOOTER);
    expect(output).toContain(JUDGE_DISCORD_URL);
  });

  it("weak-match query: passages shown but footer still highlighted, Discord URL present verbatim", async () => {
    askSpy.mockResolvedValue({ passages: [chunk()], confident: false });
    const program = buildProgram();
    await program.parseAsync(["rules", "ask", "player foobar bazqux"], {
      from: "user",
    });
    const output = logs.join("\n");
    expect(output).toContain("Players");
    expect(output).toContain("don't clearly settle");
    expect(output).toContain(ASK_RULES_ESCALATION_FOOTER);
    expect(output).toContain(JUDGE_DISCORD_URL);
  });

  it("Commander's variadic <question...> capture: separate argv tokens are joined with spaces before being passed to askRules", async () => {
    askSpy.mockResolvedValue({ passages: [chunk()], confident: true });
    const program = buildProgram();
    await program.parseAsync(["rules", "ask", "player", "person", "damage"], {
      from: "user",
    });
    expect(askSpy).toHaveBeenCalledWith(
      "player person damage",
      expect.anything(),
    );
  });
});
