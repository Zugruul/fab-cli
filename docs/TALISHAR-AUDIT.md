# Talishar Latency/Performance Audit

A performance-lens audit of the vendored [Talishar](https://talishar.net/) engine/FE, covering the
5 areas required by `docs/design/talishar-E3.md`'s TAL-030 section (SSE update path, gamestate
caching, Apache/SSE tuning, FE parse/render cost, GameFile I/O cycle). This is a companion to
`docs/TALISHAR-ARCHITECTURE.md`, which already documents the mechanism of most of these areas —
this doc adds a performance lens on top rather than re-describing that mechanism (cited, not
repeated, where the architecture doc already covers a piece of ground).

**Citation rule**, same as the architecture doc: every claim cites a vendored file path in
backticks. **Method note**: bringing up the local docker stack for real measurement was optional
per §9.5 of the design doc; this audit is built from direct static reading of the vendored source
(field counts, loop shapes, call-site greps) rather than live timing/payload capture — every
number below that isn't a literal count from the source is explicitly labeled an **estimate**
with its assumptions stated. No number is presented as measured when it wasn't.

Findings are ranked with a simple **Effort × Impact** grid — `Low`/`Medium`/`High` on each axis.
Higher impact + lower effort ranks first.

## Ranked findings (all areas)

| # | Area | Finding | Effort | Impact |
|---|------|---------|--------|--------|
| 1 | Gamestate caching | Dead APCu gamestate-cache layer still paying invalidation cost | Low | Low-Medium |
| 2 | GameFile I/O cycle | Synchronous multi-rename undo-backup rotation in the request path | Low-Medium | Medium |
| 3 | SSE update path | Full non-incremental state rebuild with per-card rule evaluation on every push | High | Medium |
| 4 | Apache/SSE tuning | Prefork-MPM ties concurrent SSE connections 1:1 to OS worker processes | High | Medium |
| 5 | Gamestate caching | Small "cache" shmop segment lacks the seqlock the gamestate segment has | Medium | Low |
| 6 | FE parse/render cost | No issue found — O(n) parse, deliberate full-tree identity-preserving merge | — | — |

## SSE update path

**Evidence**: `third_party/talishar/BuildGameState.php` is a single 1606-line file dominated by
one function, `BuildGameStateResponse()` (line 7–~1475), which both `GetUpdateSSE.php` and
`GetNextTurn.php` call to serialize the outbound JSON. A grep count
(`grep -c "foreach\s*(\|for\s*("`) finds 94 top-level `$response->` field assignments and 50
`for`/`foreach` loops — the per-zone-per-player loops (hand, deck, banish, discard, soul, pitch,
arsenal, character, combat chain — e.g. the hand loop at `third_party/talishar/BuildGameState.php`
lines 626–645, the banish loops at lines 415–421/498, the combat-chain loop at line 299) plus a
number of smaller inner loops (e.g. the per-subtype scan at line 545/781 nested inside a zone
loop) and the Metafy/Patreon community loops near the top of the file (lines 155–245). Within the
hand loop specifically (lines 626–645), each card triggers calls to `IsPlayable()`,
`CardBorderColor()`, `GetAbilityTypes()`, and `InstantRestricted()` — real rule-engine functions,
not simple field copies. `third_party/talishar/CardDictionary.php`'s `IsPlayable()` (line 1664)
alone reads 15 globals (three `global` declarations at lines 1666–1668, 6+6+3 variables) and
calls `GetArsenal`/`GetAllies`/`GetAuras`/`GetPlayerCharacter`/`GetHand`/`CardType`/
`CardSubType`/`GetAbilityType(s)`/`GetAbilityNames`, plus conditionally constructs a `Banish` or
`CharacterCard` object, per card in hand.

`GetUpdateSSE.php`'s `while (true)` loop (`third_party/talishar/GetUpdateSSE.php` lines 151–270)
polls a small, cheap cache array (`ReadCacheArray()`, ~17 scalar fields) every 50–150ms
(`$sleepMs`, adaptive) and only calls `BuildGameStateResponse()` — the expensive path — when the
cache's update counter (`$cacheArr[0]`) has actually advanced (line 193). So the expensive rebuild
is event-driven (once per real gamestate change), not paid on every poll tick; the poll loop
itself is cheap. There is no field-level diffing on the backend, though — every push resends the
**entire** game state (all zones for both players, the full combat chain, layers, etc.), and every
push re-derives per-card playability/border/restriction fields from scratch even for cards whose
state didn't change since the last push. Diffing only happens client-side, in
`preserveIdentities()` (see "FE parse/render cost" below).

