# Talishar Card Recipe

Last verified against upstream: 2026-07-18

Self-sufficient working reference for implementing a card in the vendored PHP engine
(`third_party/talishar`). This file alone should be enough to hand-implement a card matching the
`Talishar/Talishar#1369`/`#1370` shape (a modal effect gated on a ClassState counter) without
opening `docs/TALISHAR-ARCHITECTURE.md`. See that doc's "Card Recipe: A Worked Example" section for
the deeper narrative, and `decision-queue.md` for DQ/Await semantics used inside the hooks below.

Citation rule: every claim below cites a vendored path in backticks or an upstream PR/issue number
(§7.1a/§7.5a of `SPEC-TALISHAR.md`).

## 1. Where the code lives

New card behavior is a PHP class in `Classes/CardObjects/{SET}Cards.php`, one file per set (e.g.
`` `third_party/talishar/Classes/CardObjects/OMNCards.php` ``), extending the base `Card` class
(`` `third_party/talishar/Classes/Card.php` ``). `zzCardCodeGenerator.php` at the repo root
auto-populates stats/types/subtypes/pitch/cost/keywords from a the-fab-cube JSON dataset first
(`` `third_party/talishar/New Developer Guide.md` ``, "Generated Code") — even a card simple enough
to be fully auto-generated still needs a class with only `__construct` defined, because deck-loading
checks for an implementing class to flag unreleased-set cards as playable.

