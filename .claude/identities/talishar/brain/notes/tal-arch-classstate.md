---
tags: [talishar, classstate, architecture]
paths: []
strength: 1
source: "third_party/talishar/Constants.php; third_party/talishar/CardGetters.php; third_party/talishar/Classes/ClassState.php; Talishar/Talishar#1370"
graduated: false
created: 2026-07-18
---

**ClassState** is the engine's mechanism for per-turn counters — things like "how many auras has
this player destroyed this turn" or "how many actions has this player played this turn" — that card
logic checks with simple thresholds (`GetClassState($player, $CS_X) > 0`, `>= 3`, etc.). It is a
flat indexed array (`$mainClassState`/`$defClassState`/`$myClassState`/`$theirClassState`
depending on gamestate view), one slot per constant declared in `third_party/talishar/Constants.php`
(over 130 constants as of this writing, e.g. `$CS_NumBoosted = 1`, `$CS_DamageTaken = 6`,
`$CS_CardsBanished = 5`, `$CS_NumLightningFlowDestroyed = 116`).

The array is reset once per turn by `ResetMainClassState()` (`Constants.php`, ~line 673) — a single
giant function that zeroes every counter via one huge `global $CS_...;` declaration list followed
by `$mainClassState[$CS_X] = 0;` assignments, one per constant. This reset-per-turn semantics is
what makes ClassState specifically a *per-turn* counter mechanism, distinct from persistent
game-long state.

Reads route through `third_party/talishar/CardGetters.php` line 120's
`GetPlayerClassState($player)`, the shared accessor both `GetClassState()` and
`IncrementClassState()` use to pick the correct one of the four state arrays. The higher-level
`third_party/talishar/Classes/ClassState.php` class wraps commonly-checked counters as named
convenience getters (`NumBoosted()`, `DamageTaken()`, etc.) over the same underlying array — it's
an ergonomic layer, not a separate storage mechanism.

Because the starting values are written positionally into the flat `GameFile.txt` line format (see
[[tal-arch-gamefile-lifecycle]]), adding a new counter is a three-file exercise, not a
single-file one — full step-by-step recipe with two independently-verified worked examples
(`$CS_NumLightningFlowDestroyed`, `$CS_NumMightDestroyed`/`$CS_NumVigorDestroyed`) lives in
[[tal-recipe-classstate-counter]]. See [[tal-recipe-base-card]] for a card that gates its ability on
a ClassState read.
