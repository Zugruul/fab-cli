import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §10 I6: this test must never touch third_party/talishar* or the network.
// It reads only the committed markdown file below.
const DOC_PATH = join(process.cwd(), "docs", "TALISHAR-ARCHITECTURE.md");

// Required §7.1 topic headings, in the order SPEC-TALISHAR.md §7.1 lists them.
// Each entry is a regex matched against a `##`+ heading line (case-insensitive).
const REQUIRED_HEADINGS: { name: string; pattern: RegExp }[] = [
  { name: "engine request pipeline", pattern: /^#{2,}\s.*request pipeline/im },
  { name: "GameFile state format/lifecycle", pattern: /^#{2,}\s.*gamefile/im },
  {
    name: "DecisionQueue/Await async model",
    pattern: /^#{2,}\s.*decisionqueue.*await/im,
  },
  {
    name: "layer stack + CombatChain resolution",
    pattern: /^#{2,}\s.*(layer stack|combatchain)/im,
  },
  { name: "ClassState mechanism", pattern: /^#{2,}\s.*classstate/im },
  { name: "card recipe worked example", pattern: /^#{2,}\s.*card recipe/im },
  { name: "API surface overview", pattern: /^#{2,}\s.*api surface/im },
  {
    name: "FE state flow (SSE/ParseGameState/GameSlice)",
    pattern: /^#{2,}\s.*(frontend|fe) state flow/im,
  },
  { name: "card-image pipeline", pattern: /^#{2,}\s.*card.image pipeline/im },
  {
    name: "local dev stack",
    pattern: /^#{2,}\s.*(local )?dev(elopment)? stack/im,
  },
  {
    name: "upstream contribution conventions",
    pattern: /^#{2,}\s.*contribut/im,
  },
  {
    name: "known stale upstream docs",
    pattern: /^#{2,}\s.*known stale upstream docs/im,
  },
];

function headingLines(doc: string): string[] {
  return doc.split("\n").filter((l) => /^#{2,}\s/.test(l));
}

describe("docs/TALISHAR-ARCHITECTURE.md", () => {
  it("exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  const doc = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf-8") : "";

  it("is a substantial long-form document, not a stub", () => {
    expect(doc.length).toBeGreaterThan(8000);
  });

  it.each(REQUIRED_HEADINGS)("has a heading for: $name", ({ pattern }) => {
    expect(doc).toMatch(pattern);
  });

  it("presents the required topic headings in §7.1 order", () => {
    const headings = headingLines(doc);
    const indices = REQUIRED_HEADINGS.map(({ pattern }) =>
      headings.findIndex((h) => pattern.test(h)),
    );
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it("has a dedicated Known stale upstream docs section", () => {
    expect(doc).toMatch(/^#{2,}\s.*known stale upstream docs/im);
  });

  it("cites vendored paths or upstream PR/issue numbers with sufficient density", () => {
    // Citation shapes: `third_party/talishar...` in backticks, or a PR/issue
    // reference like Talishar/Talishar#1370 or a bare #1370.
    const pathCitations = doc.match(/`third_party\/talishar[^`]*`/g) ?? [];
    const prCitations = doc.match(/Talishar\/[A-Za-z-]+#\d+/g) ?? [];
    const bareIssueCitations = doc.match(/(?<!\w)#\d{2,5}(?!\w)/g) ?? [];
    const totalCitations =
      pathCitations.length + prCitations.length + bareIssueCitations.length;

    // Not brittle to prose style, but a doc with zero or near-zero citations
    // must fail: §7.1a requires every architectural claim to be grounded.
    expect(totalCitations).toBeGreaterThanOrEqual(40);

    // Paragraph-level density check: sample non-heading, non-empty paragraphs
    // and require a meaningful fraction to carry an inline citation.
    const paragraphs = doc
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(
        (p) =>
          p.length > 0 &&
          !p.startsWith("#") &&
          !p.startsWith("|") &&
          !p.startsWith("```"),
      );
    const citedParagraphs = paragraphs.filter(
      (p) =>
        /`third_party\/talishar[^`]*`/.test(p) ||
        /Talishar\/[A-Za-z-]+#\d+/.test(p) ||
        /(?<!\w)#\d{2,5}(?!\w)/.test(p),
    );
    expect(paragraphs.length).toBeGreaterThan(10);
    expect(citedParagraphs.length / paragraphs.length).toBeGreaterThan(0.3);
  });

  it("names the three files of the ClassState dance with citations", () => {
    const section = doc.split(/^#{2,}\s.*classstate/im)[1] ?? "";
    expect(section).toMatch(/`third_party\/talishar\/Constants\.php`/);
    expect(section).toMatch(
      /`third_party\/talishar\/MenuFiles\/StartHelper\.php`/,
    );
  });

  it("cites a real merged PR number for the card-recipe worked example", () => {
    const section = doc.split(/^#{2,}\s.*card recipe/im)[1] ?? "";
    expect(section).toMatch(/Talishar\/Talishar#\d+/);
  });
});
