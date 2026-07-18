---
tags: [talishar, recipe, currentturneffect]
paths: []
strength: 1
source: "third_party/talishar/CLAUDE.md; Talishar/Talishar#1370; third_party/talishar/Classes/CardObjects/OMNCards.php"
graduated: false
created: 2026-07-18
entities: [card:astral-strike]
---

One card can register **multiple independently-tracked continuous combat effects** without
separate classes, by suffixing its `cardID` when calling `AddCurrentTurnEffect()`:

```php
case "Buff_Power": AddCurrentTurnEffect($this->cardID . "-BUFF", $this->controller); break;
case "Go_Again": AddCurrentTurnEffect($this->cardID . "-GOAGAIN", $this->controller); break;
```

`CombatEffectActive($parameter, ...)`/`EffectPowerModifier($param, ...)` then distinguish which
effect is currently live purely by string-matching the `$parameter`/`$param` suffix:

```php
function CombatEffectActive($parameter = '-', $defendingCard = '', $flicked = false) {
  return $parameter == "BUFF" || $parameter == "GOAGAIN";
}

function EffectPowerModifier($param, $attached = false) {
  if ($param == "BUFF") return 2;
  return 0;
}
```

This is how a single modal card (Astral Strike, see [[tal-recipe-modal-choose1]]) can grant one of
two *different* continuous effects depending on player choice, from one `Card` subclass, without
needing per-mode subclasses — the suffix string is effectively a mode discriminator carried through
the layer-continuous-effect machinery described in [[tal-arch-layer-stack-combatchain]].

Contrast with [[tal-recipe-combat-modifiers]], which catalogues cards that DON'T need suffixing
because they only ever register one continuous effect at a time.
