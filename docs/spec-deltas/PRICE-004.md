---
task: PRICE-004
spec: price
sections: ["§8.3"]
---

## §8.3 Cardmarket — MODIFIED

**Reason:** implementing the `trend`/`trend-foil` null-cascade against real
Cardmarket price guide data (`src/pricing/cardmarket.ts`, PRICE-004) showed
that "trend is null/0" is not a single rule for both finishes. A normal-finish
`trend` of exactly `0` is a genuine (if unusually low) traded price and must
be returned as-is; only the `trend-foil` field uses `0` as an explicit
upstream marker for "no data" (never observed on normal `trend`). Treating a
real `trend: 0` as no-data would silently discard a valid price and cascade
to a worse (staler) source.

**Original wording:**

> NM = `trend` (or `trend-foil` for foil rows), source `trend`; IF trend is null/0 THEN fall back to `avg30`→`avg7`→`avg1`→`low` in that order, keeping the field name as source.

**Replacement wording:**

> NM = `trend` (or `trend-foil` for foil rows), source `trend`; IF the field is null or absent THEN fall back to `avg30`→`avg7`→`avg1`→`low` in that order, keeping the field name as source. For the foil finish only, a `trend-foil` value of exactly `0` is ALSO treated as no-data (Cardmarket's observed upstream marker for "no trend price recorded") and triggers the same fallback cascade. A normal-finish `trend` of `0` is a genuine price and is used as-is with source `trend` — it never triggers the fallback.
