---
tags: [talishar, recipe, card-implementation]
paths: []
strength: 1
source: "Talishar/Talishar#1370; third_party/talishar/Classes/CardObjects/OMNCards.php; third_party/talishar/Classes/Card.php"
graduated: false
created: 2026-07-18
entities: [card:astral-strike]
---

Full worked skeleton for a card that combines the ClassState-gated modal pattern, the
`TRIGGER`-layer indirection, and suffixed `CurrentTurnEffect`s — condensed from
`Talishar/Talishar#1370`'s actual merged diff (`gh pr diff 1370 --repo Talishar/Talishar`), added to
`third_party/talishar/Classes/CardObjects/OMNCards.php`:

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

Reading this end to end: `PlayAbility()` first checks the ClassState gate
(`GetClassState($this->controller, $CS_NumLightningFlowDestroyed) > 0` — see
[[tal-recipe-classstate-counter]]) before even offering the modal; if gated open, it queues the
`SETDQCONTEXT`/`BUTTONINPUT`/`SHOWMODES` DQ trio then `Await(..., final:true)` — see
[[tal-recipe-modal-choose1]] for why this exact combination. Because DQs are asynchronous
([[tal-arch-decision-queue-await]]), the chosen button's value only becomes available in
`SpecificLogic()`, which reads it via `$dqVars["LASTRESULT"]` and pushes a `TRIGGER` layer rather
than applying the effect inline — so the effect resolves in stack order via `ProcessTrigger()`.
`ProcessTrigger()` branches on the chosen mode string and, for the two modes that grant a
continuous combat bonus, calls `AddCurrentTurnEffect($this->cardID . "-BUFF" | "-GOAGAIN", ...)` —
the suffixed-ID pattern, detailed in [[tal-recipe-currentturneffect-suffix]]. Finally
`CombatEffectActive`/`EffectPowerModifier` distinguish which suffix is live by its `$parameter`/
`$param` value, feeding into `CombatChain.php`'s `LinkBasePower()` (see
[[tal-arch-layer-stack-combatchain]]).

`Talishar/Talishar#1370`'s diff touches exactly this new class plus the three ClassState-dance
files ([[tal-recipe-classstate-counter]]) and `third_party/talishar/CLAUDE.md` — nothing else, a
useful sanity check for how contained a well-scoped card PR should be.
