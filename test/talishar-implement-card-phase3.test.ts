import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §10 I3/I6: this test must never touch third_party/talishar-cardimages,
// third_party/talishar-fe, or the network. It reads only the committed
// skill markdown file below.
const SKILL_PATH = join(
  process.cwd(),
  ".claude",
  "skills",
  "talishar-implement-card",
  "SKILL.md",
);

function readSkill(): string {
  return readFileSync(SKILL_PATH, "utf-8");
}

function extractSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start, `missing heading: ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = content.slice(start + heading.length);
  const next = rest.search(/\n## Phase \d|\n## What this skill does NOT do/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("talishar-implement-card SKILL.md Phase 3 (images)", () => {
  const content = readSkill();
  const phase3 = extractSection(content, "## Phase 3 — Images");

  it("is no longer stubbed as 'not yet implemented'", () => {
    expect(phase3).not.toMatch(/not yet implemented/i);
  });

  it("has a numbered Steps subsection", () => {
    expect(phase3).toMatch(/### Steps/);
  });

  it("requires first confirming the card genuinely lacks images/cardList entry before running anything", () => {
    expect(phase3.toLowerCase()).toMatch(
      /already has|don't run|do not run|already exist/,
    );
  });

  it("names the two separate vendored clones and their own local branches", () => {
    expect(phase3).toMatch(/talishar-cardimages/);
    expect(phase3).toMatch(/talishar-fe/);
  });

  it("describes editing downloadImages.js's composeInitialApiUrl in place, on a branch", () => {
    expect(phase3).toMatch(/downloadImages\.js/);
    expect(phase3).toMatch(/composeInitialApiUrl/);
  });

  it("states generateTranslatedCollections.js is conditional (reprints only), not unconditional", () => {
    expect(phase3).toMatch(/generateTranslatedCollections\.js/);
    expect(phase3.toLowerCase()).toMatch(/reprint/);
  });

  it("requires running FE generate-cards to refresh cardList.ts", () => {
    expect(phase3).toMatch(/generate-cards/);
    expect(phase3).toMatch(/cardList\.ts/);
  });

  it("states §10 I3's hard invariant: zero image artifacts ever land under fab-cli", () => {
    expect(phase3).toMatch(/§10 I3/);
    expect(phase3.toLowerCase()).toMatch(/never.*fab-cli|zero image artifacts/);
  });

  it("states the ≤2 concurrent CDN request etiquette", () => {
    expect(phase3).toMatch(/2 concurrent/);
  });

  it("requires updating the dossier citing both clones' local branches, not pushed", () => {
    expect(phase3.toLowerCase()).toMatch(/dossier/);
    expect(phase3.toLowerCase()).toMatch(/not push|never push|local/);
  });

  it("requires confirming zero footprint in the fab-cli repo itself", () => {
    expect(phase3.toLowerCase()).toMatch(/git status|git diff/);
  });

  it("is a substantial Steps section, not a one-line stub", () => {
    expect(phase3.length).toBeGreaterThan(800);
  });
});
