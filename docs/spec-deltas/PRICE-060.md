---
task: PRICE-060
spec: price
sections: ["§7.2"]
---

## §7.2 Cardmarket expansion mapping (anchoring) — MODIFIED

**Reason:** a user screenshot showed `fab-cli price-comparison card "Haze
Bending"` mislabeling a Cardmarket row as "Armory Deck: Azalea" (issue #60).
Investigation traced it to idExpansion 4501: the anchoring vote was a 1-1
tie between "Armory Deck: Azalea" and "Mastery Pack Warrior", silently
resolved by the algorithm's lexicographic tiebreak — not a real majority.
idExpansion 4501 also has 472 total Cardmarket products against a 34-product
tcgcsv group (a ~14x mismatch), consistent with Cardmarket having merged
several small physical products under one idExpansion. §7.2 as written had
no confidence floor: any vote, tied or not, at any size mismatch, was
assigned a name. Two guards close that gap; regenerating the live data with
them removed exactly the reported bug case plus two further no-confidence
cases (a second tied vote, and one size-implausible case), while leaving
every high-confidence mapping (e.g. the verified-good idExpansion 4500 →
Everfest, 28 votes, no runner-up) unchanged.

**Original wording:**

> `scripts/cardmarket-expansions.ts` SHALL: for every card name that exists
> in exactly one TCGplayer set and whose Cardmarket products all share one
> `idExpansion`, record a vote `idExpansion → tcgcsv group name`; assign
> each `idExpansion` the majority-vote name; write
> `data/cardmarket-expansions.json` with per-expansion vote counts and a
> separate `overrides` section that always wins.

**Replacement wording:**

> `scripts/cardmarket-expansions.ts` SHALL: for every card name that exists
> in exactly one TCGplayer set and whose Cardmarket products all share one
> `idExpansion`, record a vote `idExpansion → tcgcsv group name`. Before
> assigning a majority-vote name to an `idExpansion`, THE SYSTEM SHALL apply
> two confidence guards, in order:
>
> 1. **Tie guard:** IF the top vote count is shared by 2+ candidate names
>    THEN the `idExpansion` SHALL be omitted from `votes` entirely — a tie
>    is not a majority, and THE SYSTEM SHALL NOT break it via lexicographic
>    or any other silent ordering.
> 2. **Size-plausibility guard:** THE SYSTEM SHALL compare the `idExpansion`'s
>    TOTAL Cardmarket product count (every CM product sharing that
>    `idExpansion`, not just the ones that cast a qualifying vote) against
>    the winning tcgcsv group's TOTAL product count. IF the CM count exceeds
>    2.5x the tcgcsv group's count THEN the `idExpansion` SHALL be omitted
>    from `votes` — a CM expansion far larger than the group it "won" almost
>    always means Cardmarket merged multiple physical products under one
>    `idExpansion`, and the vote is not trustworthy even though it wasn't
>    tied. (2.5x was chosen from a full pass over the live dataset:
>    legitimate full-size expansions cluster at 1.4x-2.0x — CM catalogs more
>    finish/variant rows per card than a tcgcsv group does — while every
>    observed merge case sits at 5.6x or above.)
>
> An `idExpansion` that fails either guard SHALL NOT appear in `votes` at
> all (same treatment as an `idExpansion` with no qualifying votes). Because
> `votes` is always rebuilt from scratch on regeneration (never merged with
> the previous file's `votes`), a previously-passing entry that no longer
> clears a guard is dropped on the next regeneration, not carried forward.
> `overrides` is unaffected by both guards and always wins at lookup. Write
> `data/cardmarket-expansions.json` with per-expansion vote counts and a
> separate `overrides` section that always wins.
