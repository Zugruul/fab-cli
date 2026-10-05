---
tags: [talishar, classstate, recipe, per-turn-counter]
paths: []
strength: 1
source: "third_party/talishar/Constants.php; third_party/talishar/MenuFiles/StartHelper.php; third_party/talishar/AuraAbilities.php; Talishar/Talishar#1370"
graduated: false
created: 2026-07-18
entities: [card:lightning-flow, card:might, card:vigor]
---

**How to add a new ClassState per-turn counter — exactly three files, in this order:**

1. **`third_party/talishar/Constants.php`** — declare the counter as the next sequential global
   index constant right after the current highest index (e.g. `$CS_NumLightningFlowDestroyed =
   116;` was added immediately after the prior max). Then, inside `ResetMainClassState()`
   (~line 673), add the new variable to that function's giant `global $CS_...;` declaration list
   AND initialize it to `0` in the function body (`$mainClassState[$CS_YourConstant] = 0;`).
   Both edits are in the same file/function.
2. **`third_party/talishar/MenuFiles/StartHelper.php`** — `initializePlayerState()` `fwrite()`s the
   game's starting ClassState line as one long space-joined string of literal `0`s (currently
   around line 45; grep the file for `//Class State` since the exact line shifts as constants get
   added). Adding a constant means appending exactly one more literal `0` to that string — this is
   a *positional* format, so `ParseGamestate.php`'s unpacking breaks if the zero count doesn't match
   the constant count in Constants.php.
3. **The trigger call site** — wherever the tracked game event actually fires, call
   `IncrementClassState($player, $CS_YourConstant)` (optionally with a `$number` amount). This file
   varies per counter; it is NOT one of the two files above. `third_party/talishar/AuraAbilities.php`
   is the real call site for the two worked examples below, but for a non-aura-related counter it
   could be `CardLogic.php`, `CombatChain.php`, `CharacterAbilities.php`, etc. — find it by tracing
   the actual rules event.

**Two independently-verified real examples, both aura-destruction counters incremented in
`third_party/talishar/AuraAbilities.php`:**

- `$CS_NumLightningFlowDestroyed = 116` (Constants.php) — added by `Talishar/Talishar#1370` ("Add
  `$CS_NumLightningFlowDestroyed` ClassState variable") to gate Astral Strike's modal. Incremented
  in `AuraAbilities.php`'s `DestroyAura()` when the destroyed aura's `cardID == "lightning_flow"`.
- `$CS_NumMightDestroyed = 72` and `$CS_NumVigorDestroyed = 71` (Constants.php, both declared
  together, confirming counters get added in small batches, not always one-at-a-time) — incremented
  directly in `AuraAbilities.php`'s aura-destruction `switch` statement:
  ```php
  case "might":
    AddCurrentTurnEffect($auras[$i], $mainPlayer, "PLAY");
    DestroyAuraUniqueID($mainPlayer, $auras[$i + 6]);
    IncrementClassState($mainPlayer, $CS_NumMightDestroyed, 1);
    ++$mightCount;
    break;
  case "vigor":
    GainResources($mainPlayer, 1);
    DestroyAuraUniqueID($mainPlayer, $auras[$i + 6]);
    IncrementClassState($mainPlayer, $CS_NumVigorDestroyed, 1);
    ++$vigorCount;
    break;
  ```
  Both examples confirm the pattern: `DestroyAuraUniqueID()` (or the equivalent destroy/consume
  call) fires first, `IncrementClassState()` immediately after, in the same `switch` arm.

**Reading the counter afterward** (a 4th step that touches NO new files):
`GetClassState($player, $CS_YourConstant) > 0` — routes through
`third_party/talishar/CardGetters.php` line 120's `GetPlayerClassState($player)`, the shared
accessor both getter and setter paths use, returning whichever of
`$mainClassState`/`$defClassState`/`$myClassState`/`$theirClassState` applies to the current
gamestate view. `third_party/talishar/Classes/ClassState.php` wraps common named counters
(`NumBoosted()`, `DamageTaken()`, etc.) as convenience getters over the same array — only touch it
if you want a named accessor instead of calling `GetClassState()` directly.

`Talishar/Talishar#1370`'s diff touches exactly the three files above plus the new card class
itself and `third_party/talishar/CLAUDE.md` (documenting the pattern) — confirming the dance really
is scoped to those three plus the call site, nothing more.

See [[tal-arch-classstate]] for the architectural "why" (per-turn counters checked by threshold),
[[tal-recipe-base-card]] for how `GetClassState()` gates a card's `PlayAbility()`, and
[[tal-recipe-combat-modifiers]] for a different family of per-attack (not per-turn) state.
