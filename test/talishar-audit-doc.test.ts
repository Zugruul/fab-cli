import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §10 I6: this test must never touch third_party/talishar* or the network.
// It reads only the committed markdown file below.
const DOC_PATH = join(process.cwd(), "docs", "TALISHAR-AUDIT.md");

// TAL-030 §9.1: the 5 required audited areas, in the order the design doc lists them.
const REQUIRED_AREAS: { name: string; pattern: RegExp }[] = [
  { name: "SSE update path", pattern: /^#{2,}\s.*sse update path/im },
  { name: "Gamestate caching", pattern: /^#{2,}\s.*gamestate caching/im },
  { name: "Apache/SSE tuning", pattern: /^#{2,}\s.*apache/im },
  { name: "FE parse/render cost", pattern: /^#{2,}\s.*fe parse.render cost/im },
  {
    name: "GameFile I/O cycle",
    pattern: /^#{2,}\s.*gamefile i.o cycle/im,
  },
];

function headingLines(doc: string): string[] {
  return doc.split("\n").filter((l) => /^#{2,}\s/.test(l));
}

function sectionBody(doc: string, pattern: RegExp): string {
  const lines = doc.split("\n");
  const startIdx = lines.findIndex((l) => pattern.test(l));
  if (startIdx === -1) return "";
  const startLevel = (lines[startIdx].match(/^#+/) ?? [""])[0].length;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^#{2,}\s/);
    if (m && lines[i].match(/^#+/)![0].length <= startLevel) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx).join("\n");
}

// Finding-shape elements per §9.1a: evidence citation, impact, fix sketch, rank —
// OR an explicit "no issue found" phrase.
const EVIDENCE_RE = /`third_party\/talishar[^`]*`/i;
const IMPACT_RE = /impact/i;
const FIX_SKETCH_RE = /fix sketch/i;
const RANK_RE = /rank/i;
const NO_ISSUE_RE = /no issue found/i;

describe("docs/TALISHAR-AUDIT.md", () => {
  it("exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  const doc = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf-8") : "";

  it("is a substantial document, not a stub", () => {
    expect(doc.length).toBeGreaterThan(4000);
  });

  it.each(REQUIRED_AREAS)("has a heading for: $name", ({ pattern }) => {
    expect(doc).toMatch(pattern);
  });

  it("presents the required area headings in §9.1 order", () => {
    const headings = headingLines(doc);
    const indices = REQUIRED_AREAS.map(({ pattern }) =>
      headings.findIndex((h) => pattern.test(h)),
    );
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it.each(REQUIRED_AREAS)(
    "area '$name' has evidence-backed finding(s) or an explicit no-issue-found",
    ({ pattern }) => {
      const body = sectionBody(doc, pattern);
      expect(body.length).toBeGreaterThan(0);

      if (NO_ISSUE_RE.test(body)) {
        // An explicit "no issue found" still needs a citation grounding the claim.
        expect(body).toMatch(EVIDENCE_RE);
        return;
      }

      expect(body).toMatch(EVIDENCE_RE);
      expect(body).toMatch(IMPACT_RE);
      expect(body).toMatch(FIX_SKETCH_RE);
      expect(body).toMatch(RANK_RE);
    },
  );

  it("cites vendored paths with sufficient density", () => {
    const citations = doc.match(/`third_party\/talishar[^`]*`/g) ?? [];
    expect(citations.length).toBeGreaterThanOrEqual(10);
  });

  it("ranks findings relative to each other (a ranking table or ordered list)", () => {
    expect(doc).toMatch(/^#{2,}\s.*rank/im);
  });

  it("does not include TAL-031's bug-scan/DX sections (out of scope)", () => {
    expect(doc).not.toMatch(
      /^#{2,}\s.*(bug.scan|developer experience|\bdx\b)/im,
    );
  });
});
