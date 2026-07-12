---
task: PRICE-061
spec: price
sections: ["§8.1", "§8.2", "§8.3", "§8.4", "§6.4", "§9.1", "§9.3"]
---

**Reason:** the user validated `fab-cli price-comparison card` output against
real TCGplayer/Cardmarket listing pages. TCGplayer listing-sourced numbers
matched the real listing page exactly; every fabricated cell (the
`adjacent:<COL>` copy, the `market`/`lowPrice` stand-in on TCGplayer, and the
NM-only `trend` value silently standing in for a real per-condition price on
Cardmarket) diverged from what a buyer would actually see. Ruling: real data
or nothing — an empty cell is honest, a fabricated cell is a bug. This delta
removes every fabricated-fill path and reshapes the Cardmarket price page to
show real, observable data plus one clearly-labeled reference column.

## §8.1 General rule — MODIFIED

**Original wording:**

> Each condition cell is `{ price, source }`; `source` states exactly where
> the number came from. Source labels: `listing` (real lowest listing for
> that condition), `adjacent:<COL>` (copied from another condition column),
> `market` (TCGplayer marketPrice), `trend` / `low` (Cardmarket price-guide
> fields).

**Replacement wording:**

> Each condition cell is `{ price, source }`; `source` states exactly where
> the number came from. There is no fabricated-fill source: a condition with
> no real price is an empty cell, never a copy or a stand-in. Source labels:
> `listing` (TCGplayer's real lowest live listing for that exact condition),
> `low` (Cardmarket's price-guide `low`/`low-foil` field — used for all four
> Cardmarket condition columns), and, for the Cardmarket page's separate
> reference-only Trend column, `trend` / `avg30` / `avg7` / `avg1` (the §8.3
> cascade).

## §8.2 TCGplayer — MODIFIED

**Original wording:**

> - WHEN at least one live listing exists for (row, condition) THE SYSTEM
>   SHALL use the lowest listing price with source `listing`.
> - IF a condition has no listings THEN THE SYSTEM SHALL copy the nearest
>   available condition column's price (distance in column order
>   NM–SP/LP–MP–HP; on equidistant ties prefer the better condition, i.e. the
>   one closer to NM) with source `adjacent:<COL>`.
> - IF no condition has any listing THEN THE SYSTEM SHALL fill NM from
>   tcgcsv `marketPrice` (falling back to `lowPrice` if marketPrice is null)
>   with source `market`, then apply the adjacency rule to the remaining
>   columns.
> - IF neither listings nor tcgcsv prices exist THEN all four cells SHALL be
>   empty and the row SHALL appear in `unmatched.csv` with reason
>   `no-price`.

**Replacement wording:**

> - WHEN a live listing exists for (row, condition) THE SYSTEM SHALL use the
>   lowest listing price for that exact condition, with source `listing`.
> - IF a condition has no live listing THEN its cell SHALL be empty. There is
>   no adjacency copy from another condition column and no `marketPrice` /
>   `lowPrice` stand-in — a condition with no real listing is empty, full
>   stop.
> - IF no condition has any listing THEN all four cells SHALL be empty and
>   the row SHALL appear in `unmatched.csv` with reason `no-price`.
> - **403-degraded export mode (§6.4, PRICE-021):** when the TCGplayer
>   storefront search is unavailable (sustained 403s) for a set, degraded
>   mode means empty `tcgplayer` cells for every row in that set — never a
>   `marketPrice`/`lowPrice` stand-in — plus a summary note recording which
>   set(s) were degraded and why (see §6.4 below).

## §8.3 Cardmarket — MODIFIED

**Original wording:**

> No per-condition source exists (§6.3), so deterministically:
>
> - NM = `trend` (or `trend-foil` for foil rows), source `trend`; IF the
>   field is null or absent THEN fall back to `avg30`→`avg7`→`avg1`→`low` in
>   that order, keeping the field name as source. For the foil finish only, a
>   `trend-foil` value of exactly `0` is ALSO treated as no-data (Cardmarket's
>   observed upstream marker for "no trend price recorded") and triggers the
>   same fallback cascade. A normal-finish `trend` of `0` is a genuine price
>   and is used as-is with source `trend` — it never triggers the fallback.
> - SP/LP, MP, HP = `low` (or `low-foil`), source `low` — always flagged as
>   fallback since `low` is the cheapest listing of *any* condition.
> - IF every field is null THEN all cells empty, reason `no-price`.

**Replacement wording:**

