import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// §10 I6: this test must never touch third_party/talishar* or the network — it reads only
// committed brain-note markdown and the gitignored dossier files this run produced locally.
const DOSSIERS_DIR = join(process.cwd(), ".claude", "talishar", "dossiers");
const NOTES_DIR = join(
  process.cwd(),
  ".claude",
  "identities",
  "talishar",
  "brain",
  "notes",
);

function readDossier(name: string): string {
  return readFileSync(join(DOSSIERS_DIR, name), "utf-8");
}

function noteFiles(): string[] {
  if (!existsSync(NOTES_DIR)) return [];
  return readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md"));
}

function readNote(name: string): string {
  return readFileSync(join(NOTES_DIR, name), "utf-8");
}

describe("TAL-024: Warmonger's Diplomacy dossier (multi-hero sequential-choice stress test)", () => {
  const path = join(DOSSIERS_DIR, "warmongers-diplomacy.md");

  it("exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("cites the real true text verbatim from Card Vault", () => {
    const body = readDossier("warmongers-diplomacy.md");
    expect(body).toMatch(
      /Starting with the hero to your left, each hero chooses war or peace/,
    );
    expect(body).toMatch(
      /only actions they may play or activate during their next turn are weapon and attack actions/,
    );
    expect(body).toMatch(/cardvault\.fabtcg\.com/);
  });

  it("cites the REAL implementation (not the commented-out CardObjects stub)", () => {
    const body = readDossier("warmongers-diplomacy.md");
    // The design doc assumed UPRCards.php; direct code study found the real logic lives in
    // DTDShared.php's WarmongersDiplomacy() helper + CurrentEffectAbilities.php/CardDictionary.php
    // restriction checks — the dossier must cite the real files, not the wrong assumed one.
    expect(body).toMatch(/CardDictionaries\/DuskTillDawn\/DTDShared\.php/);
    expect(body).toMatch(/WarmongersDiplomacy/);
    expect(body).toMatch(/ADDTHEIRNEXTTURNEFFECT/);
  });
});

describe("TAL-024: Aether Dart dossier (direct arcane-damage stress test)", () => {
  const path = join(DOSSIERS_DIR, "aether-dart.md");

  it("exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("cites the real true text verbatim from Card Vault", () => {
    const body = readDossier("aether-dart.md");
    expect(body).toMatch(/Deal 3 arcane damage to any target/);
    expect(body).toMatch(/cardvault\.fabtcg\.com/);
  });

  it("cites the REAL implementation and the dedicated arcane-damage ClassState counter", () => {
    const body = readDossier("aether-dart.md");
    // The design doc assumed the increment lived in CardLogic.php; direct code study found the
    // constant is declared in Constants.php and actually incremented in GameLogic.php's
    // ARCANEHITEFFECT decision-queue case — the dossier must cite what was really found.
    expect(body).toMatch(/CardDictionaries\/Uprising\/UPRWizard\.php/);
    expect(body).toMatch(/DealArcane/);
    expect(body).toMatch(/CS_ArcaneDamageDealt/);
  });
});

describe("TAL-024: brain growth — genuinely new recipe(s) minted from stress-test gaps", () => {
  it("minted a new tal-recipe note documenting the dedicated arcane-damage ClassState counter", () => {
    const files = noteFiles().filter((f) => /arcane/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    const body = files.map(readNote).join("\n\n");
    expect(body).toMatch(/DealArcane/);
    expect(body).toMatch(/CS_ArcaneDamageDealt/);
    expect(body).toMatch(/CS_DamageDealt/); // must contrast with the generic combat counter
    expect(body).toMatch(/`third_party\/talishar\/Constants\.php`/);
    expect(body).toMatch(/`third_party\/talishar\/GameLogic\.php`/);
    expect(body).toMatch(/\[\[tal-arch-classstate\]\]/);
  });

  it("minted a new tal-recipe note documenting the cross-player next-turn restriction pattern", () => {
    const files = noteFiles().filter((f) =>
      /next.turn|multi.player|multi.hero|sequential/i.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    const body = files.map(readNote).join("\n\n");
    expect(body).toMatch(/ADDTHEIRNEXTTURNEFFECT/);
    expect(body).toMatch(/AddNextTurnEffect/);
    expect(body).toMatch(
      /`third_party\/talishar\/CardDictionaries\/DuskTillDawn\/DTDShared\.php`/,
    );
  });

  it("every newly-minted note (arcane + next-turn) uses correct house frontmatter", () => {
    const files = noteFiles().filter(
      (f) =>
        /arcane/i.test(f) ||
        /next.turn|multi.player|multi.hero|sequential/i.test(f),
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
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
});