**Impact (estimate, not measured)**: the rebuild cost scales roughly linearly with total cards
across all zones for both players (hand + deck + banish + discard + pitch + soul + arsenal +
equipped items/allies/auras + combat chain), each card paying a handful of rule-lookup function
calls when it's in a decision-relevant zone (hand, primarily). A typical mid-game board (roughly
10-20 cards in hand+arsenal+play across both players, larger decks mostly inert) is a small,
bounded cost per push; a late-game board with a long combat chain, several allies/auras/permanents
in play, and large graveyards/banish piles pushes the loop count up proportionally. Because this
only fires on genuine state changes (not on every 50ms poll), the practical latency impact is
"each player action costs one full-board serialization," not "every 50ms costs a full
serialization" — the SSE loop's own adaptive-sleep design already avoids the worse version of this
problem.

**Fix sketch**: incremental/delta encoding (only serialize zones that changed since the client's
last acknowledged update counter) would be a substantial backend refactor — `BuildGameStateResponse`
would need to track per-zone dirty flags alongside the existing update counter, and the response
shape would need a partial-update variant the FE's `ParseGameState.ts`/`GameSlice.ts` could
merge — a much bigger change than this audit's scope, and would need care to preserve the
client's `preserveIdentities()` invariant instead of duplicating it server-side. A smaller,
lower-risk step: memoize `IsPlayable()`'s per-card result within a single
`BuildGameStateResponse()` call when the same `($cardID, $phase, $from, $index)` tuple is queried
more than once in the same request (grep shows call sites beyond the hand loop that may re-derive
the same fact) — reduces redundant work without touching the wire protocol.

**Rank**: Effort High, Impact Medium — real gain requires a wire-protocol change; not a quick win.

## Gamestate caching

**Evidence**: two independent caching mechanisms exist and only one is load-bearing.

1. **Load-bearing**: `third_party/talishar/Libraries/SHMOPLibraries.php`'s `WriteGamestateCache()`
   (line 38) / `ReadGamestateCache()` (line 71) use POSIX shared memory (`shmop_*`) keyed by
   `GamestateID($name) = $name + 1000000` (line 133), with a hand-rolled seqlock: a 16-byte odd/even
   sequence header written before and after the payload, and `ReadGamestateCache()` retries up to
   10 times with a 1ms sleep if it observes an odd (write-in-progress) or mismatched sequence
   number — correctly avoids torn reads under concurrent access. `WriteGamestate.php` calls
   `WriteGamestateCache()` after every file write; `ParseGamestate.php`'s `ParseGamestate()`
   (line 27) reads via `ReadGamestateCache()` first and only falls back to
   `file_get_contents()` on the raw `gamestate.txt` when the cache returns fewer than 60 lines
   (line 44) — i.e. cache-empty or corrupt, confirmed and already documented in
   [[tal-arch-gamefile-lifecycle]]/`docs/TALISHAR-ARCHITECTURE.md`'s "GameFile State Format &
   Lifecycle" section.
2. **Dead code paying live cost**: `third_party/talishar/Libraries/CacheLibraries.php` implements
   a second, APCu-backed gamestate cache — `GetCachedGamestate()` (line 38, doc comment claims
   "Expected impact: 30-40% latency reduction on GetNextTurn") and `InvalidateGamestateCache()`
   (line 61). A repo-wide grep for `GetCachedGamestate` finds **zero call sites** — nothing ever
   reads from this APCu cache. `InvalidateGamestateCache()`, however, **is** called: 3 times per
   player action in `third_party/talishar/ProcessInput.php` (lines 189, 226, 275 — one per
   early-exit branch: rematch, swap-rematch, and the normal end-of-request path) plus once in
   `third_party/talishar/APIs/SubmitSideboard.php` (line 289). Every one of those calls performs
   an `_apcuAvailable()` extension check plus an `apcu_delete()` call that deletes a key
   (`"gamestate_" . $gameName`) nothing ever populates via a read-miss (since `GetCachedGamestate`,
   the only writer, is never invoked) — pure overhead with zero cache-hit benefit, and the file's
   own doc comment is actively misleading about what's actually caching gamestate reads (it's
   `SHMOPLibraries.php`, not this file).

