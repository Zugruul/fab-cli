---
tags: [talishar, architecture, card-recipe, card-object-model]
paths: []
strength: 1
source: "third_party/talishar/Classes/Card.php; third_party/talishar/Classes/CardObjects/AAZCards.php; third_party/talishar/CardDictionary.php; third_party/talishar/New Developer Guide.md; Talishar/Talishar#1370"
graduated: false
created: 2026-07-18
---

New card behavior is implemented as a PHP class in `Classes/CardObjects/{SET}Cards.php` — one file
per set (e.g. `third_party/talishar/Classes/CardObjects/OMNCards.php`), extending the base `Card`
class (`third_party/talishar/Classes/Card.php`). `zzCardCodeGenerator.php` at the repo root
auto-populates stats/types/subtypes/pitch/cost/keywords from a the-fab-cube JSON dataset first
(`New Developer Guide.md`, "Generated Code") — even a card simple enough to be fully auto-generated
still needs a class with only `__construct` defined, because deck-loading checks for an
implementing class to flag unreleased-set cards as playable.

`__construct($controller)` sets `$this->cardID` (the card's slug identifier) and
`$this->controller` (the owning player). Only implement the hooks a given card actually needs;
everything else falls back to the base `Card` class default.

Base `Card` class hooks (`third_party/talishar/Classes/Card.php` lines 46–194): `PlayAbility`
(resolution ability), `SpecificLogic` (runs after a DQ/Await block finishes — see
[[tal-arch-decision-queue-await]]), `ProcessTrigger`, `IsPlayRestricted`, `PayAdditionalCosts`,
`PayAbilityAdditionalCosts`, `EquipPayAdditionalCosts`, `CombatEffectActive`,
`EffectPowerModifier` (see [[tal-arch-layer-stack-combatchain]]/[[tal-recipe-combat-modifiers]]),
`AbilityPlayableFromCombatChain`, `GoesOnCombatChain`, `NumUses`,
`OnDefenseReactionResolveEffects`, `OnBlockResolveEffects`, `ProcessAbility`,
`CanPlayAsInstant`/`CanActivateAsInstant`.

**Breadth**: the list above is only a starting sample, not the ceiling — `Classes/Card.php` has
**~192 overridable methods** total (verified: `grep -c "^  function " Classes/Card.php`), covering
nearly every mechanical keyword as a `Has*`/`*Ability`/`*Amount`/`*Effect`-style hook, typically in
triplets. Confirmed additional examples worth knowing by name: `HasWard`/`WardAmount` (Ward),
`HasStealth` (Stealth), `HasCombo`/`ComboActive` (Combo), `AwakenAbility` (Awaken), and `IsUnique`
(the Unique-card restriction) — all present at their own line numbers in `Classes/Card.php` as of
this verification pass. Don't try to enumerate all ~192 here; grep the file directly when you need
the full hook surface for a specific keyword.

`Classes/CardObjects/` holds 53 files, one per set. Some files contain large blocks of
**commented-out stub classes** for cards in that set not yet implemented — confirmed example:
`Classes/CardObjects/AAZCards.php` has multiple `// class {slug} extends Card { ... }` blocks
commented out in full. A future card-implementation session opening a set file and finding dead,
commented code sitting alongside real classes should treat that as expected (a placeholder for
work not yet done in that set), not a sign of file corruption.

To route into these hooks from procedural engine code (for cards not yet migrated to the
Card-object style), the pattern is `$card = GetClass($card, $player); if ($card != "-")
$card->Method();` — `third_party/talishar/CardDictionary.php` line 4597 defines `GetClass`,
returning `"-"` (a string sentinel, not `null`/`false`) when no object exists for the given
`cardID`.

The full worked skeleton implementing these hooks for a real merged card
(`Talishar/Talishar#1370`, Astral Strike) lives in [[tal-recipe-base-card]]; specific recipe
variations (modal choose-1, ClassState-gated counters, suffixed `CurrentTurnEffect`s, the windup
dual-mode archetype) each have their own note under `tal-recipe-*`.
