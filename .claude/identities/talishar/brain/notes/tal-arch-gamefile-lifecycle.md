---
tags: [talishar, architecture, gamefile, state]
paths: []
strength: 1
source: "third_party/talishar/WriteGamestate.php; third_party/talishar/ParseGamestate.php; third_party/talishar/Libraries/SHMOPLibraries.php; third_party/talishar/Libraries/CacheLibraries.php; third_party/talishar/MenuFiles/StartHelper.php"
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

Neither read nor write hits disk directly on the hot path — both are cache-fronted, but **not by
APCu**: the real hot-path cache is a `shmop` (System V shared memory) seqlock in
`third_party/talishar/Libraries/SHMOPLibraries.php`. `WriteGamestate.php` line 132 calls
`WriteGamestateCache($gameName, $gamestateContent)` after the file write (defined
`SHMOPLibraries.php` line 54: opens a dynamically-sized shmop segment keyed by
`GamestateID($name)` = `$name + 1000000`, writes a 16-byte odd/even sequence-number header before
and after the payload as a seqlock); `ParseGamestate.php` (lines 48, 567, 609) calls
`ReadGamestateCache($gameName)` (`SHMOPLibraries.php` line 87: retries up to 10 times with a 1ms
sleep if it catches an odd/torn sequence number, falling back to a raw-serialized read for
segments written before the seqlock header existed). `Libraries/CacheLibraries.php`'s APCu-backed
`GetCachedGamestate()`/`InvalidateGamestateCache()` (its own header comment even claims "30-40%
latency reduction on GetNextTurn") have **zero call sites anywhere in the codebase** outside their
own definitions (verified: `grep -rn "GetCachedGamestate\b" third_party/talishar` matches only the
definition file) — this is dead/aspirational code, not the actual gamestate cache path. APCu *is*
genuinely used in `CacheLibraries.php`, but for an unrelated, narrower purpose:
`UpdateSpectatorPresence()`/`GetActiveSpectators()` track which spectator usernames have polled
recently (60s/120s TTLs) — nothing to do with gamestate reads/writes. Grepping the whole tree for
`Redis`/`redis` in PHP files (`grep -rl "Redis\|redis" --include="*.php" third_party/talishar`)
turns up zero matches — despite `docker-compose.yml` exposing a Redis service on port 6382, no PHP
file actually references it; treat that service as currently unused by the gamestate path rather
than assuming Redis backs any part of this.

So the real model is three layers, not two: (a) `./Games/{gameName}/GameFile.txt` as ground truth
on disk, (b) the shmop seqlock segment in `SHMOPLibraries.php` as the actual hot-path
read/write-through cache `ParseGamestate()`/`WriteGamestate()` use, and (c) APCu as a separate,
narrow spectator-presence cache that never touches gamestate content. This is a **different**
shmop structure from the fixed 128-byte per-game metadata row also in `SHMOPLibraries.php` — see
[[tal-arch-shmop-cache-row]] for that one (same keying-by-game-name pattern, unrelated purpose and
size). Writes take an exclusive lock (`flock($handler, LOCK_EX)`) and **log rather than throw** on
lock failure — "action not persisted" — so contention degrades to a dropped write, not a crash.

Game creation seeds the initial file: `third_party/talishar/MenuFiles/StartHelper.php`'s
`initializePlayerState()` `fwrite()`s the starting per-player lines, one call per slot, including
the all-zero starting ClassState line — matching the exact positional format
`WriteGamestate.php`/`ParseGamestate.php` use during play (this is why [[tal-recipe-classstate-counter]]
requires editing `StartHelper.php` in lockstep with `Constants.php`).

See [[tal-arch-request-pipeline]] for where this fits in the request lifecycle.