**Impact**: the dead APCu calls are cheap individually (an extension check + a delete against a
non-existent key), but they run on every single player action, unconditionally, and cost real
(if small) CPU/syscall time for zero benefit. The bigger cost is documentation drift: a future
contributor tuning gamestate caching would read `CacheLibraries.php`'s comment, believe APCu is
the hot-path cache, and waste time tuning or debugging a mechanism that isn't actually used.

**Fix sketch**: delete `GetCachedGamestate()`/`InvalidateGamestateCache()` and their 4 call sites,
or — if a defense-in-depth second cache layer is genuinely wanted — wire `GetCachedGamestate()`
into the actual read path (e.g. inside `ReadGamestateCache()` as an L1 in front of the shmop L2)
so the APCu layer is load-bearing rather than orphaned. Either way, update the misleading doc
comment.

**Rank**: Effort Low (delete or wire up 5 call sites), Impact Low-Medium (no user-visible latency
win, but removes dead-code confusion and a small per-request tax).

**Secondary finding — small "cache" segment has no seqlock**: the other shmop segment,
`ReadCache()`/`WriteCache()` (`third_party/talishar/Libraries/SHMOPLibraries.php` lines 22–36,
`ShmopReadCache()` lines 104–113), holds the small 128-byte "cache" array (update counter, player
statuses, last-update timestamp — the 17 pieces documented at the top of that file) that
`GetUpdateSSE.php`'s poll loop reads every 50–150ms via `ReadCacheArray()`. Unlike the gamestate
segment, `WriteCache()` does a plain `shmop_write()` with **no seqlock/sequence header** — and
`SetCachePiece()`/`SetCachePieces()`/`IncrementCachePiece()`/`GamestateUpdated()` (all in the same
file, lines 139–201) do read-modify-write cycles against it with no locking at all. A concurrent
SSE-loop read (`ShmopReadCache()`) during a `ProcessInput.php`-triggered write could in principle
observe a torn 128-byte value, unlike the gamestate segment which is explicitly protected against
this. Practical risk is low (128 bytes writes fast, and a torn read here just causes one extra
poll cycle before the next read succeeds, not data corruption) — a fast-follow rather than the
gamestate cache being unsafe.

**Fix sketch**: reuse the gamestate segment's seqlock pattern (odd/even header + bounded retry) in
`WriteCache()`/`ReadCache()` for consistency — small, mechanical change, low urgency given the
practical risk is capped.

**Rank**: Effort Medium (touches every `SetCachePiece*`/`ReadCache` call site's read protocol),
Impact Low (theoretical torn-read window, self-healing on next poll).

## Apache/SSE tuning

**Evidence**: `third_party/talishar/docker/apache-performance.conf` is a small, deliberately
SSE-aware config (its own comments explain the reasoning, confirmed by reading the file directly):
gzip (`mod_deflate`) is turned on for `application/json` (line 14) because Debian's default
`deflate.conf` doesn't compress JSON, so API responses (`GetNextTurn.php` and the REST `APIs/`)
were shipping uncompressed — but `text/event-stream` is deliberately **excluded** from
compression (comment at lines 11–12: "compressing SSE can buffer events and break real-time
delivery"), which is the correct call for a long-lived streaming response. Separately, prefork
MPM's `MaxRequestWorkers`/`ServerLimit` are raised from Debian's default of 150 to 250 (lines
25–27), with the file's own comment explaining why: `GetUpdateSSE.php` holds one Apache worker
per connected client for the entire game (every open `EventSource` occupies a worker the whole
time), so the worker cap is a hard ceiling on concurrent players+spectators — confirmed directly
against `GetUpdateSSE.php`'s architecture (a blocking `while (true)` loop per request, per
`third_party/talishar/GetUpdateSSE.php` lines 151–270). The comment also documents the RAM budget
this implies (20-40MB per child, ~5-10GB at full 250-worker saturation) and recycles children via
`MaxConnectionsPerChild 10000` to reclaim any per-process growth in these long-lived workers.

Both configured directives are correct, intentional, and already reflect SSE-specific tuning —
**no bug found in what's configured.**

**Finding — architectural ceiling, not a misconfiguration**: the deeper issue is the MPM choice
itself, not a tunable value. `mpm_prefork` fundamentally ties 1 concurrent SSE connection to 1 OS
process for that connection's entire lifetime (the same fact the file's own comment relies on to
justify raising the worker count). Raising `MaxRequestWorkers` further is a purely linear,
RAM-bound lever — doubling concurrent capacity requires roughly doubling RAM budget (the
20-40MB/worker figure the file already documents), unlike an event-driven or PHP-FPM-backed model
where idle SSE connections (most of the time, given the adaptive 50–150ms sleep is server-side
CPU, not the connection itself) wouldn't each pin a full process.

