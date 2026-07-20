---
tags: [talishar, architecture, request-pipeline]
paths: []
strength: 1
source: "third_party/talishar/CLAUDE.md; third_party/talishar/ProcessInput.php; third_party/talishar/Libraries/NetworkingLibraries.php; third_party/talishar/WriteGamestate.php; third_party/talishar/BuildGameState.php; third_party/talishar/GetUpdateSSE.php; third_party/talishar/CoreLogic.php; third_party/talishar/CardLogic.php"
graduated: false
created: 2026-07-18
---

Every player action reaches the PHP backend as an HTTP request and flows through a fixed six-stage
pipeline before a response is serialized back: `ProcessInput.php`/`ProcessInputAPI.php` (validates
`gameName`/`playerID`/`authKey`/`mode` as GET params, `include`s `GameLogic.php` and
`Libraries/NetworkingLibraries.php` among others, then calls the actual dispatcher) →
`ParseGamestate.php` (hydrates state from `./Games/{gameName}/GameFile.txt`, see
[[tal-arch-gamefile-lifecycle]]) → the `ProcessInput($playerID, $mode, ...)` function itself — a
large `switch ($mode)` — which is defined in `third_party/talishar/Libraries/NetworkingLibraries.php`
(line 25), **not** `GameLogic.php` (`GameLogic.php` has no same-named dispatcher; verified via
`grep -n "^function ProcessInput" Libraries/NetworkingLibraries.php GameLogic.php`, which only
matches the former) — dispatching into `CardLogic.php`/`CoreLogic.php`/per-type ability files to
apply the rules (`CardLogic.php` line 4 `include`s `CoreLogic.php`, whose ~181 functions —
`EvaluateCombatChain`, combat-chain power/defense modifiers, start-turn/arsenal ability helpers,
etc. — back `CardLogic.php`'s higher-level rules logic) → `WriteGamestate.php` (persists) →
`GetNextTurn.php` → `BuildGameState.php` (`BuildGameStateResponse($gameName, $playerID,
$authKey, ...)`, line 7 — serializes the outbound JSON). `third_party/talishar/CLAUDE.md`'s own
"Architecture" section documents the overall shape; `ProcessInput.php` lines 1–46 confirm the four
validated GET params.

**Concurrency guard (as of the local `fix/183_double_activation` branch, not yet on upstream
`main`)**: `ProcessInput.php` (around lines 163–212, added by TAL-032's fix for #183) reads
`expectedRevision`/`commandId` from the request when present, compares `expectedRevision` against
the shmop cache row's revision counter (piece 1 — see [[tal-arch-shmop-cache-row]]) via
`ReadCacheArray($gameName)`, and `exit`s with "Stale request" if they've diverged; if the request
also carries a `commandId`, it hashes it (`hash('crc32b', ...)`) and stores it in cache piece 19
(player 1) / 20 (player 2), rejecting an exact repeat as "Duplicate request already processed."
Requests without `expectedRevision` (replays, older callers) skip the check entirely. Per the
code's own comment, this is explicitly a secondary, defense-in-depth layer — the FE's synchronous
`isPlayerInputInProgress` gate is the primary defense against rapid double-clicks, and this check
does not by itself close a true multi-tab race (the revision counter only advances at the end of
`GamestateUpdated()`, so two requests admitted before either finishes can still both observe the
same revision). See [[tal-arch-shmop-cache-row]] for the piece 19/20 cache-row detail.

Two delivery mechanisms exist for getting state back to the client:

- `third_party/talishar/GetNextTurn.php` — a thin polling endpoint, kept for backwards compatibility
  and fallback (its own header comment says so explicitly).
- `third_party/talishar/GetUpdateSSE.php` — the live production path (see
  [[tal-arch-fe-state-flow]]): a `while (true)` loop polling the gamestate cache every 50–150ms
  (adaptive `$sleepMs`) that only pushes a `data:` SSE frame once the cache's update counter has
  advanced.

`WriteGamestate.php` never throws on a lock failure — it logs "action not persisted" and drops the
write, so contention degrades to a missed update rather than a crashed request (see
[[tal-arch-gamefile-lifecycle]] for the locking detail).

See [[tal-arch-decision-queue-await]] for how `GameLogic.php`/`CardLogic.php` actually sequences
rules execution within one request, and [[tal-arch-api-surface]] for the other REST endpoints
(`APIs/`) outside this core in-game loop.
