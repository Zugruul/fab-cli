---
tags: [talishar, architecture, gamefile, state]
paths: []
strength: 1
source: "third_party/talishar/WriteGamestate.php; third_party/talishar/ParseGamestate.php; third_party/talishar/Libraries/CacheLibraries.php; third_party/talishar/MenuFiles/StartHelper.php"
graduated: false
created: 2026-07-18
---

Talishar's game state is **file-based, not database-driven** (per `third_party/talishar/CLAUDE.md`'s
"Project Overview"). Each running game gets `./Games/{gameName}/GameFile.txt`/`gamestate.txt`: a
flat, positional, `\r\n`-delimited text file where each line is one gamestate "slot" (per-player
health/hand/deck/arsenal/pitch/banish/ClassState arrays, the combat chain, decision queue, layers,
etc.), with array-valued slots space-joined via `implode(" ", ...)`.

- **Write**: `third_party/talishar/WriteGamestate.php` builds this line-by-line — over 90 explicit
  lines covering both players' zones, `$combatChain`, `$decisionQueue`, `$dqVars`, `$layers`, plus
  per-chain-link data appended dynamically by count, and JSON-encoded sub-blobs for fields too
  structured for flat encoding (e.g. `$p1CardTurnLog`, `$p1LifeHistory`).
- **Read**: `third_party/talishar/ParseGamestate.php`'s `ParseGamestate()` (line 27) does the
  inverse — `explode("\r\n", ...)`s the content and asserts `count($gamestateContent) < 60` as a
  corruption guard before unpacking each line back into the same globals.

Because this format is strictly **positional**, adding a new flat-encoded slot (e.g. a new
ClassState counter — see [[tal-arch-classstate]]/[[tal-recipe-classstate-counter]]) requires keeping
every writer and reader in lockstep on slot count/order, not just adding a field somewhere.

Neither read nor write hits disk directly on the hot path — both are cache-fronted via APCu
(`third_party/talishar/Libraries/CacheLibraries.php` lines 3–51: `apcu_fetch`/`apcu_store`, with a
plain-file fallback when the `apcu` extension isn't loaded). `WriteGamestate.php` calls
`WriteGamestateCache()` after the file write; `ParseGamestate.php` prefers
`ReadGamestateCache()` over the raw file. Writes take an exclusive lock
(`flock($handler, LOCK_EX)`) and **log rather than throw** on lock failure — "action not
persisted" — so contention degrades to a dropped write, not a crash.

Game creation seeds the initial file: `third_party/talishar/MenuFiles/StartHelper.php`'s
`initializePlayerState()` `fwrite()`s the starting per-player lines, one call per slot, including
the all-zero starting ClassState line — matching the exact positional format
`WriteGamestate.php`/`ParseGamestate.php` use during play (this is why [[tal-recipe-classstate-counter]]
requires editing `StartHelper.php` in lockstep with `Constants.php`).

See [[tal-arch-request-pipeline]] for where this fits in the request lifecycle.