**Impact (estimate)**: for the scale of a self-hosted/community deployment this is fine (250
workers × ~30MB ≈ 7.5GB is a reasonable box); for a growth scenario (tournament-day traffic
spikes, streamer-driven spectator counts) this ceiling becomes a real capacity wall that can only
be pushed by adding RAM/hosts, not by better software efficiency.

**Fix sketch**: migrating `GetUpdateSSE.php`'s connection handling to `mpm_event` + PHP-FPM (or an
async runtime like ReactPHP/Swoole for just this endpoint) would decouple concurrent-connection
count from OS-process count, since most of an SSE connection's lifetime is spent idle-sleeping
between polls rather than doing CPU work. This is a significant infrastructure change (PHP-FPM
event loop compatibility, session handling already isn't using the shared session across the SSE
loop per `GetUpdateSSE.php`'s explicit `session_write_close()` before the loop at line 95) — not a
config tweak, and out of scope to attempt as part of this audit.

**Rank**: Effort High (infrastructure/runtime change, not a config edit), Impact Medium (real
ceiling on concurrent-player scaling, but not an active problem at documented-target scale).

## FE parse/render cost

**Evidence**: `third_party/talishar-fe/src/app/ParseGameState.ts` (613 lines) is a pure,
non-quadratic transform: `ParseCard()` (line 22) and `ParseEquipment()` (line 63) do straight-line
per-field coercions (`Number(...)`, `String(...)`, `Boolean(...)`) with no nested scans across the
card list, and a repo-wide grep of the file finds only 3 `.map`/`.filter`/`.forEach` call sites
total — no O(n²)-shaped loop was found. The file already carries evidence of prior perf tuning: a
comment at the top (`third_party/talishar-fe/src/app/ParseGameState.ts` lines 9–10) notes a regex
was "hoisted out... this used to be allocated fresh on every single poll/SSE push."

The heavier, intentional cost lives in `third_party/talishar-fe/src/utils/PreserveIdentities.ts`'s
`preserveIdentities()` (line 14), called from `mergeReceivedGameState()`
(`third_party/talishar-fe/src/features/game/GameSlice.ts` line 291) on `playerOne`, `playerTwo`,
`activeChainLink`, `activeLayers`, and `oldCombatChain` (lines 320–325) on every SSE `message`
event. It recursively walks the **entire** nested game-state tree (arrays and objects,
element-by-element and key-by-key) comparing `next` against `prev`, only allocating a new
container when something inside actually differs — a full O(payload size) tree walk paid on every
push, in exchange for referential stability so React's `useAppSelector` doesn't re-render
components whose data didn't change. This is explained and justified in the file's own doc
comment (lines 1–13): without it, every zone array gets a new identity on every push "even when
nothing in it changed, which makes every subscribed component re-render ~20x/min for no reason."

**No issue found.** This is a deliberate, well-reasoned tradeoff (pay a full-tree walk to avoid
much more expensive unnecessary React re-renders), it's O(n) not O(n²), and — per the "SSE update
path" section above — only runs once per actual gamestate change (not once per 50ms poll tick),
so its cost is bounded by the same per-action cadence as the backend rebuild it's paired with. The
FE parse step itself (`ParseGameState.ts`) shows no complexity red flags and already has a prior
optimization applied. Nothing here rises to a rankable finding.

## GameFile I/O cycle

**Evidence**: the normal-path write is confirmed single: `third_party/talishar/ProcessInput.php`
includes `WriteGamestate.php` exactly once on the standard (non-rematch) request path (line 266,
gated by `if (!$skipWriteGamestate)` at line 264), preceded by `DoGamestateUpdate()`. This matches
[[tal-arch-gamefile-lifecycle]]'s documented lock-then-write-then-cache flow (flock `LOCK_EX`,
truncate+rewrite, then `WriteGamestateCache()`), already covered in `docs/TALISHAR-ARCHITECTURE.md`
— not re-derived here.

