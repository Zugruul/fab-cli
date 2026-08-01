import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §10 I6: this test must never touch third_party/talishar* or the network.
// It reads only committed brain-note markdown under .claude/identities/talishar/brain/notes/.
const NOTES_DIR = join(
  process.cwd(),
  ".claude",
  "identities",
  "talishar",
  "brain",
  "notes",
);

function noteFiles(): string[] {
  if (!existsSync(NOTES_DIR)) return [];
  return readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md"));
}

function readNote(name: string): string {
  return readFileSync(join(NOTES_DIR, name), "utf-8");
}

describe("talishar brain: ClassState per-turn-counter spot-check (§7.4)", () => {
  it("has minted at least one tal-recipe-classstate-counter note", () => {
    const files = noteFiles();
    const match = files.filter((f) => /classstate.*counter/i.test(f));
    expect(match.length).toBeGreaterThan(0);
  });

  it("the note's OWN text names all three files of the ClassState dance, not just a doc pointer", () => {
    const files = noteFiles().filter((f) => /classstate.*counter/i.test(f));
    const bodies = files.map(readNote).join("\n\n");

    // The three files of the dance, per SPEC-TALISHAR.md §7.4 / docs/TALISHAR-ARCHITECTURE.md's
    // "ClassState Mechanism (the Three-File Dance)" section.
    expect(bodies).toMatch(/`third_party\/talishar\/Constants\.php`/);
    expect(bodies).toMatch(
      /`third_party\/talishar\/MenuFiles\/StartHelper\.php`/,
    );
    // The third file is the trigger call site — must be a concrete file, not a generic
    // "wherever the event happens" hand-wave. AuraAbilities.php is the real call site for
    // both worked examples used in this seeding pass (lightning_flow, might/vigor).
    expect(bodies).toMatch(/`third_party\/talishar\/AuraAbilities\.php`/);
  });

  it("does NOT merely defer to the architecture doc/card-recipe reference by pointer", () => {
    const files = noteFiles().filter((f) => /classstate.*counter/i.test(f));
    const bodies = files.map(readNote).join("\n\n");
    // The knowledge must live in the note's own prose: real function/constant names beyond
    // just citing the doc files.
    expect(bodies).toMatch(/IncrementClassState/);
    expect(bodies).toMatch(/ResetMainClassState/);
    expect(bodies.length).toBeGreaterThan(600);
  });

  it("cites a second real worked example beyond the one already in card-recipe.md", () => {
    // card-recipe.md/architecture doc only document $CS_NumLightningFlowDestroyed
    // (Talishar/Talishar#1370). §7.6 requires direct code study to find a second real example.
    const files = noteFiles().filter((f) => /classstate.*counter/i.test(f));
    const bodies = files.map(readNote).join("\n\n");
    expect(bodies).toMatch(/CS_NumMightDestroyed|CS_NumVigorDestroyed/);
  });
});

describe("talishar brain: note kind-prefix + topic coverage", () => {
  const files = noteFiles();

  it("has minted a substantial batch of notes (maximal seeding, not a stub)", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it("every note uses one of the three sanctioned kind prefixes", () => {
    const nonGitkeep = files.filter((f) => f !== ".gitkeep");
    for (const f of nonGitkeep) {
      expect(f).toMatch(/^tal-(arch|recipe|dev)-/);
    }
  });

  it.each([
    ["engine request pipeline", /request.pipeline|pipeline/i],
    ["GameFile state format/lifecycle", /gamefile/i],
    ["DecisionQueue/Await", /decision.queue|await/i],
    ["layer stack/CombatChain", /layer.stack|combatchain|combat.chain/i],
    ["ClassState", /classstate/i],
    ["card recipe/object model", /card.recipe|card.object|base.card/i],
    ["API surface", /api.surface/i],
    ["FE state flow", /fe.state|frontend.state|gameslice/i],
    ["card-image pipeline", /card.image/i],
    ["dev stack", /dev.stack|compose/i],
    ["contribution conventions", /contribut/i],
  ])("covers required §7.1 topic: %s", (_label, pattern) => {
    const covered = files.some((f) => pattern.test(f));
    expect(covered).toBe(true);
  });

  it.each([
    ["base card recipe", /base.card/i],
    ["modal choose-1 pattern", /modal/i],
    ["ClassState counter variation", /classstate.*counter/i],
    ["CurrentTurnEffect suffix pattern", /currentturneffect|suffix/i],
    ["windup dual-mode archetype", /windup|archetype/i],
    ["combat modifiers", /combat.modifier/i],
  ])("covers required recipe variation: %s", (_label, pattern) => {
    const covered = files.some((f) => pattern.test(f));
    expect(covered).toBe(true);
  });

  it("every note has house frontmatter (tags, paths, strength, source, graduated, created)", () => {
    const nonGitkeep = files.filter((f) => f !== ".gitkeep");
    for (const f of nonGitkeep) {
      const body = readNote(f);
      expect(body, `${f} missing frontmatter fence`).toMatch(/^---\n/);
      expect(body, `${f} missing tags:`).toMatch(/\ntags:\s*\[/);
      expect(body, `${f} missing paths:`).toMatch(/\npaths:\s*\[/);
      expect(body, `${f} missing strength:`).toMatch(/\nstrength:\s*\d/);
      expect(body, `${f} missing source:`).toMatch(/\nsource:\s*"/);
      expect(body, `${f} missing graduated:`).toMatch(/\ngraduated:\s*false/);
      expect(body, `${f} missing created:`).toMatch(
        /\ncreated:\s*\d{4}-\d{2}-\d{2}/,
      );
    }
  });

  it("every note cites a vendored path or upstream PR/issue number in its body", () => {
    const nonGitkeep = files.filter((f) => f !== ".gitkeep");
    for (const f of nonGitkeep) {
      const body = readNote(f);
      const hasPath = /`third_party\/talishar[^`]*`/.test(body);
      const hasPr = /Talishar\/[A-Za-z-]+#\d+/.test(body);
      expect(hasPath || hasPr, `${f} has no vendored-path or PR citation`).toBe(
        true,
      );
    }
  });
});

describe("talishar brain: keyword-sync isolation invariant (§7.3a/I5)", () => {
  it("scripts/keyword-sync.py's MIRRORS list never includes 'talishar'", () => {
    const scriptPath = join(process.cwd(), "scripts", "keyword-sync.py");
    const script = readFileSync(scriptPath, "utf-8");
    const mirrorsLine = script
      .split("\n")
      .find((l) => l.trim().startsWith("MIRRORS"));
    expect(mirrorsLine).toBeDefined();
    expect(mirrorsLine).not.toMatch(/talishar/i);
  });
});
