---
tags: [talishar, recipe, windup, archetype, dual-mode]
paths: []
strength: 1
source: "third_party/talishar/Classes/CardObjects/HVYCards.php; third_party/talishar/Classes/CardObjects/OMNCards.php; Talishar/Talishar#1369"
graduated: false
created: 2026-07-18
---

The **windup** archetype is the recipe for an instant-or-attack "duality" card whose two play modes
share one implementation instead of two separate `Card` subclasses. Confirmed by direct code study
of `third_party/talishar/Classes/CardObjects/HVYCards.php` lines 1–57 (the archetype's home) and its
real consumers in `OMNCards.php` (e.g. `nebula_duality`, one of several duality base classes there).

**Shape**: a plain (non-`Card`-extending) helper class, `windup`, constructed with `($cardID,
$controller)` and held as a `public $archetype` property on the card's own base class:

```php
class windup {
  public $cardID;
  public $controller;
  function __construct($cardID, $controller) { ... }
  function GetAbilityTypes($index = -1, $from = '-') { return "I,AA"; }             // Instant or Action Attack
  function GetAbilityNames(...) { return GetEasyAbilityNames($this->cardID, ...); }
  function GoesOnCombatChain($phase, $from) {
    global $layers;
    return ($phase == "B" && count($layers) == 0) || GetResolvedAbilityType($this->cardID, $from) == "AA";
  }
  function CanActivateAsInstant($index = -1, $from = '') { return ($from == "HAND"); }
  function CardCost($from = '-') {
    if (GetResolvedAbilityType($this->cardID, "HAND") == "I" && $from == "HAND") return 0;
    return 3;
  }
  function AddPrePitchDecisionQueue($from, $index = -1, $facing="-") {
    // presents a BUTTONINPUT choice between "play the ability" and "attack" before pitching,
    // via SETABILITYTYPE / SETABILITYTYPEABILITY / SETABILITYTYPEATTACK DQ commands
  }
}
```

`GetAbilityTypes()` returning `"I,AA"` (Instant, Action Attack) is the archetype's core signal: the
card can resolve either as a cheap instant-speed ability or as a full attack, and
`AddPrePitchDecisionQueue()` is where the player is actually asked which, before the card commits to
a mode.

A real consumer (`OMNCards.php`'s `nebula_duality` base class, delegated to by
`nebula_duality_red`/`_yellow`/`_blue` pitch variants):

```php
class nebula_duality extends BaseCard {
  public $archetype;
  function __construct($cardID, $controller = '-') {
    $this->cardID = $cardID;
    $this->controller = $controller;
    $this->archetype = new windup($this->cardID, $this->controller);
  }
  function PlayAbility($damage, $target) {
    DealArcane($damage, source:$this->cardID, player:$this->controller, resolvedTarget:$target);
    return "";
  }
  function GetAbilityNames($index = -1, $from = '-', $foundNullTime = false, $layerCount = 0, $facing = "-", $allNames = false) {
    return $this->archetype->GetAbilityNames($index, $from, $foundNullTime, $layerCount);
  }
  function CanActivateAsInstant($index = -1, $from = '') {
    return $this->archetype->CanActivateAsInstant($index, $from);
  }
}
```

The pattern: the card's own class implements its unique effect (`PlayAbility`/`ProcessAbility`)
directly, but **delegates every generic dual-mode hook** (`GetAbilityNames`,
`CanActivateAsInstant`, and friends) to `$this->archetype`, a shared `windup` instance — so the
"is this card an instant or an attack right now" logic lives in exactly one place
(`HVYCards.php`) even though dozens of duality cards across many sets (`AHACards.php`,
`IARCards.php`, `MPWCards.php`, `OMNCards.php`, `PENCards.php` all instantiate `new
windup(...)`) use it.

Second real worked example beyond `nebula_duality`: `Talishar/Talishar#1369` ("feat: implement
Voltbound Duality (OMN077/078/079)") combines this archetype with the same modal choose-1 pattern
used by Astral Strike — see [[tal-recipe-modal-choose1]].
