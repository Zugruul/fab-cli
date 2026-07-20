---
tags: [talishar, engine, cache, capacity]
paths: ["third_party/talishar/Libraries/SHMOPLibraries.php", "third_party/talishar/**"]
strength: 1
source: "TAL-032 (#116); third_party/talishar/Libraries/SHMOPLibraries.php; third_party/talishar/APIs/JoinGame.php; third_party/talishar/APIs/KickPlayer.php; third_party/talishar/APIs/GetLobbyRefresh.php; third_party/talishar/Libraries/NetworkingLibraries.php; third_party/talishar/GetUpdateSSE.php; third_party/talishar/ProcessInput.php"
graduated: false
created: 2026-07-19
---

The shared gamestate cache row (`third_party/talishar/Libraries/SHMOPLibraries.php`'s
`WriteCache`/`ReadCache`, keyed per game name) is a FIXED 128-byte shmop segment holding
`!`-joined pieces. The file's own header comment (lines 3–20) documents pieces 1–17: update
counter, P1/P2 last-connection timestamps, P1/P2 status, last-gamestate-update time, P1/P2 hero
`SetID()` codes, game visibility, is-replay flag, P2-disconnect count, an unused piece 12 slot,
format code, game status, P1/P2 chat-enabled flags, and piece 17 "currentPlayer Inactive". Beyond
that documented range, real call sites (`grep -rn "SetCachePiece(\|GetCachePiece(\|SetCachePieces("
third_party/talishar` across every `.php` file, excluding the definition file) confirm piece 18 =
`$kickedUsername` (read at `APIs/JoinGame.php:230`) and, on this session's local
`fix/183_double_activation` branch only (not yet on upstream `main`), pieces 19/20 = per-player
commandId dedup hashes added by TAL-032's fix (`ProcessInput.php:193-211`). A realistic populated
row already sits around 100-120 of the 128 bytes. Before adding ANY new piece to this row,
compute its actual byte cost (prefer a short fixed-length encoding — e.g. a hash — over a raw
long string like a UUID) and verify against the current total; `WriteCache` now has a bounds
check (added in TAL-032's fix, `SHMOPLibraries.php:23-46`) that refuses an oversized write rather
than silently corrupting the row, but that's a safety net, not license to skip the budget check —
an oversized write still means your new field never gets persisted. See third_party/talishar's
`a42810fdf` for the reference fix pattern.

**Pieces 17 and 18 are triple-purposed — a real, confirmed overlap in the live code, not just an
undocumented alias.** Beyond the header's "currentPlayer Inactive" meaning for piece 17 (which
does have a genuine live/dead-connection user: `GetUpdateSSE.php:218-219` sets it to `1`/`0` based
on an `$inactive` flag), the same two pieces are independently overloaded for kick handling and
undo-decline counting:
- **Kick handling**: `APIs/KickPlayer.php`'s `SetCachePieces()` call sets piece 17 to the string
  `"kicked"` and piece 18 to the kicked player's username; `APIs/GetLobbyRefresh.php:122,174`
  reads/clears piece 17 as `$kickSignal` (string, not boolean); `APIs/JoinGame.php:230` reads
  piece 18 as `$kickedUsername` to block an immediate rejoin.
- **Undo-decline counters**: `Libraries/NetworkingLibraries.php:1161-1163` (mode 100017, "Decline
  Undo") uses piece 17 as player 1's decline counter and piece 18 as player 2's, incrementing
  whichever piece matches the declining `$playerID`; `Libraries/NetworkingLibraries.php:2125`
  resets both to `0` at the start of every turn with the comment "Reset both players' undo
  decline counters" — which would clobber any in-flight `"kicked"`/username value sitting in
  those same pieces, and vice versa.

Not independently verified whether these three uses actually collide at runtime (they may be
protected by being mutually exclusive game states in practice), but a future dev adding new
budget-sensitive logic to this row should NOT treat pieces 17/18 as available or single-purpose —
verify against all four call-site groups above before touching either piece.

Note: this cache row is a DIFFERENT structure from the gamestate-content shmop segment
(see [[tal-arch-gamefile-lifecycle]]) — same keying-by-game-name pattern (`GamestateID($name)` =
`$name + 1000000` for the gamestate segment vs. the raw `$name` for this metadata row), but this
one holds small per-game metadata pieces, not the serialized gamestate itself. See also
[[tal-arch-request-pipeline]] for how pieces 1 (revision) and 19/20 (commandId hashes) are used by
the local branch's concurrency guard.
