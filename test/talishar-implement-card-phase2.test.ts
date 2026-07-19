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

describe("talishar-implement-card SKILL.md Phase 2 (implementation)", () => {
  const content = readSkill();
  const phase2 = extractSection(content, "## Phase 2 — Implementation");

  it("is no longer stubbed as 'not yet implemented'", () => {
    expect(phase2).not.toMatch(/not yet implemented/i);
  });

  it("has a numbered Steps subsection", () => {
    expect(phase2).toMatch(/### Steps/);
  });

  it("states the branch naming/base contract (§8.2)", () => {
    expect(phase2).toMatch(/feat\/\{card_id\}/);
    expect(phase2).toMatch(/upstream\/main/);
  });

  it("requires running the fork-sync step before branching", () => {
    expect(phase2).toMatch(/talishar-fork-sync/);
  });

  it("requires the dossier phase to be run/current before implementing (§10 I4)", () => {
    expect(phase2).toMatch(/dossier/i);
  });

  it("names the minimal-hooks recipe fidelity rule (§8.3)", () => {
    for (const hook of [
      "PlayAbility",
      "SpecificLogic",
      "ProcessTrigger",
      "CombatEffectActive",
      "EffectPowerModifier",
    ]) {
      expect(phase2, `missing hook: ${hook}`).toContain(hook);
    }
  });

  it("restates I2 (origin-only, never force-push a diverged fork)", () => {
    expect(phase2).toMatch(/origin/);
    expect(phase2).toMatch(/force/i);
  });

  it("requires php -l on every touched file", () => {
    expect(phase2).toMatch(/php -l/);
  });

  it("requires confirming no unrelated changes in the diff", () => {
    expect(phase2).toMatch(/unrelated changes/i);
  });

  it("states this phase's done-state is a local, unpushed branch (TAL-023 pushes)", () => {
    expect(phase2).toMatch(/TAL-023/);
    expect(phase2.toLowerCase()).toMatch(/local|not push|never push/);
  });

  it("is a substantial Steps section, not a one-line stub", () => {
    expect(phase2.length).toBeGreaterThan(800);
  });
});
