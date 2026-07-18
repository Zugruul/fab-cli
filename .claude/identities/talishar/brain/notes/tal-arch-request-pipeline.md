---
tags: [talishar, architecture, request-pipeline]
paths: []
strength: 1
source: "third_party/talishar/CLAUDE.md; third_party/talishar/ProcessInput.php; third_party/talishar/WriteGamestate.php; third_party/talishar/BuildGameState.php; third_party/talishar/GetUpdateSSE.php"
graduated: false
created: 2026-07-18
---

Every player action reaches the PHP backend as an HTTP request and flows through a fixed six-stage
pipeline before a response is serialized back: `ProcessInput.php`/`ProcessInputAPI.php` (validates
`gameName`/`playerID`/`authKey`/`mode` as GET params, routes the call) → `ParseGamestate.php`
(hydrates state from `./Games/{gameName}/GameFile.txt`, see [[tal-arch-gamefile-lifecycle]]) →
`GameLogic.php`/`CardLogic.php`/per-type ability files (apply the rules) → `WriteGamestate.php`
(persists) → `GetNextTurn.php` → `BuildGameState.php` (`BuildGameStateResponse($gameName, $playerID,
$authKey, ...)`, line 7 — serializes the outbound JSON). `third_party/talishar/CLAUDE.md`'s own
"Architecture" section documents this; `ProcessInput.php` lines 1–46 confirm the four validated GET
params.

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
