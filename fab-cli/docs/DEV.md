# Developer Notes

Manual live-smoke checklists for command surfaces that only fully exercise against real
network services (the merge gate runs offline — see SPEC-PRICE.md §10 I3). Run these by hand
after touching the relevant code, and note the results in the PR body.

## Price comparison

Checklist for `fab-cli price-comparison card` and `fab-cli price-comparison export`
(SPEC-PRICE.md §9, §12):

1. `fab-cli price-comparison card "<a multi-printing card>"` — verify all 4 pages render
   (TCGplayer prices, Cardmarket prices + Trend column, and both ratio tables), and that any
   missing price shows as an empty cell (`—`) rather than a fabricated/estimated value.
2. `fab-cli price-comparison card "<same card>" --currency eur` — verify the ratio tables
   convert to EUR and the FX rate/date line above them changes accordingly.
3. `fab-cli price-comparison card "<an ambiguous partial name>"` — verify it exits 1 and lists
   candidate names instead of guessing.
4. `fab-cli price-comparison export --set "<a small set>"` — verify all 5 files are written
   (`prices-tcgplayer.csv`, `prices-cardmarket.csv`, `ratio-tcgplayer-cardmarket.csv`,
   `ratio-cardmarket-tcgplayer.csv`, `unmatched.csv`) and the summary line reports a sane match
   rate. Run it a second time and diff — Cardmarket rows should be byte-identical between runs
   (cached, stable); TCGplayer rows may differ slightly since listing prices are live.