**Finding — synchronous multi-file backup rotation on checkpointed actions**: beyond the single
gamestate write, `third_party/talishar/ProcessInput.php` line 270 conditionally calls
`MakeGamestateBackup()` when `$makeCheckpoint` is set (the flag threading through
`AddDecisionQueue()`'s 5th parameter, `third_party/talishar/CardLogic.php` lines 286/310/312/324,
for DQ entries the engine wants to be undo-able). `MakeGamestateBackup()`
(`third_party/talishar/ParseGamestate.php` line 533) performs a **multi-level undo rotation**:
for `$i` from `MAX_UNDO_BACKUPS - 1` down to `1` (`MAX_UNDO_BACKUPS = 10`, defined
`third_party/talishar/Constants.php` line 15), it `rename()`s `gamestateBackup_{i-1}.txt` →
`gamestateBackup_{i}.txt` — up to **9 synchronous `rename()` syscalls** — then writes the current
state into `gamestateBackup_0.txt` via `SaveGamestateSnapshot()` (line 525, either a
`file_put_contents()` of an in-memory mirror or a `copy()` of the just-written `gamestate.txt`).
This is real, synchronous disk I/O in the request-response path, separate from and in addition to
the SHMOP-cached hot path the rest of this doc covers — `MakeStartTurnBackup()` and the
`$MakeStartGameBackup` branch (`third_party/talishar/ProcessInput.php` lines 271–273) add further
conditional `SaveGamestateSnapshot()` calls (single-file copies, not the rotation) on top.

**Impact (estimate)**: 9 renames + 1 write is cheap on a local filesystem (sub-millisecond each in
the common case) but is unconditional synchronous I/O blocking the HTTP response for every
checkpointed action — not every action triggers it (`$makeCheckpoint` is opt-in per DQ entry), but
undo-able actions are common in normal play (most player decisions with a meaningful choice).
Under filesystem contention (network-mounted `Games/` volume, slow disk, or many concurrent games
on the same host) this rotation is the kind of small-but-frequent synchronous I/O that adds up
under load, and it's on the critical path of the player-facing action latency (unlike the SSE
poll loop, which is a separate, spectator-facing connection).

**Fix sketch**: the rotation cost scales with `MAX_UNDO_BACKUPS` (currently 10) regardless of how
much has actually changed since the last checkpoint — a ring-buffer approach (write to
`gamestateBackup_{counter % MAX_UNDO_BACKUPS}.txt` and track the current index in the small cache
segment, instead of renaming every slot on every checkpoint) would turn the 9-rename rotation into
a single write, at the cost of tracking one extra integer. Lower-effort alternative: defer the
rotation to a background/async step after the response is sent (PHP's `fastcgi_finish_request()`
equivalent under the deployed SAPI, if available) so it doesn't block the player-facing response.

**Rank**: Effort Low-Medium (ring-buffer index is a small, self-contained change; async deferral
depends on SAPI/runtime support), Impact Medium (frequent, on the critical path, though each
occurrence is small).

## Bug scan

Per TAL-031 §9.2: triage the design doc's three seed bugs against upstream `Talishar/Talishar`
and `Talishar/Talishar-FE` issue history, confirm each is real (`gh issue view`, read-only), then
grep the vendored engine for code matching that bug's **class** — a real, cited location that
could plausibly cause the same symptom today, not necessarily an unfixed instance of the exact
original bug.

All three seeds are **verified real, closed issues** (confirmed via `gh issue view <n> --repo
<owner>/<repo>`, read-only per §10 I1 — no comment/state change made on any `Talishar/*` repo):

| # | Seed | Repo | Status | Current-code verdict |
|---|------|------|--------|----------------------|
| 1 | BE #501 — SSE disconnect | `Talishar/Talishar` | Closed, fixed | Already mitigated — superseded by more robust code |
| 2 | BE #183 — equipment lag double-activation | `Talishar/Talishar` | Closed, weak fix confirmation | **Live suspect found** |
| 3 | FE #98 — reload freeze | `Talishar/Talishar-FE` | Closed, fixed | Already mitigated |

