---
tags: [talishar, architecture, decision-queue, await]
paths: []
strength: 1
source: "third_party/talishar/CardLogic.php; third_party/talishar/DecisionQueue/AwaitEffects.php; third_party/talishar/New Developer Guide.md"
graduated: false
created: 2026-07-18
---

A large share of engine logic is driven by the **Decision Queue** (DQ): a queue of operations that
run as soon as they can, pending player input. Primitives in `third_party/talishar/CardLogic.php`:
`AddDecisionQueue($phase, $player, $parameter, $subsequent=0, $makeCheckpoint=0)` (line 286),
`AddLayer($cardID, $player, $parameter, ...)` (line 269), `ProcessDecisionQueue()` (line 333 —
stashes the current turn phase into `$dqState`, calls `ContinueDecisionQueue()` to advance).

**The #1 gotcha: DQs are asynchronous.** A block of DQ calls followed by regular PHP code runs the
regular code *first* — all queued DQs execute afterward. Code that must run after a DQ needs to be
inside another DQ command; historically this meant extending `SPECIFICCARD`, now more commonly
achieved by routing through `Await(..., final:true)` into a card's `SpecificLogic()` hook (see
[[tal-recipe-base-card]]).

**`Await`** (`third_party/talishar/DecisionQueue/AwaitEffects.php`) wraps DQs to remove the pain of
manually tracking `$lastResult`, using a global `$dqVars` associative array for named variables
instead. Signature: `Await($player, $function, $returnName="LASTRESULT",
$lastResultName="LASTRESULT", $subsequent=1, $final=false, $prepend=false, ...$args)`. `$function`
either names an `AwaitEffects.php` function (suffixed `Await` by convention, e.g. `"DeckTopCards"`
calls `DeckTopCardsAwait`) or, if it matches a `cardID`, routes to that card object's
`SpecificLogic()` — replacing the old `SPECIFICCARD` pattern. `$final=true` clears `$dqVars` after
the sequence's last Await.

Key DQ verbs: `MULTIZONEINDICES` (search a zone, get a MultiZone Index list — implemented by
`SearchMultizone()`/`MultiZoneIndices()` in `Search.php`/`MZLogic.php`, see
[[tal-arch-multizone-targeting]]), `(MAY)CHOOSEMULTIZONE`
(present a choice from that list), `SETDQCONTEXT` (UI helper text for the pending decision),
`MZREMOVE` (remove+return a card from its zone, does NOT move it to graveyard),
`SETLAYERTARGET`, `ELSE` (conditional branch on a prior PASS), `BUTTONINPUT` (present button
choices — paired with `SHOWMODES` for modal UI, see [[tal-recipe-modal-choose1]]),
`PASSPARAMETER`.

For "choose 1 of N" modal effects specifically, the established pattern combines a `BUTTONINPUT` DQ
with `Await(..., final:true)` and a `TRIGGER` layer so the chosen effect resolves through
`ProcessTrigger()` rather than directly inside `SpecificLogic()` — full recipe in
[[tal-recipe-modal-choose1]]. DQ/Await sequences frequently push a `TRIGGER` layer
(`AddLayer("TRIGGER", $player, $cardID, additionalCosts:...)`) — see [[tal-arch-layer-stack-combatchain]]
for how the layer stack consumes it.
