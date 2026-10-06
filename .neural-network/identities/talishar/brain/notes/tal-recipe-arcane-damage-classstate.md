---
tags: [talishar, classstate, arcane, recipe, damage-type]
paths: []
entities: [card:aether-dart]
strength: 1
source: "third_party/talishar/Constants.php; third_party/talishar/GameLogic.php; third_party/talishar/CoreLogic.php; third_party/talishar/CardDictionaries/ArcaneRising/ARCWizard.php; third_party/talishar/CardDictionaries/Uprising/UPRWizard.php"
graduated: false
created: 2026-07-19
---

**Arcane damage is tracked by a DIFFERENT ClassState counter than generic combat damage, and its
increment site is not the card's own class — it's the shared `DealArcane()` resolution pipeline.**
Confirmed by direct code study while dossiering Aether Dart (TAL-024).

**The dealing side, minimal shape** — a card that deals direct arcane damage (no attack step, no
combat chain) is a one-line call in the set's shared dictionary file, not its own `PlayAbility()`:

```php
// third_party/talishar/CardDictionaries/Uprising/UPRWizard.php (aether_dart_{red,yellow,blue})
case "aether_dart_red": case "aether_dart_yellow": case "aether_dart_blue":
  $damage = match($cardID) { "aether_dart_red" => 3, "aether_dart_yellow" => 2, default => 1 };
  DealArcane($damage, 2, "PLAYCARD", $cardID, false, $currentPlayer, resolvedTarget: $target);
  return "";
```

`DealArcane($damage, $target, $type, $source, $fromQueue, $player, $mayAbility, $limitDuplicates,
$skipHitEffect, $resolvedTarget, ...)` (defined in
`third_party/talishar/CardDictionaries/ArcaneRising/ARCWizard.php` line 221 — its canonical home is
the Arcane Rising set file even though every wizard-class set calls it) queues a
target-selection/damage-prevention decision-queue chain. The chain resolves through an
`ARCANEHITEFFECT` case in `third_party/talishar/GameLogic.php` (~line 1710):

```php
case "ARCANEHITEFFECT":
  if ($dqVars[0] > 0) ArcaneHitEffect($player, $parameter, $dqState[7], $dqVars[0]); //player, source, target, damage
  if ($dqVars[0] > 0) IncrementClassState($player, $CS_ArcaneDamageDealt, $dqVars[0]);
  return $lastResult;
```

**This is the concrete increment site for `$CS_ArcaneDamageDealt` (`third_party/talishar/Constants.php` line 361,
`= 57`)** — it is NOT incremented inside the card's own class, and it is NOT the same counter as
`$CS_DamageDealt` (a separate constant used for non-combat, non-arcane damage — see
`CoreLogic.php`'s `FinalizeDamage()`, which branches on `$type == "ARCANE"` vs `$type !== "COMBAT"`
to decide which of `$CS_ArcaneDamageTaken`/`$CS_DamageDealt`/`$CS_PowDamageDealt` to touch). Three
distinct arcane-specific counters exist side by side, each answering a different question:

- `$CS_ArcaneDamageDealt` (57) — "how much arcane damage has THIS player dealt this turn" —
  incremented in the `ARCANEHITEFFECT` DQ case above. Read by e.g.
  `third_party/talishar/CardLogic.php` line 2281 (`if (GetClassState($player,
  $CS_ArcaneDamageDealt) > 0) PlayAura("runechant", $player);`) to gate a triggered aura.
- `$CS_ArcaneDamageTaken` (19) — "how much arcane damage has THIS player received this turn" —
  set inside `CoreLogic.php`'s `FinalizeDamage()` (`if ($type == "ARCANE")
  $classState[$CS_ArcaneDamageTaken] += $damage;`), a different function from the increment above.
- `$CS_ArcaneDamageDealtToOpponent` (113) — opponent-scoped variant, incremented in the same
  `FinalizeDamage()` only `if ($type == "ARCANE" && $player != $playerSource)`.

All three still follow the generic per-turn-counter shape documented in
[[tal-recipe-classstate-counter]] (declared in `Constants.php`, zeroed in `ResetMainClassState()`,
read via `GetClassState()`) — what's genuinely new here, not covered by that note or
[[tal-arch-classstate]], is that **damage-type ("ARCANE" vs "COMBAT" vs other) determines which
ClassState family gets touched, and the dealing-side counter's real increment site lives inside the
shared `DealArcane()`/`ARCANEHITEFFECT` machinery, not inside any individual card's class** — so a
future arcane-damage card implementation should call `DealArcane()` and trust the counter to update
itself, rather than trying to increment `$CS_ArcaneDamageDealt` directly.

See [[tal-arch-classstate]] for the ClassState array mechanism generally, and
[[tal-recipe-classstate-counter]] for the 3-file declaration dance every new ClassState constant
(arcane-specific or not) must follow.
