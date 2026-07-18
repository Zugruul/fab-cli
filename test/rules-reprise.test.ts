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

import { syncReprise, syncRules, searchRules } from "../src/rules";
import { updateRulesDocs } from "../src/rulesDocs";

interface WpPostFixture {
  slug: string;
  date: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

function wpPost(overrides: Partial<WpPostFixture> = {}): WpPostFixture {
  return {
    slug: "rules-reprise-omens-of-the-third-age-constructed",
    date: "2026-05-28T12:40:37",
    link: "https://fabtcg.com/articles/rules-reprise-omens-of-the-third-age-constructed/",
    title: { rendered: "Rules Reprise: Omens of the Third Age Constructed" },
    content: {
      rendered:
        '<p class="wp-block-paragraph">When a hero has two <strong>Go again</strong> triggers, they resolve in APNAP order.</p>',
    },
    ...overrides,
  };
}

function interceptReprisePage(
  mock: MockAgentHandle,
  page: number,
  reply: WpPostFixture[],
): void {
  mockPool(mock, "https://fabtcg.com")
    .intercept({
      path: (p: string) =>
        p.startsWith("/api/wp/v2/posts?") &&
        p.includes("search=rules") &&
        p.includes("reprise") &&
        p.includes(`page=${page}`),
      method: "GET",
    })
    .reply(200, reply);
}

describe("syncReprise — WP post -> RulesChunk mapping", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;

  beforeEach(() => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-reprise-"));
    kbDir = path.join(tmpRoot, "kb", "rules");
  });

  afterEach(async () => {
    await restoreHttpMock(mock);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("maps a single WP post to a reprise RulesChunk: slug as section, decoded title, link as sourceUrl, date as version, stripped text", async () => {
    interceptReprisePage(mock, 1, [wpPost()]);

    const result = await syncReprise(kbDir, "2026-07-18T00:00:00.000Z", {
      perPage: 50,
    });

    expect(result.status).toBe("ok");
    expect(result.chunks).toBe(1);

    const file = fs.readFileSync(
      path.join(
        kbDir,
        "reprise",
        "rules-reprise-omens-of-the-third-age-constructed.md",
      ),
      "utf8",
    );
    expect(file).toContain('document: "reprise"');
    expect(file).toContain(
      'section: "rules-reprise-omens-of-the-third-age-constructed"',
    );
    expect(file).toContain(
      'title: "Rules Reprise: Omens of the Third Age Constructed"',
    );
    expect(file).toContain(
      'source_url: "https://fabtcg.com/articles/rules-reprise-omens-of-the-third-age-constructed/"',
    );
    expect(file).toContain('version: "2026-05-28T12:40:37"');
    expect(file).toContain(
      "When a hero has two Go again triggers, they resolve in APNAP order.",
    );
    // stripHtml removed the tags — no raw HTML left in the chunk body.
    expect(file).not.toContain("<p");
    expect(file).not.toContain("<strong>");
  });

  it("decodes HTML entities in the title (WP escapes titles too)", async () => {
    interceptReprisePage(mock, 1, [
      wpPost({
        slug: "rules-reprise-fyre-amp-ice",
        title: { rendered: "Rules Reprise: Fyre &amp; Ice &#39;26" },
      }),
    ]);

    const result = await syncReprise(kbDir, "2026-07-18T00:00:00.000Z", {
      perPage: 50,
    });
    expect(result.status).toBe("ok");

    const file = fs.readFileSync(
      path.join(kbDir, "reprise", "rules-reprise-fyre-amp-ice.md"),
      "utf8",
    );
    expect(file).toContain('title: "Rules Reprise: Fyre & Ice \'26"');
  });

  it("produces one chunk per article — not sub-sectioned", async () => {
    interceptReprisePage(mock, 1, [
      wpPost({
        slug: "article-a",
        link: "https://fabtcg.com/articles/article-a/",
      }),
      wpPost({
        slug: "article-b",
        link: "https://fabtcg.com/articles/article-b/",
      }),
    ]);

    const result = await syncReprise(kbDir, "2026-07-18T00:00:00.000Z", {
      perPage: 50,
    });
    expect(result.status).toBe("ok");
    expect(result.chunks).toBe(2);
  });
});

describe("syncReprise — pagination", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;

  beforeEach(() => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-reprise-page-"));
    kbDir = path.join(tmpRoot, "kb", "rules");
  });

