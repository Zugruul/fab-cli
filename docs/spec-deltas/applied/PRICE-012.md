---
task: PRICE-012
spec: price
sections: ["§9.1"]
---

## §9.1 `fab-cli price-comparison card <name>` — ADDED

**Reason:** implementing `assembleCardComparison`/`buildCardmarketRows`
(`src/pricing/cardCommand.ts`, PRICE-012) against real Cardmarket price-guide
data showed that the `-foil` price-guide fields are present (and explicitly
`null`) on essentially every product row, whether or not that product has an
actual foil printing — their presence alone does not signal "this card has a
foil variant." Emitting a foil `PriceRow` for every Cardmarket product
regardless would manufacture an all-null row for cards with no foil printing
at all, which then surfaces as spurious `no-price` noise in the unmatched
report (§7.3) for a printing that was never real. §9.1 did not previously say
whether/when a foil row should be emitted for the `card` command's Cardmarket
side; this delta states the rule PRICE-012 implements.

**Added wording (appended to §9.1's description of Cardmarket data assembly):**

> For each Cardmarket product matched to the resolved card, the command
> resolves both a normal-finish row and a foil-finish row via §8.3's
> `resolvePrices`. The normal-finish row is always emitted. The foil-finish
> row is emitted only if `resolvePrices(row, 'foil')` yields a non-null `nm`
> or `others` — i.e. at least one real foil price field (`trend-foil`,
> `avg30-foil`, `avg7-foil`, `avg1-foil`, or `low-foil`) is present and not
> the Cardmarket "no data" marker (§8.3). A Cardmarket product whose foil
> price-guide fields are all null or absent is treated as "no foil variant
> tracked" and produces no foil row — it is not reported in `unmatched.csv`
> as a `no-price` foil printing. Trade-off: this also means a *genuinely*
> foil-printed card whose foil price data happens to be transiently
> unpriced (all foil fields null on a given day) is silently omitted from
> `card` output for that printing, rather than surfaced as an
> unmatched/no-price row — accepted as the simpler behavior for v1 given
> Cardmarket exposes no separate "foil printing exists" flag to disambiguate
> the two cases.
