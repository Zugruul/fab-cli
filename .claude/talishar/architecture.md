# Talishar Architecture (Quick Reference)

Last verified against upstream: 2026-07-18

Condensed engine pipeline + state model working reference. For the full long-form narrative
(API surface, card-image pipeline, upstream Known Stale Upstream Docs section), see
`docs/TALISHAR-ARCHITECTURE.md`. For DQ/Await operational depth see `decision-queue.md`; for the
card implementation recipe see `card-recipe.md`.

## Request pipeline

Six stages carry a player action from HTTP request to serialized response: `ProcessInput.php` /
`ProcessInputAPI.php` validate the `gameName`/`playerID`/`authKey`/`mode` GET params and route the
call; `ParseGamestate.php` hydrates state from `./Games/{gameName}/GameFile.txt`; `GameLogic.php` /
`CardLogic.php` / the per-type ability files apply the rules; `WriteGamestate.php` persists the
result; `GetNextTurn.php` and finally `BuildGameState.php` (`BuildGameStateResponse`, line 7) turn
that into the outbound JSON — `` `third_party/talishar/CLAUDE.md` `` ("Architecture"), cross-checked
against `` `third_party/talishar/ProcessInput.php` `` lines 1–46.

State reaches the client through one of two mechanisms:

- `` `third_party/talishar/GetNextTurn.php` `` — a polling endpoint kept around for backwards
  compatibility.
- `` `third_party/talishar/GetUpdateSSE.php` `` — the path actually used in production (see
  `frontend.md`): a `while (true)` loop that re-checks the gamestate cache every 50–150ms and emits
  a `data:` SSE frame only once the cache's update counter has moved.

## GameFile state format & lifecycle

There's no database behind a running game (`` `third_party/talishar/CLAUDE.md` ``, "Project
Overview") — state lives in `./Games/{gameName}/GameFile.txt`/`gamestate.txt`, a plain-text file
where each line is a fixed positional "slot" (`\r\n`-separated) and multi-value slots are joined
with `implode(" ", ...)`. The write side, `` `third_party/talishar/WriteGamestate.php` ``, spells
out over 90 of these lines explicitly; the read side,
`` `third_party/talishar/ParseGamestate.php` ``'s `ParseGamestate()` (line 27), unpacks them back
and treats `count($gamestateContent) >= 60` as evidence of file corruption.

Neither side hits disk directly on the hot path: `WriteGamestate.php` also calls
`WriteGamestateCache()`, and `ParseGamestate.php` prefers `ReadGamestateCache()` — both backed by
APCu (`` `third_party/talishar/Libraries/CacheLibraries.php` `` lines 3–51), with a plain-file
fallback when the `apcu` extension is absent. Writing itself is guarded by
`flock($handler, LOCK_EX)`; if the lock can't be acquired the write is silently skipped and only
logged, so contention costs you a missed update rather than a crashed request.

A new game's starting state comes from
`` `third_party/talishar/MenuFiles/StartHelper.php` ``'s `initializePlayerState()`, which
`fwrite()`s one line per slot for each player — including the all-zero starting ClassState line
(see below and `card-recipe.md` §4).

## DecisionQueue & Await (overview — see decision-queue.md for the full verb list)

A large share of engine logic is driven by the **Decision Queue** (DQ): queues operations to run as
soon as they can, pending user input. Primitives live in
`` `third_party/talishar/CardLogic.php` ``: `AddDecisionQueue(...)` (line 286), `AddLayer(...)`
(line 269), `ProcessDecisionQueue()` (line 333). DQs are **asynchronous** — a block of DQ calls
followed by regular PHP runs the regular code *first*; code that must run after a DQ needs to be
inside another DQ command (historically `SPECIFICCARD`).

**`Await`** (`` `third_party/talishar/DecisionQueue/AwaitEffects.php` ``) wraps DQs using a global
`$dqVars` associative array instead of manually tracking `$lastResult`. Signature: `Await($player,
$function, $returnName="LASTRESULT", $lastResultName="LASTRESULT", $subsequent=1, $final=false,
$prepend=false, ...$args)`.

## Layer stack & CombatChain resolution

The **layer stack** (`` `third_party/talishar/Classes/Stack.php` ``) is the shared structure
everything resolving — abilities, triggers, attacks — passes through, wrapping the flat `$layers`
array. Phase markers include `LAYER`, `PRELAYERS`, `TRIGGER`, `PRETRIGGER`, `ABILITY`, `MELD`,
`RESUMETURN`, `ATTACKSTEP`, `RESOLUTIONSTEP` —
`` `third_party/talishar/CombatChain.php` `` lines 2007–2035 define `IsLayerStep()`,
`IsAttackStep()`, `IsResolutionStep()`, `AfterDamage()` by searching this stack for those markers.

**CombatChain resolution** (`` `third_party/talishar/CombatChain.php` ``, the largest non-generated
engine file after `CardLogic.php`/`CardDictionary.php`) is where power actually gets computed:
`LinkBasePower()` (~line 2038) takes the card's base `PowerValue()` as a starting point, then folds
in every applicable modifier — the current turn's `$currentTurnEffects` plus each earlier chain
link recorded in `ChainLinks` (`` `third_party/talishar/Classes/ChainLinks.php` ``). A card taps
into that resolution loop by implementing `CombatEffectActive`/`EffectPowerModifier` on its `Card`
subclass (`` `third_party/talishar/Classes/Card.php` `` lines 106–113) — see `card-recipe.md` §3
for the full hook signatures.

## ClassState mechanism (3-file dance)

Per-turn counters (e.g. "auras destroyed this turn") checked by simple thresholds. Full recipe with
line numbers lives in `card-recipe.md` §4 — summary: `` `third_party/talishar/Constants.php` ``
(declare + reset), `` `third_party/talishar/MenuFiles/StartHelper.php` `` (seed starting zero),
and the trigger call site (`IncrementClassState(...)`). Confirmed against
`Talishar/Talishar#1370` ("Add `$CS_NumLightningFlowDestroyed` ClassState variable").

## Curated reference set

This file is one of six under `.claude/talishar/`: `architecture.md` (this file), `card-recipe.md`
(full implementation recipe — read this to actually implement a card), `decision-queue.md` (DQ/Await
verb reference), `frontend.md` (SSE/reconnect), `dev-stack.md` (local dev), `contributing.md` (fork
contract, PR conventions). See `docs/TALISHAR-ARCHITECTURE.md` for the long-form narrative these
condense.
