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
  chunkNumberedDoc,
  chunkCpgText,
  rebuildIndex,
  syncRules,
} from "../src/rules";
import { updateRulesDocs } from "../src/rulesDocs";

describe("chunkNumberedDoc — CR/TRP/PPG numbered-section chunking", () => {
  it("splits on numbered heading lines, folding lettered sub-rules into the parent", () => {
    const content = [
      "1 Game Concepts",
      "1.0 General",
      "1.0.1 The rules in this document apply to any game of Flesh and Blood.",
      "1.0.1a If an effect directly contradicts a rule, the effect supersedes that rule.",
      "1.0.2 A restriction is a rule that states something cannot happen.",
      "1.1 Players",
      "1.1.1 A player is a person participating in the game.",
    ].join("\n");

    const chunks = chunkNumberedDoc(content);

    expect(chunks.map((c) => c.section)).toEqual([
      "1",
      "1.0",
      "1.0.1",
      "1.0.2",
      "1.1",
      "1.1.1",
    ]);
    expect(chunks.find((c) => c.section === "1")?.title).toBe("Game Concepts");
    expect(chunks.find((c) => c.section === "1.1")?.title).toBe("Players");
    const rule101 = chunks.find((c) => c.section === "1.0.1")!;
    expect(rule101.text).toContain("apply to any game of Flesh and Blood");
    expect(rule101.text).toContain("1.0.1a If an effect directly contradicts");
  });

  it("returns no chunks for content with no numbered headings", () => {
    expect(
      chunkNumberedDoc("just some prose\nwith no headings at all"),
    ).toEqual([]);
  });

  it("folds numeric table-row lines (e.g. TRP time-limit tables) into the preceding heading instead of splitting them into bogus sections", () => {
    const content = [
      "8 Tournament Structure",
      "8.3 Time Limits",
      "The following time limits are recommended for each round of the tournament.",
      "Format",
      "Time Limit",
      "Classic Constructed",
      "55 minutes",
      "Blitz",
      "35 minutes",
    ].join("\n");

    const chunks = chunkNumberedDoc(content);

    expect(chunks.map((c) => c.section)).toEqual(["8", "8.3"]);
    const timeLimits = chunks.find((c) => c.section === "8.3")!;
    expect(timeLimits.title).toBe("Time Limits");
    expect(timeLimits.text).toContain("55 minutes");
    expect(timeLimits.text).toContain("35 minutes");
  });
});

describe("chunkCpgText — CPG heading-structure chunking", () => {
  it("splits on standalone Title-Case heading lines", () => {
    const text = [
      "Gameplay Errors",
      "A player makes a game rules error",
      "Most gameplay errors can be addressed by partially fixing what was illegal.",
      "Tournament Errors",
      "A player has an illegal deck",
      "First, the Judge removes any cards that shouldn't be in the deck.",
    ].join("\n");

    const chunks = chunkCpgText(text);

    const titles = chunks.map((c) => c.title);
    expect(titles).toContain("Gameplay Errors");
    expect(titles).toContain("A player makes a game rules error");
    expect(titles).toContain("Tournament Errors");
    expect(titles).toContain("A player has an illegal deck");

    const gameplay = chunks.find((c) => c.title === "Gameplay Errors")!;
    expect(gameplay.text).toBe("");
    const errorScenario = chunks.find(
      (c) => c.title === "A player makes a game rules error",
    )!;
    expect(errorScenario.text).toContain("partially fixing what was illegal");
  });

  it("extracts real CPG fixture PDF text into multiple named sections", async () => {
    const pdfParse = require("pdf-parse");
    const buf = fs.readFileSync(path.join(FIXTURES, "cpg-fixture.pdf"));
    const parsed = await pdfParse(buf);
    const chunks = chunkCpgText(parsed.text);

    const titles = chunks.map((c) => c.title);
    expect(titles).toContain("Gameplay Errors");
    expect(titles).toContain("Tournament Errors");
    expect(titles).toContain("Conduct Errors");
    const misconduct = chunks.find(
      (c) => c.title === "A player commits serious misconduct",
    );
    expect(misconduct?.text).toContain("disqualified");
  });
});