> No per-condition source exists (§6.3), so deterministically:
>
> - **All four condition columns (NM, SP/LP, MP, HP) = `low`** (or
>   `low-foil` for foil rows), source `low`. Cardmarket listings are
>   overwhelmingly NM, so `low` is empirically the cheapest real NM price —
>   this is a real observed value, not a fabricated fill. IF `low` is null or
>   absent THEN all four condition cells are empty.
> - **A separate, reference-only `Trend` column** (never used in ratio
>   cells, §8.4) carries the price-guide trend value: `trend` (or
>   `trend-foil`), source `trend`; IF the field is null or absent THEN
>   cascade `avg30`→`avg7`→`avg1` in that order, keeping the field name as
>   source. For the foil finish only, a `trend-foil` value of exactly `0` is
>   ALSO treated as no-data (Cardmarket's observed upstream marker for "no
>   trend price recorded") and triggers the same cascade. A normal-finish
>   `trend` of `0` is a genuine price and is used as-is with source `trend`.
>   The Trend cascade does **not** fall back to `low` — `low` is exclusively
>   the condition columns' source, keeping the two values independently
>   sourced.
> - IF the row has neither a `low` value nor any Trend-cascade value THEN
>   the whole row (all four condition cells and Trend) is empty, reason
>   `no-price` (unchanged §7.3 handling).

## §8.4 Ratio math — MODIFIED

**Original wording:**

> - IF either side's cell is empty for that condition THEN the ratio cell
>   SHALL be empty (fallback-sourced cells DO participate, and the ratio
>   page carries their source via companion `<COL> Basis` columns of the
>   form `listing/trend`, `adjacent:MP/low`).

**Replacement wording:**

> - A ratio cell for (A, B, condition C) fires ONLY when BOTH sides have a
>   real cell for C — TCGplayer's `listing` price vs Cardmarket's `low`
>   price. There are no fallback-sourced cells left to participate, so ratio
>   tables are now sparser than before by design: a condition with no real
>   TCGplayer listing produces no ratio for that cell even though
>   Cardmarket's `low` cell is present (empty propagates). The companion
>   `<COL> Basis` column now only ever reads `listing/low` (the sole
>   surviving pairing) when a ratio cell is present, and is empty when it is
>   not. The Cardmarket Trend column is reference-only and is NEVER read by
>   ratio math.

## §6.4 Rate limiting and politeness — MODIFIED (addition)

**Addition (for PRICE-021's 403-degraded export mode):**

> When the TCGplayer storefront search is unavailable for a set (sustained
> 403s after retry/backoff), export degrades that set's `tcgplayer` price
> page rows to empty condition cells — never a `marketPrice`/`lowPrice`
> stand-in, per §8.2's real-data-only rule — and the export's final summary
> (§9.2) SHALL list which set(s) were degraded and why, so a degraded run is
> visibly distinguishable from a genuinely no-price catalog.

## §9.1 `card` command — MODIFIED

**Original wording:**

> - Fallback-sourced prices render **bold** (chalk) with a footnote below
>   each table: `bold = price not found for this condition; taken from
>   <sources actually used>`.
> - For each Cardmarket product matched to the resolved card, the command
>   resolves both a normal-finish row and a foil-finish row via §8.3's
>   `resolvePrices`. ... produces no foil row ...

**Replacement wording:**

> - There is no bold/footnote fallback mechanism — every price cell is
>   either a real value or the empty marker `—`. The Cardmarket price table
>   gains one additional trailing column, `Trend`, rendered the same way
>   (real value or `—`) directly after HP; it is reference-only and carries
>   no bold/footnote semantics either.
> - For each Cardmarket product matched to the resolved card, the command
>   resolves a normal-finish row and a foil-finish row via §8.3's amended
>   `resolvePrices`, which now returns `{ conditions, trend }`. The
>   normal-finish row is always emitted (with its `conditions`/`trend` pair,
>   possibly both empty). The foil-finish row is emitted only if
>   `resolvePrices(row, 'foil')` yields a non-null `conditions` or `trend` —
>   i.e. at least one real foil price field (`low-foil` or one of the
>   `trend`-cascade `-foil` fields) is present and not the Cardmarket
>   "no data" marker (§8.3). Everything else about foil-row emission is
>   unchanged from the original wording.
> - Ratio table Basis cells now read `listing/low` (or are empty) — see §8.4.

## §9.3 CSV format — MODIFIED

**Original wording:**

> Price page header: `Name,Set,Finish,NM,NM Source,SP/LP,SP/LP
> Source,MP,MP Source,HP,HP Source`. Prices are plain decimals (no currency
> symbol); the currency is stated in a leading comment line `# currency:
> USD`.

**Replacement wording:**

> Price page header (TCGplayer page, unchanged):
> `Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source`.
> The **Cardmarket price page header gains a trailing `Trend,Trend Source`
> companion pair**:
> `Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP
> Source,Trend,Trend Source`. Prices are plain decimals (no currency symbol);
> the currency is stated in a leading comment line `# currency: EUR` for
> that page. The Trend column follows the same empty-if-absent rule as every
> other cell and is never consumed by the ratio pages.
