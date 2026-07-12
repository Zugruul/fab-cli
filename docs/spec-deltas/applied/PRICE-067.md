---
task: PRICE-067
spec: price
sections: ["§8.3", "§8.4"]
---

**Reason:** the user reviewed the rendered Cardmarket price page and pointed
out that showing the same aggregate `low` value in all four condition
columns (NM, SP/LP, MP, HP) falsely implies per-condition granularity that
Cardmarket does not publish — it is a single "cheapest listing across any
condition" number, empirically usually NM, not four independently observed
prices. This tightens the "real data or nothing" doctrine from #61 one step
further: not just "no fabricated fallback copies," but "no fan-out of one
aggregate number into columns it doesn't actually describe." Confirmed via
an explicit yes/no question before implementation.

## §8.3 Cardmarket — MODIFIED

**Original wording:**

> **All four condition columns (NM, SP/LP, MP, HP) = `low`** (or `low-foil` for foil rows), source `low`. Cardmarket listings are overwhelmingly NM, so `low` is empirically the cheapest real NM price — this is a real observed value, not a fabricated fill. IF `low` is null or absent THEN all four condition cells are empty.

**Replacement wording:**

> **Only NM = `low`** (or `low-foil` for foil rows), source `low`. **SP/LP, MP, HP are always empty** — Cardmarket publishes no real per-condition data at all, only one aggregate `low` value; fanning that single number into the other three columns implied granularity that doesn't exist. IF `low` is null or absent THEN the NM condition cell is empty too (SP/LP, MP, HP were already always empty).

## §8.4 Ratio math — MODIFIED (clarifying only, no mechanism change)

**Original wording:**

> A ratio cell for (A, B, condition C) fires ONLY when BOTH sides have a real cell for C — TCGplayer's `listing` price vs Cardmarket's `low` price. There are no fallback-sourced cells left to participate, so ratio tables are sparser by design: a condition with no real TCGplayer listing produces no ratio for that cell even though Cardmarket's `low` cell is present (empty propagates).

**Replacement wording:**

> A ratio cell for (A, B, condition C) fires ONLY when BOTH sides have a real cell for C — TCGplayer's `listing` price vs Cardmarket's `low` price. Post-#67, Cardmarket only ever has a real cell for NM (§8.3), so on the Cardmarket pairing a ratio cell can only ever exist for the NM column — SP/LP, MP, HP are always empty on both ratio pages, regardless of what TCGplayer has. There are no fallback-sourced cells left to participate; empty propagates via the existing mechanism, unchanged.
