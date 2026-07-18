import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §10 I6: this test must never touch third_party/talishar* or the network.
// It reads only the committed markdown files below.
const DIR = join(process.cwd(), ".claude", "talishar");

const FILES = [
  "architecture.md",
  "card-recipe.md",
  "decision-queue.md",
  "frontend.md",
  "dev-stack.md",
  "contributing.md",
] as const;

function citationCount(text: string): number {
  const pathCitations = text.match(/`third_party\/talishar[^`]*`/g) ?? [];
  const prCitations = text.match(/Talishar\/[A-Za-z-]+#\d+/g) ?? [];
  const bareIssueCitations = text.match(/(?<!\w)#\d{2,5}(?!\w)/g) ?? [];
  return pathCitations.length + prCitations.length + bareIssueCitations.length;
}

describe(".claude/talishar/*.md curated reference set", () => {
  it("all six files exist", () => {
    for (const f of FILES) {
      expect(existsSync(join(DIR, f)), `${f} should exist`).toBe(true);
    }
  });

  const contents: Record<string, string> = {};
  for (const f of FILES) {
    const p = join(DIR, f);
    contents[f] = existsSync(p) ? readFileSync(p, "utf-8") : "";
  }

  it.each(FILES)("%s states a 'Last verified against upstream' date line", (f) => {
    expect(contents[f]).toMatch(/Last verified against upstream:\s*\d{4}-\d{2}-\d{2}/i);
  });

  it.each(FILES)("%s carries meaningful citation density (>= 5 citations)", (f) => {
    expect(citationCount(contents[f])).toBeGreaterThanOrEqual(5);
  });

  it.each(FILES)("%s is a substantial working reference, not a stub", (f) => {
    expect(contents[f].length).toBeGreaterThan(1500);
  });

  describe("card-recipe.md self-sufficiency", () => {
    const doc = contents["card-recipe.md"];

    it("contains the full Card class hook signatures inline", () => {
      for (const hook of [
        "PlayAbility",
        "SpecificLogic",
        "ProcessTrigger",
        "CombatEffectActive",
        "EffectPowerModifier",
      ]) {
        expect(doc, `missing hook: ${hook}`).toContain(hook);
      }
    });

    it("contains a ClassState-related citation (the 3-file dance)", () => {
      expect(doc).toMatch(/`third_party\/talishar\/Constants\.php`/);
      expect(doc).toMatch(/`third_party\/talishar\/MenuFiles\/StartHelper\.php`/);
    });

    it("cites the worked PR example (#1370/#1369 shape)", () => {
      expect(doc).toMatch(/Talishar\/Talishar#\d+/);
    });

    it("contains a code-level Card class skeleton", () => {
      expect(doc).toMatch(/class\s+\w+\s+extends\s+Card/);
    });
  });

  it("docs/TALISHAR-ARCHITECTURE.md links to the curated reference set", () => {
    const archDoc = readFileSync(
      join(process.cwd(), "docs", "TALISHAR-ARCHITECTURE.md"),
      "utf-8",
    );
    for (const f of FILES) {
      expect(
        archDoc.includes(`.claude/talishar/${f}`),
        `architecture doc should link to .claude/talishar/${f}`,
      ).toBe(true);
    }
  });
});
