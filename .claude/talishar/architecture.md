# Talishar Architecture (Quick Reference)

Last verified against upstream: 2026-07-18

Condensed engine pipeline + state model working reference. For the full long-form narrative
(API surface, card-image pipeline, upstream Known Stale Upstream Docs section), see
`docs/TALISHAR-ARCHITECTURE.md`. For DQ/Await operational depth see `decision-queue.md`; for the
card implementation recipe see `card-recipe.md`.

## Request pipeline

Every player action is an HTTP request through a fixed pipeline: `ProcessInput.php` /
`ProcessInputAPI.php` (validates `gameName`/`playerID`/`authKey`/`mode` GET params, routes input) →
`ParseGamestate.php` (loads state from `./Games/{gameName}/GameFile.txt`) → `GameLogic.php` /
`CardLogic.php` / per-type ability files (executes rules) → `WriteGamestate.php` (persists state) →
`GetNextTurn.php` → `BuildGameState.php` (serializes the JSON response) —
`` `third_party/talishar/CLAUDE.md` `` ("Architecture"), confirmed at
`` `third_party/talishar/ProcessInput.php` `` (lines 1–46) and
`` `third_party/talishar/BuildGameState.php` `` (line 7, `BuildGameStateResponse`).

Two delivery mechanisms exist:

- `` `third_party/talishar/GetNextTurn.php` `` — polling fallback, kept for backwards compatibility.
- `` `third_party/talishar/GetUpdateSSE.php` `` — the live path (see `frontend.md`): a `while
  (true)` loop polling the gamestate cache every 50–150ms, pushing a `data:` SSE frame only when
  the cache's update counter advances.

## GameFile state format & lifecycle

State is file-based, not database-driven (`` `third_party/talishar/CLAUDE.md` ``, "Project
Overview"). Each game gets `./Games/{gameName}/GameFile.txt`/`gamestate.txt` — a flat, positional,
`\r\n`-delimited text file, one gamestate "slot" per line, array-valued slots space-joined via
`implode(" ", ...)`. `` `third_party/talishar/WriteGamestate.php` `` writes this (90+ explicit
lines); `` `third_party/talishar/ParseGamestate.php` ``'s `ParseGamestate()` (line 27) is the
inverse, asserting `count($gamestateContent) < 60` as a corruption guard.

Reads/writes are cache-fronted: `WriteGamestate.php` calls `WriteGamestateCache()` after the file
write, `ParseGamestate.php` reads via `ReadGamestateCache()` on the hot path — backed by APCu
(`` `third_party/talishar/Libraries/CacheLibraries.php` `` lines 3–51), falling back to plain file
I/O when the `apcu` extension isn't loaded. The write path takes `flock($handler, LOCK_EX)` and
logs (not throws) on lock failure — a lock contention degrades to a dropped write, not a crash.

Game creation seeds the file: `` `third_party/talishar/MenuFiles/StartHelper.php` ``'s
`initializePlayerState()` writes the starting per-player lines (including the initial all-zero
ClassState line — see below and `card-recipe.md` §4) one `fwrite()` per slot.

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
engine file after `CardLogic.php`/`CardDictionary.php`) computes effective attack power via
`LinkBasePower()` (~line 2038): starts from the card's base `PowerValue()`, walks
`$currentTurnEffects` and every prior `ChainLinks` entry
(`` `third_party/talishar/Classes/ChainLinks.php` ``) applying layer continuous buffs/debuffs. A
card opts in via `Card` class hooks `CombatEffectActive`/`EffectPowerModifier`
(`` `third_party/talishar/Classes/Card.php` `` lines 106–113) — see `card-recipe.md` §3 for full
signatures.

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
