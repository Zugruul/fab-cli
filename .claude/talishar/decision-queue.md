# DecisionQueue & Await — Operational Reference

Last verified against upstream: 2026-07-18

Deeper operational depth than `architecture.md`'s overview, for actually writing DQ/Await chains.
Used by `card-recipe.md`'s hook implementations.

## Core model

DQ entries queue operations that run as soon as they can, pending user input. Primitives in
`` `third_party/talishar/CardLogic.php` ``: `AddDecisionQueue($phase, $player, $parameter,
$subsequent=0, $makeCheckpoint=0)` (line 286), `PrependDecisionQueue(...)`, `AddLayer($cardID,
$player, $parameter, ...)` (line 269), `ProcessDecisionQueue()` (line 333, stashes the current turn
phase into `$dqState` and calls `ContinueDecisionQueue()` to advance).

Each DQ entry has 4 fields:

1. `$phase` — the command to execute (see verb list below).
2. `$player` — who may decide.
3. `$parameter` — static, or `"<-"` meaning "the previous `$lastResult`".
4. `$subsequent` — 0/1 bit; if set, this entry (and the rest of the chain) is skipped if a prior DQ
   in the chain failed/was declined.

**Asynchronous execution is the #1 gotcha**: a block of DQ calls followed by regular PHP code runs
the regular code *first* — all queued DQs execute afterward. Code that must run after a DQ needs to
be inside another DQ command, historically by extending `SPECIFICCARD`
(`` `third_party/talishar/New Developer Guide.md` ``, "Decision Queue"; mirrored in
`` `third_party/talishar/CLAUDE.md` ``). In `Await`-based code this role is played by
`SpecificLogic()` (see `card-recipe.md` §3).

## DQ verb list

From `` `third_party/talishar/New Developer Guide.md` ``'s "Common DQ Commands" section and
confirmed by call sites in `` `third_party/talishar/CardLogic.php` ``:

- **`MULTIZONEINDICES`** — wraps `SearchMultizone`; returns a comma-separated MultiZone Index list
  matching a search-syntax parameter (e.g. `"THEIRAURAS"`, `"THEIRCHAR:type=E;hasNegCounters=true"`
  — real call sites at `` `third_party/talishar/CardLogic.php` `` lines 1107, 1120, 1228).
- **`(MAY)CHOOSEMULTIZONE`** — presents a choice from that index list to the player;
  `MAYCHOOSEMULTIZONE` lets the player pass. Returns the chosen MultiZone Index.
- **`SETDQCONTEXT`** — sets the decision's helper/context text shown in the UI (e.g.
  `AddDecisionQueue("SETDQCONTEXT", $player, "Choose_a_dagger_to_poke_with", 1)` —
  `` `third_party/talishar/CardLogic.php` `` line 1109). Context only persists for one choice; line
  696 clears it for static states that aren't `SETDQCONTEXT` itself.
- **`MZREMOVE`** — takes a MultiZone Index, clears the object from its zone, returns its `$cardID`.
  Does NOT move it to graveyard — follow with a DQ like `ADDDISCARD`.
- **`SETLAYERTARGET`** — takes a MultiZone Index, assigns it as the target of the topmost stack
  layer sharing the same `$cardID`.
- **`ELSE`** — encodes conditional branching purely with DQs: an `ELSE` entry with `$subsequent=0`
  runs its following block only if a prior DQ in the chain returned PASS (e.g. a declined
  `MAYCHOOSEMULTIZONE`); otherwise that block is skipped.
- **`SPECIFICCARD`** — runs regular PHP after a DQ block, identified by a `$parameter` string naming
  which card's logic to use. Largely superseded by `Await(..., final:true)` routing to a card's
  `SpecificLogic()`.
- **`PASSPARAMETER`** — passes `$parameter` through unchanged as `$lastResult` for the next DQ.
- **`BUTTONINPUT`** — presents a comma-separated list of button choices to the player (e.g.
  `"Draw_a_Card,Buff_Power,Go_Again"` in the `card-recipe.md` §2 skeleton); paired with `SHOWMODES`
  for the UI prompt in modal-card patterns.

All commands here are cited in `` `third_party/talishar/New Developer Guide.md` `` and confirmed by
real usage in `` `third_party/talishar/CardLogic.php` ``.

## Await