### BE #501 — SSE disconnect

**Verified**: [github.com/Talishar/Talishar#501](https://github.com/Talishar/Talishar/issues/501),
closed 2023-05-11, single comment from the collaborator who filed it: "Fixed in 70e38978."

**Evidence**: that commit (`git -C third_party/talishar show 70e38978`, still present in the
vendored clone's history) moved opponent-disconnect/timeout detection out of the old polling
endpoint `GetNextTurn3.php` and into `GetUpdateSSE.php`'s persistent loop — a minimal 31-line
move. Reading the **current** `third_party/talishar/GetUpdateSSE.php` (lines 140–270) shows this
mechanism has since been substantially hardened well beyond that original fix: an explicit
`connection_aborted()` check every 2 seconds (`$connectionCheckInterval`, line ~152), a periodic
game-file-existence check (`$fileCheckInterval`, line ~161), a `$buildFailureStreak` counter that
tolerates up to 100 transient `BuildGameStateResponse()` failures before giving up (distinguishing
fatal errors like "Invalid Authkey" from transient ones like a mid-undo revert), and a 15-second
heartbeat SSE event (`event: hb`) that itself re-checks `connection_aborted()` on every send.

**Impact / verdict**: **already mitigated** — the disconnect-detection mechanism #501 introduced
is still present and has grown considerably more defensive since. No live suspect matching this
bug class was found; a future regression here would need to specifically break one of the four
independent safeguards above, not just remove the original fix.

### BE #183 — equipment lag double-activation

**Verified**: [github.com/Talishar/Talishar#183](https://github.com/Talishar/Talishar/issues/183)
("Equipment abilities can be activated multiple times due to lag"), closed, but with a notably
weak fix confirmation — the collaborator's only comment is "I believe I fixed this and did not
close the issue," and a separate comment on the same thread proposes the right general fix
("Using equipment, cards, any ability should be idempotent... Perhaps some way of tracking what
the game frame/turn in requests?") without confirming it was ever implemented.

**Evidence — live, reproducible suspect**: the FE *has* the scaffolding this proposed fix
describes, but it's never wired to the backend. `third_party/talishar-fe/src/features/game/GameSlice.ts`'s
`playCard` thunk (lines 183–216) builds its request with both a per-call idempotency key
(`commandId: createCommandId()`, line 204, a `crypto.randomUUID()`) and an optimistic-concurrency
token (`expectedRevision: String(game.gameDynamicInfo.lastUpdate ?? 0)`, line 203) — exactly the
"track what frame/turn the request is for" mechanism #183's own thread called for. The same two
fields are sent by `submitButton` (lines 234–235) and a third thunk (lines 272–273). But a
repo-wide grep of the **entire vendored backend** (`grep -rn "commandId\|expectedRevision"
third_party/talishar --include="*.php"`) returns **zero matches** — `ProcessInput.php` never reads
either parameter, so nothing on the server rejects a stale `expectedRevision` or deduplicates a
repeated `commandId`. On the click side, neither call site that dispatches `playCard` guards
against a second dispatch while the first is still in flight:
`third_party/talishar-fe/src/routes/game/components/elements/playerHandCard/PlayerHandCard.tsx`'s
`playCardFunc` (line 184) and
`third_party/talishar-fe/src/routes/game/components/elements/cardDisplay/CardDisplay.tsx`'s
`onClick` (line 95) both call `dispatch(playCard(...))` unconditionally. `CardDisplay.tsx` does
declare a `preventUseOnClick` prop (line 20) that could gate this, and it **is** wired up at
several call sites — `GraveyardZone.tsx` (line 112), `BanishZone.tsx` (line 110), `PitchZone.tsx`
(line 97), `OtherInput.tsx` (line 39), and `CardDisplay.tsx`'s own sub-card self-reference (line
178) all pass it as JSX shorthand (`preventUseOnClick`, no `=`, easy to miss with a
`preventUseOnClick="` grep). But none of the **equipment zones** pass it: a check of all 6
equipment-slot components (`WeaponRZone.tsx`, `ChestEqZone.tsx`, `ArmsEqZone.tsx`,
`LegsEqZone.tsx`, `HeadEqZone.tsx`, `WeaponLZone.tsx`) plus `HeroZone.tsx` and `ArsenalZone.tsx`
shows every one of them renders `<CardDisplay card={...} isPlayer={isPlayer} />` with no
`preventUseOnClick` — exactly the zones #183's "equipment abilities" symptom lives in. Separately,
`GameSlice.ts`'s `isPlayerInputInProgress` flag (set `true` on `playCard.pending`, line 992)
exists in Redux state but nothing in either click handler reads it to disable the card, and
`PlayerHandCard.tsx`'s `playCardFunc` doesn't render through `CardDisplay` at all, so
`preventUseOnClick` couldn't gate it even if passed.

**Impact**: a rapid double-click or a slow/lagged first response (the exact symptom #183
describes) fires `playCard` twice with two different `commandId`s and, since the backend
validates neither, both requests are processed as independent, non-idempotent actions against
`ProcessInput.php` — reproducing the original "activated multiple times" symptom class today, not
just historically. This is worse than the pre-#183 state in one sense: the client-side scaffolding
now *looks* like a fix is in place (a reviewer skimming `GameSlice.ts` would reasonably assume
`commandId`/`expectedRevision` do something), which is its own DX/correctness hazard.

**Fix sketch**: two independent, complementary changes — (1) backend: have `ProcessInput.php`
read `expectedRevision` and reject (or no-op) a request whose value doesn't match the game's
current `lastUpdate` counter (already tracked server-side per the "SSE update path" section
above), and track the last-seen `commandId` per game+player (e.g. alongside the small shmop
"cache" array) to no-op an exact repeat; (2) frontend: gate both `playCardFunc`
(`PlayerHandCard.tsx`) and `CardDisplay.tsx`'s `onClick` on `isPlayerInputInProgress` (already
computed, already in state, just unread by these two call sites) — either disable the click or
early-return. For `CardDisplay.tsx`'s own `onClick`, wiring `isPlayerInputInProgress` into
`preventUseOnClick` at the equipment/hero/arsenal zone call sites (mirroring the pattern the
graveyard/banish/pitch zones already use for a different reason) would close that gap with the
same mechanism already proven elsewhere in the component.

**Rank**: Effort Low-Medium (frontend gate is a small, localized change; backend validation
touches `ProcessInput.php`'s existing revision-tracking path rather than adding a new one),
Impact High (this is a player-facing correctness bug — a duplicated equipment activation or
duplicated card play is a real-game-state bug, not just a performance cost).

### FE #98 — reload freeze

**Verified**: [github.com/Talishar/Talishar-FE#98](https://github.com/Talishar/Talishar-FE/issues/98)
("reloading the page causes a freeze"), closed. The fix comment identifies the exact root cause:
a missing `<base href="/">` in `index.html`, a known React-Router-on-refresh footgun (the
issue's own linked Stack Overflow explains why: without a `<base>` tag, a client-side route like
`/game/123` reloaded fresh resolves relative asset URLs against `/game/` instead of `/`, 404ing
the JS bundle and freezing the page).

**Evidence**: `third_party/talishar-fe/index.html` line 62 currently reads `<base href="/" />` —
the exact fix the issue's comment prescribed.

**Impact / verdict**: **already mitigated**, no live suspect found for this specific class. One
caveat worth recording for future deploy changes rather than as a live bug: `href="/"` is a
hardcoded absolute root — if the app were ever deployed under a subpath (e.g.
`example.com/talishar/`) rather than domain root, this exact freeze-on-reload symptom would
reproduce, since the fix is coupled to a root-path deployment assumption. Not a finding against
the current deployment model, just a note that this fix is deploy-path-specific, not
subpath-agnostic.

## DX

Friction found while working with the vendored Talishar stack, plus test-coverage and stale-doc
gaps beyond the port-8000/CardImages-URL drift [[tal-dev-gotchas]] already documented (TAL-013).
Each item below has a concrete improvement proposal, not just a complaint.

### Finding 1: backend has a configured test framework but almost no card-implementation coverage

`third_party/talishar/composer.json` declares `phpunit/phpunit` as a dev dependency and an
`autoload-dev` PSR-4 mapping for `Talishar\Tests\` → `tests/`, and
`third_party/talishar/CLAUDE.md` (lines 21–24) documents `./vendor/bin/phpunit` with three named
test suites (Security, Validation, Business Logic). The suite is real and non-trivial: 11 test
files exist (`third_party/talishar/tests/{Security,Validation,BusinessLogic,Engine}/*.php`) —
`SessionManagementTest.php`, `CSRFProtectionTest.php`, `SQLInjectionTest.php`,
`XSSPreventionTest.php`, `GameLogicTest.php`, `CombatMathTest.php`,
`CombatChainStateTest.php`, `ZoneStructureTest.php`, `CardDataTest.php`,
`InputValidationTest.php` — covering session/security/validation and generic engine mechanics.
But `third_party/talishar/Classes/CardObjects/` has **53** per-set card-implementation files
(`grep -c` on the directory) and **zero** of the 11 test files target individual card hooks —
the exact surface `/talishar-implement-card`'s implementation phase writes to. A new card's only
verification path today is the skill's own docker-based live HTTP exercise
(`ProcessInput.php`/`GetUpdateSSE.php`, per this repo's `CLAUDE.md` "Implement a card" section) —
there's no fast, offline, PHPUnit-level check a contributor (or a future dev-agent implementation
phase) can run before standing up the full docker stack.

**Proposal**: add one minimal `tests/Engine/CardHookTest.php` (or a `CardObjects/` subdirectory
under `tests/`) that instantiates a single already-implemented card and asserts its declared hooks
return the expected shape (e.g. a DQ entry count/type) without a live game session — a template a
future card-implementation session could copy per new card. This doesn't replace the docker-based
live validation the skill already does (real game-state behavior can't be unit-tested in
isolation), but it closes the gap between "phpunit is configured and documented" and "phpunit
covers zero cards" for at least a smoke-test tier.

### Finding 2: FE test coverage is extremely thin outside a handful of utility modules

`third_party/talishar-fe`'s `package.json` wires `vitest` (`"test": "vitest"`, line 53) and the
harness works — but a repo-wide count shows only **5** `*.test.ts(x)` files
(`PlayerPresence.test.ts`, `PreserveIdentities.test.ts`, `multilanguage.test.ts`,
`matcher.test.ts`, `CardImage.test.tsx`) against **375** non-test `.ts`/`.tsx` source files under
`third_party/talishar-fe/src` — roughly 1.3% file coverage. The 5 existing tests cluster around
low-level, pure-function utilities (identity preservation, i18n string lookup, keyword matching,
presence state); none of the Redux slices that drive gameplay (`GameSlice.ts`, at ~1000+ lines
the single largest behavioral surface in the FE, including the `playCard`/`isPlayerInputInProgress`
logic the BE #183 bug-scan finding above turns on) have any test coverage at all.

**Proposal**: rather than a blanket "add more tests" ask, target the highest-leverage gap first —
a `GameSlice.test.ts` covering the request-building thunks (`playCard`, `submitButton`) and their
pending/fulfilled/rejected reducers (`isPlayerInputInProgress` transitions in particular) would
both raise real coverage and directly pin down the exact behavior the #183 fix needs to not
regress, once implemented.

### Finding 3: no documented convention for when a FE zone must pass `preventUseOnClick`

`CardDisplay.tsx` declares a `preventUseOnClick?: boolean` prop (line 20) that its `onClick`
handler checks (line 90), and it genuinely **is** used — 5 real call sites pass it as JSX
shorthand (`GraveyardZone.tsx:112`, `BanishZone.tsx:110`, `PitchZone.tsx:97`,
`OtherInput.tsx:39`, `CardDisplay.tsx:178`'s own sub-card self-reference), so this is not dead
code. But nothing documents *why* those 5 zones pass it and the other ~15 `<CardDisplay>` call
sites (including all 6 equipment zones and `HeroZone`/`ArsenalZone`, per the BE #183 finding
above) don't — a future contributor adding a new interactive zone has no written rule to consult
for whether their zone needs it, only prior art to reverse-engineer from reading every existing
call site.

**Proposal**: a one-line JSDoc comment on the `preventUseOnClick` prop declaration itself
(`CardDisplay.tsx` line 20) stating the actual convention — e.g. "pass this for any zone where
the card is display-only / not a legal action target, to suppress the play/activate click" —
would turn "read every call site to infer the pattern" into "read the prop's own doc comment,"
the same fix shape as Finding 2's coverage gap: closing a knowledge gap at its source rather than
downstream.
