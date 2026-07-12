---
task: PRICE-068
spec: price
sections: ["§4.3", "§9.1", "§9.3"]
---

**Reason:** user request — a stable, official reference (the FAB printing
code, e.g. `EVR141` for Everfest card #141) that disambiguates rows
precisely (the same card can appear in multiple sets/printings) and is
independent of either marketplace's own naming quirks, useful for
cross-referencing against physical cards or other databases. Investigated
and confirmed feasible: the vendored `third_party/flesh-and-blood-cards`
card DB carries the code per printing (`card.json`'s `printings[].id`,
keyed to a set via `printings[].set_id` -> `set.json`'s `id`/`name`), and
`set.json`'s set names match tcgcsv/Cardmarket-anchored set display names
closely enough (case/whitespace differences only, in the common case) for
a normalized-name lookup.

## §4.3 Pages — ADDED

Every registered page (price pages and ratio pages) gains a **Code**
column, positioned immediately after **Finish** and before the first price
column: `Name, Set, Finish, Code, NM, ...`. The Code column carries the
official FAB printing identifier for that row (e.g. `EVR141`), resolved
against the vendored card DB (`third_party/flesh-and-blood-cards`) by
`(canonical card name, canonical set name, finish)` — never guessed, and
never sourced from either marketplace's own product identifiers. When the
vendored DB has no entry matching that exact (name, set, finish) triple —
because the row is genuinely absent from the DB, or because the two
sources spell the set name differently (e.g. tcgcsv's "Armory Deck:
Legends Prism" vs the vendored DB's "Armory Deck Legends - Prism") — the
cell is empty (`—` in the terminal, `""` in CSV), following the same
empty-cell convention as every other unmatched value in the system (I4/I7
still apply: this is a disambiguation aid, not a match/no-match signal, so
an empty Code never causes a row to be treated as unmatched).

A printing's `foiling` field in the vendored DB (Standard / Rainbow Foil /
Cold Foil / Gold Foil) is very often shared by one printing id across all
of a card's finishes in a set (e.g. Everfest's `EVR141` covers both the
Standard and Rainbow Foil rows of Haze Bending) but not always — some sets
assign the foil-exclusive row its own distinct id (e.g. Local Game Store
Promos' Ironsong Response: `LGS008` normal, `LGS029` foil). The lookup is
therefore keyed by finish too, not collapsed across foilings.

**Pitch disambiguation (post-review amendment):** a multi-pitch card is
represented as three separate entries in the vendored DB — one per pitch,
each with its own `pitch` field ("1"/"2"/"3") — and the DB's `name` field
never carries a pitch suffix on any of them (e.g. three "Bare Fangs"
entries, pitch 1/2/3, each with its own distinct Everfest code: `EVR008`/
`EVR009`/`EVR010`). Marketplace product names DO carry the `(Red)`/
`(Yellow)`/`(Blue)` suffix for these cards, which `normalizeCardName`
deliberately preserves (§7.1) — so the Code lookup parses that suffix back
out and routes it to the DB's matching `pitch` field, rather than treating
`(name, set)` alone as the key. Looking up a multi-pitch card WITHOUT a
pitch suffix is ambiguous (three candidate codes, no way to pick the right
one) and returns empty rather than guessing; a single-pitch card resolves
regardless of any suffix, since there is no competing pitch entry to
confuse it with.

## §9.1 `card` command — ADDED

The TCGplayer price table, the Cardmarket price table, and both ratio
tables each gain the Code column in the position defined in §4.3. The
`--csv` output's four pages gain it identically (see §9.3).

## §9.3 CSV format — ADDED

Every CSV page's header gains a `Code` field immediately after `Finish`:

- Price pages: `Name,Set,Finish,Code,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source` (Cardmarket page keeps its trailing `Trend,Trend Source` pair unchanged after `HP Source`).
- Ratio pages: `Name,Set,Finish,Code,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis`.
- `unmatched.csv`: `Provider,Name,Set,Finish,Code,Reason`.

The Code cell follows the same empty-if-absent convention as every other
CSV field (empty string, never a placeholder) — this applies uniformly
across price pages, ratio pages, and `unmatched.csv`.