`` `third_party/talishar/DecisionQueue/AwaitEffects.php` `` wraps DQs to avoid manual `$lastResult`
tracking, using a global associative array `$dqVars` for named variables instead.

Signature (line 16): `Await($player, $function, $returnName="LASTRESULT",
$lastResultName="LASTRESULT", $subsequent=1, $final=false, $prepend=false, ...$args)`.

- `$player` — who may need to decide / is affected.
- `$function` — a string naming a function in `AwaitEffects.php` (by convention suffixed `Await`,
  omitted in the call — e.g. `"DeckTopCards"` calls `DeckTopCardsAwait`). If `$function` matches a
  `cardID` instead, it routes to that card object's `SpecificLogic()` — replacing the old
  `SPECIFICCARD` DQ pattern.
- `$returnName` — the name to store the function's return under in `$dqVars`, so the next Await can
  find it.
- `$lastResultName` — backwards-compat: renames a preceding regular DQ's `$lastResult` so an Await
  can pick it up.
- `$subsequent` — same semantics as DQ's `$subsequent`, defaults true here (Await's default flips
  the DQ default).
- `$final` — set `true` on the last Await in a sequence; clears `$dqVars` so future Awaits don't
  read stale state.
- `$prepend` — insert at the front of the queue rather than the back.
- `...$args` — keyword args passed to the Await function, replacing DQ's `$parameter`.

## Await function catalog

Representative functions defined in `` `third_party/talishar/DecisionQueue/AwaitEffects.php` ``
(names as called, i.e. without the `Await` suffix): `DeckTopCards`, `RevealCards`,
`MultiChooseDeck`, `SetLastResult`, `MultiRemoveDeck`, `MultiAddHand`, `ShuffleDeck`,
`MultiTargetIndices`, `MultiChooseIndices`, `MultiZoneIndices`, `ChooseMultiZone`, `MZRemove`,
`MZBanish`, `SetLayerTarget`, `DealDamage`, `PayResourcesEffect`, `PayResources`, `PlayAura`,
`CardChoices`, `ResolveGoesWhere`, `MZDestroy`, `Sharpen`, `Else`, `AddCurrentTurnEffect`,
`ChooseText`, `Increment`, `SetModes`, `AddTopDeck`, `ResolveGoAgain`, `AfterResolveEffects`,
`ShowCard`, `AddTrigger`, `MZTap`, `AQTargeting`, `AddAttackQueue`, `CheckAttackQueue`. Each has a
DQ-era equivalent verb above where one exists (e.g. `MultiZoneIndices` ↔ `MULTIZONEINDICES`,
`MZRemove` ↔ `MZREMOVE`).

## Representative Await chain

From `` `third_party/talishar/New Developer Guide.md` `` (a card revealing/searching/adding cards
to hand from the deck):

```php
Await($this->controller, "DeckTopCards", "cardIDs", number:$numRevealed, subsequent:false);
Await($this->controller, "RevealCards");
Await($this->controller, $this->cardID, mode:"choose_cards");
Await($this->controller, "MultiChooseDeck", "indices");
Await($this->controller, "MultiRemoveDeck", "cardIDs");
Await($this->controller, "MultiAddHand");
Await($this->controller, $this->cardID, mode:"deal_arcane", target:$target);
Await($this->controller, "ShuffleDeck", final:true);
```

## Modal choose-1 pattern

For "choose 1 of N" modal effects: a `BUTTONINPUT` DQ (`SHOWMODES` for the UI prompt) combined with
`Await(..., final:true)` and a `TRIGGER` layer, so the chosen effect resolves through
`ProcessTrigger()` rather than directly inside `SpecificLogic()` — keeping resolution correctly
ordered on the layer stack (`` `third_party/talishar/CLAUDE.md` ``, "Modal Choose-1 Pattern";
confirmed against the real merged PR `Talishar/Talishar#1370`). Full worked skeleton in
`card-recipe.md` §2/§6.

## Layer stack interaction

DQ/Await sequences frequently push a `TRIGGER` layer (`AddLayer("TRIGGER", $player, $cardID,
additionalCosts:...)`) rather than resolving inline — see `architecture.md`'s "Layer stack &
CombatChain resolution" section for how `` `third_party/talishar/Classes/Stack.php `` and
`` `third_party/talishar/CombatChain.php` `` consume these pushed layers.
