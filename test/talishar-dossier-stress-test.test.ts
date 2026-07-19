import {
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { formatDossier, type DossierInput } from "../src/talisharDossier";

// §10 I6: this test must never touch third_party/talishar* or the network. The dossier content
// below is not mocked-away filler — it's the real researched facts from TAL-024's live tool calls
// (fab-cli fabtcg card / fabrary cards local / fabrary cards search / direct code study of the
// vendored engine), reduced to DossierInput fixtures and re-rendered through the pipeline's own
// formatDossier(). This keeps the test fully self-contained and reproducible on a fresh checkout —
// it does NOT read the gitignored .claude/talishar/dossiers/ files a prior session may have left
// behind; it regenerates them itself as setup, then asserts on the resulting string directly.
const DOSSIERS_DIR = join(process.cwd(), ".claude", "talishar", "dossiers");
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

const warmongersInput: DossierInput = {
  cardName: "Warmonger's Diplomacy",
  setCode: "DTD230",
  status: "dossier",
  cardVaultText:
    "Starting with the hero to your left, each hero chooses war or peace.\n" +
    "If they choose war, the only actions they may play or activate during their next turn are weapon and attack actions.\n" +
    "If they choose peace, the only actions they may play or activate during their next turn are non-weapon non-attack actions.",
  cardVaultUrl: "https://cardvault.fabtcg.com/card/warmongers-diplomacy-3/",
  rulings: [],
  stats: {
    found: true,
    block:
      "Warmonger's Diplomacy — Generic Action, pitch 3 · cost 0 · defense 3, rarity Majestic, sets: Super Slam / Dusk till Dawn (DTD230, blue only — no red/yellow pitch variants exist for this card).",
  },
  fabraryContext:
    "1 match in Fabrary's card index: Action, Non-Attack, cost 0/pitch 3/defense 3, Majestic, Generic class, printed in Super Slam and Dusk till Dawn. No specialization-hero restriction.",
  similarImplementations: [
    {
      note: "REAL implementation (ground truth, not an analog)",
      reason:
        "`third_party/talishar/Classes/CardObjects/DTDCards.php` (NOT UPRCards.php as originally " +
        "assumed) only has a commented-out, unimplemented `warmongers_diplomacy_blue` stub " +
        '(`return "";` — a placeholder, never wired up). The card\'s REAL logic lives in the ' +
        "shared set-dictionary file `third_party/talishar/CardDictionaries/DuskTillDawn/DTDShared.php`: " +
        'a `case "warmongers_diplomacy_blue":` in the set\'s `PlayAbility()` dispatch (line 488) ' +
        "calls a dedicated helper `WarmongersDiplomacy($player)` (defined line 503) TWICE — once " +
        "for `$otherPlayer`, once for `$currentPlayer` — each followed by " +
        '`AddDecisionQueue("ADDTHEIRNEXTTURNEFFECT", $player, "<-")`. `WarmongersDiplomacy()` ' +
        'itself queues a `BUTTONINPUT` "War,Peace" modal (same DQ shape as ' +
        "`tal-recipe-modal-choose1`'s Astral Strike) and tags the chosen result with " +
        '`PREPENDLASTRESULT ... "Warmongers"` so the effect ID written to CurrentTurnEffects ' +
        "becomes `WarmongersWar`/`WarmongersPeace`. Those effect IDs are then read back by " +
        "restriction checks scattered across `CardDictionary.php` (`CanAttack()` line 1539, " +
        "`CanPlayNAA()` line 1574), `CurrentEffectAbilities.php` (`EffectAttackRestricted()` " +
        "line 2600, `EffectPlayCardRestricted()` lines 2682/2686), and `GameLogic.php` line 1201.",
    },
    {
      note: "tal-recipe-modal-choose1",
      reason:
        "the War/Peace choice itself is the same BUTTONINPUT-modal shape this note documents for " +
        "Astral Strike, but everything downstream (queuing the SAME modal twice — once per player " +
        "— and applying the chosen result to the OTHER player's future turn) is not covered by it; " +
        "see the new tal-recipe note minted from this dossier for that gap.",
    },
  ],
  imageReference:
    "https://cardvault.fabtcg.com/card/warmongers-diplomacy-3/ (also DTD230 in third_party/flesh-and-blood-cards)",
};

const aetherDartInput: DossierInput = {
  cardName: "Aether Dart",
  setCode: "UPR173/174/175",
  status: "dossier",
  cardVaultText: "Deal 3 arcane damage to any target.",
  cardVaultUrl: "https://cardvault.fabtcg.com/card/aether-dart-1/",
  rulings: [],
  stats: {
    found: true,
    block:
      "Aether Dart (red) — Wizard Action, pitch 1 · cost 0 · defense 3, arcane 3, rarity Common, " +
      "set Uprising (UPR173). Yellow pitch (UPR174) deals 2 arcane damage, blue pitch (UPR175) " +
      "deals 1 arcane damage — cost/defense/type identical across all three pitch variants " +
      "(confirmed by `third_party/talishar/CardDictionaries/Uprising/UPRWizard.php`'s " +
      '`match($cardID) { "aether_dart_red" => 3, "aether_dart_yellow" => 2, default => 1 }`).',
  },
  fabraryContext:
    "3 matches in Fabrary's card index (one per pitch): Action, Non-Attack, cost 0, defense 3, " +
    "Common rarity, Wizard class, Uprising set. No specialization-hero restriction.",
  similarImplementations: [
    {
      note: "REAL implementation (ground truth, not an analog)",
      reason:
        "`third_party/talishar/Classes/CardObjects/UPRCards.php` (NOT DTDCards.php as originally " +
        "assumed) only has commented-out, unimplemented `aether_dart_{red,yellow,blue}` stubs. " +
        "The card's REAL logic lives in the shared set-dictionary file " +
        "`third_party/talishar/CardDictionaries/Uprising/UPRWizard.php` lines 105-108: a single " +
        "case arm covering all three pitch IDs computes `$damage` via a `match()` on `$cardID`, " +
        'then calls `DealArcane($damage, 2, "PLAYCARD", $cardID, false, $currentPlayer, ' +
        "resolvedTarget: $target)` — no attack step, no combat chain, resolves as a direct-damage " +
        "instant/action. `DealArcane()` itself (defined " +
        "`third_party/talishar/CardDictionaries/ArcaneRising/ARCWizard.php` line 221) queues a " +
        "target-selection + damage-prevention decision-queue chain culminating in an " +
        "`ARCANEHITEFFECT` case (`third_party/talishar/GameLogic.php` line 1710) that calls " +
        "`ArcaneHitEffect()` then `IncrementClassState($player, $CS_ArcaneDamageDealt, $dqVars[0])` " +
        "— this is the CONCRETE increment site for the dedicated arcane-damage-dealt counter " +
        "(confirmed genuinely new territory for the brain; see the minted tal-recipe note).",
    },
    {
      note: "tal-recipe-classstate-counter",
      reason:
        "documents the generic 3-file ClassState-declaration dance (Constants.php/StartHelper.php " +
        "/call-site), which the `$CS_ArcaneDamageDealt = 57` constant (Constants.php line 361) " +
        "does follow, but it doesn't document arcane damage's own increment site (GameLogic.php's " +
        "ARCANEHITEFFECT case, not a card's own PlayAbility/ProcessTrigger) or the split between " +
        "$CS_ArcaneDamageDealt (self-dealt, checked by e.g. runechant aura trigger) and the " +
        "differently-typed $CS_DamageDealt used for non-combat non-arcane damage " +
        "(`CoreLogic.php`'s `FinalizeDamage()`) — see the new note minted from this dossier.",
    },
  ],
  imageReference:
    "https://cardvault.fabtcg.com/card/aether-dart-1/ (also UPR173/UPR174/UPR175 in third_party/flesh-and-blood-cards)",
};

let warmongersDossier: string;
let aetherDartDossier: string;

beforeAll(() => {
  warmongersDossier = formatDossier(warmongersInput);
  aetherDartDossier = formatDossier(aetherDartInput);
  // Side effect: also persist the real dossier files (same as a live skill run would), so a
  // session picking up after this test run has the gitignored working artifacts on disk.
  // Purely additive — no assertion below depends on these files existing beforehand or after.
  mkdirSync(DOSSIERS_DIR, { recursive: true });
  writeFileSync(
    join(DOSSIERS_DIR, "warmongers-diplomacy.md"),
    warmongersDossier,
  );
  writeFileSync(join(DOSSIERS_DIR, "aether-dart.md"), aetherDartDossier);
});

describe("TAL-024: Warmonger's Diplomacy dossier (multi-hero sequential-choice stress test)", () => {
  it("cites the real true text verbatim from Card Vault", () => {
    expect(warmongersDossier).toMatch(
      /Starting with the hero to your left, each hero chooses war or peace/,
    );
    expect(warmongersDossier).toMatch(
      /only actions they may play or activate during their next turn are weapon and attack actions/,
    );
    expect(warmongersDossier).toMatch(/cardvault\.fabtcg\.com/);
  });

  it("cites the REAL implementation (not the commented-out CardObjects stub)", () => {
    // The design doc assumed UPRCards.php; direct code study found the real logic lives in
    // DTDShared.php's WarmongersDiplomacy() helper + CurrentEffectAbilities.php/CardDictionary.php
    // restriction checks — the dossier must cite the real files, not the wrong assumed one.
    expect(warmongersDossier).toMatch(
      /CardDictionaries\/DuskTillDawn\/DTDShared\.php/,
    );
    expect(warmongersDossier).toMatch(/WarmongersDiplomacy/);
    expect(warmongersDossier).toMatch(/ADDTHEIRNEXTTURNEFFECT/);
  });
});

describe("TAL-024: Aether Dart dossier (direct arcane-damage stress test)", () => {
  it("cites the real true text verbatim from Card Vault", () => {
    expect(aetherDartDossier).toMatch(/Deal 3 arcane damage to any target/);
    expect(aetherDartDossier).toMatch(/cardvault\.fabtcg\.com/);
  });

  it("cites the REAL implementation and the dedicated arcane-damage ClassState counter", () => {
    // The design doc assumed the increment lived in CardLogic.php; direct code study found the
    // constant is declared in Constants.php and actually incremented in GameLogic.php's
    // ARCANEHITEFFECT decision-queue case — the dossier must cite what was really found.
    expect(aetherDartDossier).toMatch(
      /CardDictionaries\/Uprising\/UPRWizard\.php/,
    );
    expect(aetherDartDossier).toMatch(/DealArcane/);
    expect(aetherDartDossier).toMatch(/CS_ArcaneDamageDealt/);
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
