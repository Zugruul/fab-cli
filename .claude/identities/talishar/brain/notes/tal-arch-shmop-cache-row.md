---
tags: [talishar, engine, cache, capacity]
paths: ["third_party/talishar/Libraries/SHMOPLibraries.php", "third_party/talishar/**"]
strength: 1
source: "TAL-032 (#116)"
graduated: false
created: 2026-07-19
---

The shared gamestate cache row (`third_party/talishar/Libraries/SHMOPLibraries.php`'s
`WriteCache`/`ReadCache`, keyed per game name) is a FIXED 128-byte shmop segment holding ~18-20
`!`-joined pieces
(revision counter, connection timestamps, hero `SetID()` codes, format, chat flags, game
status, kicked-player info at piece 18, and now commandId dedup hashes at pieces 19/20).
A realistic populated row already sits around 100-120 of the 128 bytes. Before adding ANY
new piece to this row, compute its actual byte cost (prefer a short fixed-length encoding —
e.g. a hash — over a raw long string like a UUID) and verify against the current total;
`WriteCache` now has a bounds check (added in TAL-032's fix) that refuses an oversized
write rather than silently corrupting the row, but that's a safety net, not license to
skip the budget check — an oversized write still means your new field never gets
persisted. See third_party/talishar's `a42810fdf` for the reference fix pattern.

Note: this cache row is a DIFFERENT structure from the gamestate-content shmop segment
(see [[tal-arch-gamefile-lifecycle]]) — same keying-by-game-name pattern, but this one
holds small per-game metadata pieces, not the serialized gamestate itself.
