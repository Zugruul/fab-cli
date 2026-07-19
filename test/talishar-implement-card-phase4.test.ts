import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §10 I6: this test must never touch third_party/talishar* or the network.
// It reads only the committed skill markdown file below.
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

describe("talishar-implement-card SKILL.md Phase 4 (validation + hand-off)", () => {
  const content = readSkill();
  const phase4 = extractSection(content, "## Phase 4 — Validation + hand-off");

  it("is no longer stubbed as 'not yet implemented'", () => {
    expect(phase4).not.toMatch(/not yet implemented/i);
  });

  it("has a numbered Steps subsection", () => {
    expect(phase4).toMatch(/### Steps/);
  });

  it("requires bringing up the docker stack via start.sh", () => {
    expect(phase4).toMatch(/start\.sh/);
    expect(phase4).toMatch(/docker/i);
  });

  it("requires the implementation phase to be current before validating (§10 I4)", () => {
    expect(phase4).toMatch(/implementing/);
  });

  it("directs API-based validation, not FE browser automation (§8.5)", () => {
    expect(phase4).toMatch(/API/);
    expect(phase4.toLowerCase()).toMatch(/not.*browser|instead of.*browser|rather than.*browser/);
  });

  it("requires exercising the observable behavior (draw, discard, trigger)", () => {
    expect(phase4.toLowerCase()).toMatch(/draw/);
    expect(phase4.toLowerCase()).toMatch(/discard/);
  });

  it("requires recording the outcome as the dossier's Test Plan section", () => {
    expect(phase4).toMatch(/## Test Plan/);
    expect(phase4).toMatch(/ready-for-pr/);
  });

  it("states §8.7's hard invariant: a failed validation stops the phase, no push", () => {
    expect(phase4).toMatch(/§8\.7/);
    expect(phase4.toLowerCase()).toMatch(/stop/);
    expect(phase4.toLowerCase()).toMatch(/never push/);
  });

  it("requires pushing the branch to origin (the fork) only after validation passes", () => {
    expect(phase4).toMatch(/git push origin/);
    expect(phase4).toMatch(/feat\/\{card_id\}/);
  });

  it("requires preparing PR title/body as text, never opening a PR on the org repo (I1)", () => {
    expect(phase4.toLowerCase()).toMatch(/pr title/);
    expect(phase4.toLowerCase()).toMatch(/pr body|body/);
    expect(phase4).toMatch(/never.*(gh pr|open|create).*PR|I1/i);
  });

  it("requires bringing the docker stack back down when done", () => {
    expect(phase4.toLowerCase()).toMatch(/docker compose down|stop\.sh|bring.*stack.*down/);
  });

  it("is a substantial Steps section, not a one-line stub", () => {
    expect(phase4.length).toBeGreaterThan(800);
  });
});