`__construct($controller)` sets `$this->cardID` (the card's slug identifier) and
`$this->controller` (the owning player). Only implement the hooks a given card actually needs —
leave the rest to the base `Card` class defaults.

## 2. Full `Card` class skeleton (the #1370 shape)

Worked example: `Talishar/Talishar#1370` ("feat: implement Astral Strike card (OMN145)", merged,
author `brenoos`, approved by `Pgibby8`) — a Lightning Action Attack whose resolution ability is a
"choose 1 of 3" modal gated on a ClassState counter. Condensed from the PR's actual diff (`gh pr
diff 1370 --repo Talishar/Talishar`), added to
`` `third_party/talishar/Classes/CardObjects/OMNCards.php` ``:

```php
class astral_strike_red extends Card {
  function __construct($controller) {
    $this->cardID = "astral_strike_red";
    $this->controller = $controller;
  }

  function PlayAbility($from, $resourcesPaid, $target = '-', $additionalCosts = '-', $uniqueID = '-1', $layerIndex = -1) {
    global $CS_NumLightningFlowDestroyed;
    if (GetClassState($this->controller, $CS_NumLightningFlowDestroyed) > 0) {
      AddDecisionQueue("SETDQCONTEXT", $this->controller, "Choose a mode for " . CardLink($this->cardID));
      AddDecisionQueue("BUTTONINPUT", $this->controller, "Draw_a_Card,Buff_Power,Go_Again");
      AddDecisionQueue("SHOWMODES", $this->controller, $this->cardID, 1);
      Await($this->controller, $this->cardID, final:true);
    }
    return "";
  }

  function SpecificLogic() {
    global $dqVars;
    AddLayer("TRIGGER", $this->controller, $this->cardID, additionalCosts:$dqVars["LASTRESULT"]);
  }

  function ProcessTrigger($uniqueID, $target = "-", $additionalCosts = "-", $from = "-") {
    switch ($additionalCosts) {
      case "Draw_a_Card": Draw($this->controller); break;
      case "Buff_Power": AddCurrentTurnEffect($this->cardID . "-BUFF", $this->controller); break;
      case "Go_Again": AddCurrentTurnEffect($this->cardID . "-GOAGAIN", $this->controller); break;
    }
  }

  function CombatEffectActive($parameter = '-', $defendingCard = '', $flicked = false) {
    return $parameter == "BUFF" || $parameter == "GOAGAIN";
  }

  function EffectPowerModifier($param, $attached = false) {
    if ($param == "BUFF") return 2;
    return 0;
  }
}
```

A second real example of the same modal pattern is `Talishar/Talishar#1369` ("feat: implement
Voltbound Duality (OMN077/078/079)"), which additionally demonstrates the `windup` dual-mode
archetype (an instant-or-attack card whose two modes share one class via an `$archetype` object —
`` `third_party/talishar/New Developer Guide.md` ``'s `$archetype` note and
`` `third_party/talishar/Classes/CardObjects/HVYCards.php` `` for the archetype's home).

## 3. The hook signatures

From `` `third_party/talishar/Classes/Card.php` `` lines 46–194 (summarized in
`` `third_party/talishar/CLAUDE.md` ``'s "Card Implementation Pattern"), the hooks this recipe
uses:

- **`PlayAbility($from, $resourcesPaid, $target = '-', $additionalCosts = '-', $uniqueID = '-1', $layerIndex = -1)`**
  — the card's resolution ability. Return value is usually `""`; DQ/Await calls queued inside it
  run asynchronously (see `decision-queue.md`).
- **`SpecificLogic()`** — runs after the queued DQ/Await block finishes (the "code after a DQ"
  pattern; historically achieved via the `SPECIFICCARD` DQ command, now more commonly via
  `Await($this->controller, $this->cardID, final:true)` routing here). Typically pushes a
  `TRIGGER` layer via `AddLayer(...)` so the actual effect resolves later, in order, on the stack.
- **`ProcessTrigger($uniqueID, $target = "-", $additionalCosts = "-", $from = "-")`** — where the
  `TRIGGER` layer pushed by `SpecificLogic()` actually resolves; branch on `$additionalCosts` (or
  `$target`) to apply the chosen mode's effect.
- **`CombatEffectActive($parameter = '-', $defendingCard = '', $flicked = false)`** — returns
  whether a layer-continuous combat effect currently applies to the attack on the chain. Per the
  base class's default, the effect disappears once its chain link closes unless
  `IsCombatEffectPersistent()` is overridden to return true (`` `third_party/talishar/Classes/Card.php` ``).
- **`EffectPowerModifier($param, $attached = false)`** — how much power to add when
  `CombatEffectActive` is true for that `$param`. Consumed by
  `` `third_party/talishar/CombatChain.php` ``'s `LinkBasePower()` (~line 2038), which walks
  `$currentTurnEffects` and every prior `ChainLinks` entry
  (`` `third_party/talishar/Classes/ChainLinks.php` ``) applying these modifiers card-by-card.

Other hooks available on the base class for cards that need them (not used in the #1370 example
above): `IsPlayRestricted`, `PayAdditionalCosts`, `PayAbilityAdditionalCosts`,
`EquipPayAdditionalCosts`, `AbilityPlayableFromCombatChain`, `GoesOnCombatChain`, `NumUses`,
`OnDefenseReactionResolveEffects`, `OnBlockResolveEffects`, `ProcessAbility`,
`CanPlayAsInstant`/`CanActivateAsInstant` (`` `third_party/talishar/Classes/Card.php` ``, same
line range).

To route into these hooks from procedural engine code (for cards not yet migrated to the
Card-object style), the pattern is `$card = GetClass($card, $player); if ($card != "-")
$card->Method();` — `` `third_party/talishar/CardDictionary.php `` line 4597 defines `GetClass`,
returning `"-"` when no object exists for the given `cardID`.

## 4. ClassState: the three-file dance

ClassState tracks per-turn counters (e.g. "how many auras has this player destroyed this turn")
that card logic checks with a simple threshold. Confirmed against `Talishar/Talishar#1370`, which
added `$CS_NumLightningFlowDestroyed`. To add a new counter, touch exactly three files:

1. **`` `third_party/talishar/Constants.php` ``** — declare the counter as a sequential global
   index constant (`$CS_NumLightningFlowDestroyed = 116;`, immediately after the current highest
   index), add it to the `global` declaration list inside `ResetMainClassState()` (~line 673), and
   initialize it to `0` in the same function's body.
2. **`` `third_party/talishar/MenuFiles/StartHelper.php` ``** — `initializePlayerState()` writes
   the game's starting ClassState line (currently the `fwrite()` at ~line 45, though the exact line
   shifts as constants are added — grep the file for `//Class State`) as a space-joined string of
   literal zeros, one per constant; adding a constant means appending one more `0` to that literal
   string so `ParseGamestate.php`'s positional unpacking stays aligned.
3. **The trigger call site** — wherever the tracked event actually happens, call
   `IncrementClassState($player, $CS_YourConstant)`. For `Talishar/Talishar#1370` this is
   `` `third_party/talishar/AuraAbilities.php` ``'s `DestroyAura()`, incrementing the counter
   whenever the destroyed aura's `cardID == "lightning_flow"`.

A fourth, read-only step to *check* the counter — `GetClassState($player, $CS_YourConstant) > 0` —
doesn't touch new files: `` `third_party/talishar/CardGetters.php `` line 120's
`GetPlayerClassState($player)` is the shared accessor both getter and setter paths route through.
The higher-level `` `third_party/talishar/Classes/ClassState.php` `` class wraps common named
counters (`NumBoosted()`, `DamageTaken()`, etc.) as convenience getters over the same array — you
only need to touch it if you want a named accessor instead of calling `GetClassState()` directly.

`Talishar/Talishar#1370`'s diff touches exactly these three files plus the new card class itself
and `` `third_party/talishar/CLAUDE.md` `` (documenting the pattern) — confirming the dance is
scoped to those three plus the call site.

## 5. `CurrentTurnEffect` with suffixed IDs

One card can register multiple named layer-continuous effects by suffixing its `cardID`:
`AddCurrentTurnEffect($this->cardID . "-BUFF", $this->controller)` vs.
`AddCurrentTurnEffect($this->cardID . "-GOAGAIN", $this->controller)` in the skeleton above.
`CombatEffectActive`/`EffectPowerModifier` then distinguish the active effect by its
`$parameter`/`$param` suffix (`` `third_party/talishar/CLAUDE.md` ``, "CurrentTurnEffect with
Suffixed IDs"). This is how one card grants several independently-tracked continuous effects
without separate classes.

## 6. Modal choose-1 pattern, in short

For "choose 1 of N" modal effects specifically: a `BUTTONINPUT` DQ (`SHOWMODES` for the UI prompt)
combined with `Await(..., final:true)` and a `TRIGGER` layer, so the chosen effect resolves through
`ProcessTrigger()` rather than directly inside `SpecificLogic()` — keeping it correctly ordered on
the layer stack (`` `third_party/talishar/CLAUDE.md` ``, "Modal Choose-1 Pattern";
`Talishar/Talishar#1370`). See `decision-queue.md` for the full DQ/Await verb reference used here.

## 7. Validation checklist before opening a PR

- `php -l` the touched files (syntax check).
- Bring up the local docker stack (`dev-stack.md`), start a game using the card, exercise every
  implemented hook (play, trigger, block/defend if relevant).
- Card behavior is derived from live Card Vault true text + the-fab-cube stats + current CR — never
  from remembered card text (§10 I4 of `SPEC-TALISHAR.md`).
- See `contributing.md` for PR title/body conventions and the no-upstream-PR invariant — this
  recipe only prepares a branch on the user's fork; a human opens the PR.