describe("syncRules — full KB sync orchestration", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;
  let rulesDir: string;

  beforeEach(() => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-rules-kb-"));
    kbDir = path.join(tmpRoot, "kb", "rules");
    rulesDir = path.join(tmpRoot, "fab-rules-src");
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

  function mockLegalityOk(): void {
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(
        200,
        fs.readFileSync(path.join(FIXTURES, "legality-page.html"), "utf8"),
      );
  }

  it("calls updateRulesDocs() once to refresh the vendored txt files", async () => {
    mockLegalityOk();
    await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });
    expect(updateRulesDocs).toHaveBeenCalledTimes(1);
  });

  it("writes chunk files with frontmatter for every source and rebuilds the index", async () => {
    mockLegalityOk();
    const results = await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(results.map((r) => r.document).sort()).toEqual(
      ["CPG", "CR", "PPG", "TRP", "legality"].sort(),
    );

    const crFile = fs.readFileSync(path.join(kbDir, "cr", "1-1.md"), "utf8");
    expect(crFile).toMatch(/^---\n/);
    expect(crFile).toContain("document: CR");
    expect(crFile).toContain('section: "1.1"');
    expect(crFile).toContain('title: "Players"');
    expect(crFile).toContain(
      `source_url: https://rules.fabtcg.com/txt/latest/en-fab-cr.txt`,
    );
    expect(crFile).toContain("A player is a person.");

    const legalityFile = fs.readFileSync(
      path.join(kbDir, "legality", "current.md"),
      "utf8",
    );
    expect(legalityFile).toContain("document: legality");
    expect(legalityFile).toContain('version: "live"');
    expect(legalityFile).toContain("Enigma Chalice");
    expect(legalityFile).toContain("Living Legend Rotation");

    const index = JSON.parse(
      fs.readFileSync(path.join(kbDir, "index.json"), "utf8"),
    );
    expect(index.count).toBe(index.chunks.length);
    expect(
      index.chunks.some((c: { document: string }) => c.document === "CPG"),
    ).toBe(true);
    expect(
      index.chunks.some((c: { document: string }) => c.document === "legality"),
    ).toBe(true);
  });

  it("supersedes stale chunks on re-sync when a document's section layout changes", async () => {
    mockLegalityOk();
    await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });
    expect(fs.existsSync(path.join(kbDir, "cr", "1-1.md"))).toBe(true);

    // Re-vendor CR with a completely different section layout (1.1 no longer exists).
    fs.writeFileSync(
      path.join(rulesDir, "en-fab-cr.txt"),
      "1 Preface\nNew preface.\n2 Zones\nA zone is a place.\n",
    );

    mockLegalityOk();
    await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    expect(fs.existsSync(path.join(kbDir, "cr", "1-1.md"))).toBe(false);
    expect(fs.existsSync(path.join(kbDir, "cr", "2.md"))).toBe(true);

    const index = JSON.parse(
      fs.readFileSync(path.join(kbDir, "index.json"), "utf8"),
    );
    const crSections = index.chunks
      .filter((c: { document: string }) => c.document === "CR")
      .map((c: { section: string }) => c.section);
    expect(crSections).not.toContain("1.1");
    expect(crSections).toContain("2");
  });

  it("isolates a legality fetch failure from CR/TRP/PPG/CPG chunk writing", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(500, "server error")
      .times(4); // httpFetch retries 3x by default before giving up

    const results = await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    const legality = results.find((r) => r.document === "legality")!;
    expect(legality.status).toBe("failed");
    expect(legality.chunks).toBe(0);

    const cr = results.find((r) => r.document === "CR")!;
    expect(cr.status).toBe("ok");
    expect(cr.chunks).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(kbDir, "cr", "1-1.md"))).toBe(true);

    const cpg = results.find((r) => r.document === "CPG")!;
    expect(cpg.status).toBe("ok");
    expect(cpg.chunks).toBeGreaterThan(0);
  }, 10_000);

  it("preserves prior legality chunks on disk when a re-sync's fetch fails (offline resilience)", async () => {
    mockLegalityOk();
    await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });
    expect(fs.existsSync(path.join(kbDir, "legality", "current.md"))).toBe(
      true,
    );
    const before = fs.readFileSync(
      path.join(kbDir, "legality", "current.md"),
      "utf8",
    );

    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(500, "server error")
      .times(4);

    const results = await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    const legality = results.find((r) => r.document === "legality")!;
    expect(legality.status).toBe("failed");
    expect(legality.chunks).toBe(1); // the prior chunk is still on disk
    const after = fs.readFileSync(
      path.join(kbDir, "legality", "current.md"),
      "utf8",
    );
    expect(after).toBe(before);
  }, 10_000);

  it("re-fetches the legality page live on every sync call — never TTL'd/cached", async () => {
    mockLegalityOk();
    await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    // A second call with no fixture registered must still attempt the network
    // request and fail (proving the first sync's result wasn't cached/reused).
    const results = await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });
    const legality = results.find((r) => r.document === "legality")!;
    expect(legality.status).toBe("failed");
  }, 10_000);

  it("isolates a missing CPG PDF from the other sources", async () => {
    mockLegalityOk();
    const results = await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(tmpRoot, "does-not-exist.pdf"),
    });

    const cpg = results.find((r) => r.document === "CPG")!;
    expect(cpg.status).toBe("failed");
    expect(cpg.chunks).toBe(0);

    const legality = results.find((r) => r.document === "legality")!;
    expect(legality.status).toBe("ok");
    const cr = results.find((r) => r.document === "CR")!;
    expect(cr.status).toBe("ok");
  });
});

describe("rebuildIndex", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-rules-index-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns an empty index when the kb dir doesn't exist yet", () => {
    const index = rebuildIndex(path.join(tmpRoot, "nonexistent"));
    expect(index.count).toBe(0);
    expect(index.chunks).toEqual([]);
  });
});
