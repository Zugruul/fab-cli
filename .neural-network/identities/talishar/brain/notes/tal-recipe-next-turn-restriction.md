---
tags: [talishar, recipe, currentturneffect, next-turn, two-player]
paths: []
entities: [card:warmongers-diplomacy]
strength: 1
source: "third_party/talishar/CardDictionaries/DuskTillDawn/DTDShared.php; third_party/talishar/GameLogic.php; third_party/talishar/CardLogic.php; third_party/talishar/CardDictionary.php; third_party/talishar/CurrentEffectAbilities.php"
graduated: false
created: 2026-07-19
---

**A card whose true text reads "each hero chooses..." and restricts a FUTURE turn (not the current
one) is implemented as two sequential same-shape modal queues, one per player, each landing its
result on the OTHER player's next-turn CurrentTurnEffects — not a loop over N heroes.** Confirmed by
direct code study while dossiering Warmonger's Diplomacy (TAL-024): the engine is a strictly
2-player engine (`$currentPlayer`/`$otherPlayer` or `mainPlayer`/`defPlayer`), so "each hero" in
card text always compiles down to exactly two calls, not a generic multi-target loop.

**The real shape** (`third_party/talishar/CardDictionaries/DuskTillDawn/DTDShared.php`, the
`warmongers_diplomacy_blue` case in the set's shared `PlayAbility()` dispatch, line 488):

```php
case "warmongers_diplomacy_blue":
  WarmongersDiplomacy($otherPlayer);
  AddDecisionQueue("ADDTHEIRNEXTTURNEFFECT", $otherPlayer, "<-");
  WarmongersDiplomacy($currentPlayer);
  AddDecisionQueue("ADDTHEIRNEXTTURNEFFECT", $currentPlayer, "<-");
  return "";

function WarmongersDiplomacy($player)
{
  AddDecisionQueue("SETDQCONTEXT", $player, "Choose if you want to make {{element|War|5}} or {{element|Peace|6}}");
  AddDecisionQueue("BUTTONINPUT", $player, "War,Peace");
  AddDecisionQueue("SETDQVAR", $player, "0", 1);
  AddDecisionQueue("WRITELOG", $player, "Player $player chose <b>{0}</b>", 1);
  AddDecisionQueue("PREPENDLASTRESULT", $player, "Warmongers");
}
```

Three pieces make this work, none of which is covered by [[tal-recipe-modal-choose1]] (which
documents the BUTTONINPUT-modal shape itself, correctly reused here, but nothing about applying the
result to a DIFFERENT player's FUTURE turn):

1. **The same modal helper is called twice, once per player** — confirming the engine never has to
   handle more than two heroes; "starting with the hero to your left" is realized purely as
   call-order (`$otherPlayer` first, then `$currentPlayer`), not as an actual queue/list of heroes.
2. **`PREPENDLASTRESULT ... "Warmongers"`** tags the chosen button value ("War"/"Peace") into an
   effect ID string (`WarmongersWar`/`WarmongersPeace`) — a naming convention, not a new mechanism.
3. **`ADDTHEIRNEXTTURNEFFECT`** (`third_party/talishar/GameLogic.php` ~line 1324) is the genuinely
   new piece — a decision-queue command that registers the chosen effect for the OTHER player's
   NEXT turn, not the current turn:
   ```php
   case "ADDTHEIRNEXTTURNEFFECT":
     $numTurns = $player == $mainPlayer ? 2 : 1;
     AddNextTurnEffect($parameter, $player, numTurns: $numTurns);
     return "1";
   ```
   It delegates to `AddNextTurnEffect()` (`third_party/talishar/CardLogic.php` line 187), the same
   `$nextTurnEffects` array `AddCurrentTurnEffect()`'s sibling mechanism promotes into
   CurrentTurnEffects at the start of a turn — but the `$numTurns = $player == $mainPlayer ? 2 : 1`
   branch is the sharp, non-obvious detail: because turn parity differs depending on whose turn it
   currently is, the SAME player needs a different "how many turn-boundaries away" count depending
   on whether they're the player-to-move right now or not, to land on their own actual next turn
   rather than their opponent's. `ADDTHEIRNEXTTURNEFFECT` is used EXACTLY ONCE in the whole engine
   (grep confirmed) — this pattern has no other precedent to crib from.

**The restriction itself is read back from multiple call sites**, not one central check — a card
implementing a future-turn action-type restriction should expect to add checks wherever the
restricted action type is validated: `third_party/talishar/CardDictionary.php`'s `CanAttack()`
(line 1539, `SearchCurrentTurnEffects("WarmongersPeace", ...)`) and `CanPlayNAA()` (line 1574,
`"WarmongersWar"`), plus `third_party/talishar/CurrentEffectAbilities.php`'s
`EffectAttackRestricted()` (line 2600) and `EffectPlayCardRestricted()` (lines 2682/2686) — the
same `WarmongersWar`/`WarmongersPeace` effect-ID string is matched in all four places.

See [[tal-recipe-modal-choose1]] for the shared BUTTONINPUT-modal shape, and
[[tal-recipe-currentturneffect-suffix]] for the SAME-turn, SAME-player suffix-discriminator pattern
this note's cross-player, next-turn pattern is a genuine departure from.