  afterEach(async () => {
    await restoreHttpMock(mock);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("paginates through multiple full pages and stops once a page returns fewer than per_page results", async () => {
    const perPage = 2;
    const page1 = [
      wpPost({ slug: "a", link: "https://fabtcg.com/articles/a/" }),
      wpPost({ slug: "b", link: "https://fabtcg.com/articles/b/" }),
    ];
    const page2 = [
      wpPost({ slug: "c", link: "https://fabtcg.com/articles/c/" }),
      wpPost({ slug: "d", link: "https://fabtcg.com/articles/d/" }),
    ];
    const page3 = [
      wpPost({ slug: "e", link: "https://fabtcg.com/articles/e/" }),
    ];

    interceptReprisePage(mock, 1, page1);
    interceptReprisePage(mock, 2, page2);
    interceptReprisePage(mock, 3, page3);
    // No page-4 interceptor registered: a request there would throw, proving
    // syncReprise correctly stopped after the short page 3.

    const result = await syncReprise(kbDir, "2026-07-18T00:00:00.000Z", {
      perPage,
    });

    expect(result.status).toBe("ok");
    expect(result.chunks).toBe(5);
  });

  it("stops immediately when the first page is already short of per_page", async () => {
    interceptReprisePage(mock, 1, [wpPost()]);

    const result = await syncReprise(kbDir, "2026-07-18T00:00:00.000Z", {
      perPage: 50,
    });

    expect(result.status).toBe("ok");
    expect(result.chunks).toBe(1);
  });

  it("respects MAX_REPRISE_ARTICLES as a safety cap on worst-case pagination", async () => {
    const perPage = 100;
    // Two full pages of 100 = 200, hitting the cap exactly; a third page,
    // if fetched, would push past 200 and has no interceptor registered
    // (a request there would throw and fail the test).
    const makePage = (prefix: string) =>
      Array.from({ length: perPage }, (_, i) =>
        wpPost({
          slug: `${prefix}-${i}`,
          link: `https://fabtcg.com/articles/${prefix}-${i}/`,
        }),
      );

    interceptReprisePage(mock, 1, makePage("p1"));
    interceptReprisePage(mock, 2, makePage("p2"));

    const result = await syncReprise(kbDir, "2026-07-18T00:00:00.000Z", {
      perPage,
    });

    expect(result.status).toBe("ok");
    expect(result.chunks).toBe(200);
  });
});

describe("syncReprise — failure isolation", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;
  let rulesDir: string;

  beforeEach(() => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-reprise-fail-"));
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

  function mockRepriseFail(): void {
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: (p: string) => p.startsWith("/api/wp/v2/posts?"),
        method: "GET",
      })
      .reply(500, "server error")
      .times(4); // httpFetch retries 3x by default before giving up
  }

  it("a reprise fetch failure does not block CR/TRP/PPG/CPG/legality from syncing", async () => {
    mockLegalityOk();
    mockRepriseFail();

    const results = await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    const reprise = results.find((r) => r.document === "reprise")!;
    expect(reprise.status).toBe("failed");

    const cr = results.find((r) => r.document === "CR")!;
    expect(cr.status).toBe("ok");
    expect(cr.chunks).toBeGreaterThan(0);

    const cpg = results.find((r) => r.document === "CPG")!;
    expect(cpg.status).toBe("ok");

    const legality = results.find((r) => r.document === "legality")!;
    expect(legality.status).toBe("ok");
  }, 10_000);

