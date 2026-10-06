---
tags: [talishar, architecture, targeting, multizone]
paths: ["third_party/talishar/Search.php", "third_party/talishar/MZLogic.php"]
strength: 1
source: "third_party/talishar/Search.php; third_party/talishar/MZLogic.php"
graduated: false
created: 2026-07-19
---

MultiZone (MZ) targeting is the DSL that lets a card's PHP logic describe "search these zones for
matching cards" without hand-writing per-zone loops. Two files implement it, both at the repo root
of `third_party/talishar`:

**`Search.php`** (2344 lines) defines one `Search{Zone}()` function per zone — `SearchDeck`,
`SearchHand`, `SearchCharacter`, `SearchPitch`, `SearchDiscard`, `SearchBanish`,
`SearchCombatChainLink`, `SearchActiveAttack`, `SearchCombatChainAttacks`, `SearchArsenal`,
`SearchAura`, `SearchItems`, `SearchAllies`, `SearchPermanents`, `SearchLayer`, `SearchLandmarks`,
`SearchSoul`, and a generic `SearchCardList()` (lines ~3-120) — each taking the same large set of
optional filter params (`$type`, `$subtype`, `$maxCost`/`$minCost`, `$class`, `$talent`, `$pitch`,
`$comboOnly`, `$hasWard`, etc., varying slightly per zone's relevant flags) and delegating the
actual filtering to a shared `SearchInner()` (line 121). `SearchMultizone($player, $searches)`
(line 1653) is the real entry point for the `"MYHAND:cost<2;type=AA&THEIRDISCARD:..."` mini-DSL
referenced elsewhere in this brain and in card implementations: it `explode("&", ...)`s the string
into per-zone union clauses, `explode(":", ...)` splits each into a zone name (`MYHAND`,
`THEIRDISCARD`, `MYCHAR`, etc.) and a `;`-separated `key=value` condition list, dispatches to the
matching `Search{Zone}()` call, and unions the results. `MultiZoneIndices()` (`MZLogic.php` line
~816, backing the DQ verb of the same name — see [[tal-arch-decision-queue-await]]) wraps
`SearchMultizone()` and additionally rewrites certain zone shorthand (`MYALLY`/`THEIRALLY` expand
into a `MYCHAR:subtype=Ally`/`THEIRCHAR:subtype=Ally` union, similarly for auras and equipment
items) before calling it, then deduplicates the result and returns `"PASS"` for an empty match.

**`MZLogic.php`** (857 lines) converts between the two representations MultiZone results travel
in: a `{ZONE}-{index}` positional target (e.g. `"MYHAND-3"`) and a `{ZONE}UID-{uniqueID}` stable
target that survives zone reshuffling between when a card is chosen and when it's later acted on.
`CleanTarget($player, $lastResult)` (line 736) takes a raw `{ZONE}-{index}` target and converts it
to the UID form via a `switch` over the zone name (`LAYER`, `THEIRDISCARD`/`MYDISCARD`,
`THEIRBANISH`/`MYBANISH`, `THEIRAURAS`/`MYAURAS`, `MYCHAR`/`THEIRCHAR`, `COMBATCHAIN`/
`COMBATCHAINLINK`, `MYALLY`/`THEIRALLY`, `MYPERM`, `MYITEMS`/`THEIRITEMS`, `COMBATCHAINATTACKS`/
`PASTCHAINLINK` passthrough), looking the object up in the live zone array and reading its unique
ID off a fixed slot offset (e.g. `$char[$targetArr[1] + 11]` for `MYCHAR`). `CleanTargetToObject`
(line 729) resolves a UID-form target straight to the live card/zone object via
`GetZoneObject($player, $zone)->FindCardUID($uid)`. `CleanTargetToIndex($player, $target)` (line
814) does the reverse — UID form back to positional `{zone}-{index}` — passing numeric targets
through unchanged (already an index) and stripping a trailing `UID` off the zone name before
resolving.

Together, `Search.php` builds the match set a DQ's `MULTIZONEINDICES` verb returns, and `MZLogic.php`
is what lets that result be safely referenced later (after intervening zone mutations) via the
`CleanTarget*` family — see [[tal-arch-decision-queue-await]] for the DQ-verb-level syntax
(`MULTIZONEINDICES`, `(MAY)CHOOSEMULTIZONE`, `MZREMOVE`) this implements underneath.