  it("preserves prior reprise chunks on disk when a re-sync's fetch fails (offline resilience)", async () => {
    mockLegalityOk();
    interceptReprisePage(mock, 1, [wpPost()]);

    await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });
    const priorFile = path.join(
      kbDir,
      "reprise",
      "rules-reprise-omens-of-the-third-age-constructed.md",
    );
    expect(fs.existsSync(priorFile)).toBe(true);
    const before = fs.readFileSync(priorFile, "utf8");

    mockLegalityOk();
    mockRepriseFail();

    const results = await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    const reprise = results.find((r) => r.document === "reprise")!;
    expect(reprise.status).toBe("failed");
    expect(reprise.chunks).toBe(1); // the prior chunk is still on disk
    const after = fs.readFileSync(priorFile, "utf8");
    expect(after).toBe(before);
  }, 10_000);

  it("does not partially replace the reprise chunk set when a later page in the same sync fails (all-or-nothing per source)", async () => {
    // Seed a prior successful reprise sync directly via syncReprise (one
    // short page — perPage=2 with a single result stops after page 1).
    interceptReprisePage(mock, 1, [wpPost()]);
    const seeded = await syncReprise(kbDir, "2026-07-18T00:00:00.000Z", {
      perPage: 2,
    });
    expect(seeded.status).toBe("ok");
    const priorFile = path.join(
      kbDir,
      "reprise",
      "rules-reprise-omens-of-the-third-age-constructed.md",
    );
    expect(fs.existsSync(priorFile)).toBe(true);

    // Re-sync with perPage=1 so page 1 (full, new content) succeeds but
    // page 2 fails outright — this must roll back to the PRIOR chunk set,
    // never leaving only page 1's new article on disk.
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/wp/v2/posts?") && p.includes("page=1"),
        method: "GET",
      })
      .reply(200, [
        wpPost({
          slug: "new-article",
          link: "https://fabtcg.com/articles/new-article/",
        }),
      ]);
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: (p: string) =>
          p.startsWith("/api/wp/v2/posts?") && p.includes("page=2"),
        method: "GET",
      })
      .reply(500, "server error")
      .times(4);

    const result = await syncReprise(kbDir, "2026-07-19T00:00:00.000Z", {
      perPage: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.chunks).toBe(1); // the prior chunk count, unchanged
    expect(fs.existsSync(priorFile)).toBe(true);
    expect(fs.existsSync(path.join(kbDir, "reprise", "new-article.md"))).toBe(
      false,
    );
  }, 10_000);
});

describe("syncReprise — search integration (zero changes to searchRules)", () => {
  let mock: MockAgentHandle;
  let tmpRoot: string;
  let kbDir: string;
  let rulesDir: string;

  beforeEach(() => {
    mock = installHttpMock();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cli-reprise-search-"));
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

  it("rules search surfaces a reprise chunk alongside CR/TRP/PPG hits, with zero code changes to searchRules()", async () => {
    mockPool(mock, "https://fabtcg.com")
      .intercept({
        path: "/rules-and-policy-center/card-legality-policy/",
        method: "GET",
      })
      .reply(
        200,
        fs.readFileSync(path.join(FIXTURES, "legality-page.html"), "utf8"),
      );
    interceptReprisePage(mock, 1, [
      wpPost({
        content: {
          rendered:
            "<p>The Xenocryst Fyendal interaction requires resolving the corrupted energy trigger first.</p>",
        },
      }),
    ]);

    await syncRules({
      kbDir,
      rulesDir,
      cpgPdfPath: path.join(FIXTURES, "cpg-fixture.pdf"),
    });

    const results = await searchRules("xenocryst fyendal corrupted", {
      kbDir,
      ttlMs: 999_999_999,
    });

    expect(results.some((c) => c.document === "reprise")).toBe(true);
    const hit = results.find((c) => c.document === "reprise")!;
    expect(hit.text).toContain("Xenocryst Fyendal");
    expect(hit.sourceUrl).toBe(
      "https://fabtcg.com/articles/rules-reprise-omens-of-the-third-age-constructed/",
    );
  });
});
