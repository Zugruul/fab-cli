# Design — price/E2: Export + CSV pages

Grounded in: SPEC-PRICE §9.2, §9.3, §6.2, §6.4, §11, §7.3, and the §61/§60 deltas already folded into §6.1/§6.2/§8.1-§8.4/§7.2/§9.1/§9.3 (real-data-only cells, CM low/Trend split, per-finish listings, anchoring confidence guards — E2 MUST build on these amended rules, not the original E1-era text).

## Components

- `src/pricing/csv.ts` — PURE deterministic CSV rendering for the 5 files (4 pages + unmatched.csv). `cardCommand.ts` already has an inline CSV writer for the single-card path (`pricePageCsv`, ratio CSV, `# page N` separators) — PRICE-020 LIFTS that logic into this shared module rather than duplicating it; `cardCommand.ts` is refactored to call into `csv.ts`.
- `src/pricing/export.ts` (PRICE-021, not this task) — will consume `csv.ts` writers for the bulk `export` command.
- Existing engine (`compare.ts`, `cardmarket.ts`, `fx.ts`) is unchanged by this task — csv.ts takes already-computed rows/cells as input, no fetch/fs.

## Data models

- Input to price-page writer: `PriceRow[]` (already collapsed via `collapseDuplicates`) + provider currency — TCGplayer page has NM/SP-LP/MP/HP + Source columns; Cardmarket page additionally has Trend/Trend Source (per the §61 delta).
- Input to ratio-page writer: `ComparisonRow[]` (from `buildComparisonRows`) + `computeRatioCells` output per row + FX `{rate, date}` — Basis column per §8.4 (post-§61: only ever `listing/low` or empty).
- Input to unmatched writer: `UnmatchedRow[]` from `buildComparisonRows` (§7.3: reasons `no-counterpart` | `unmapped-expansion` | `no-price`).

## Interfaces / contracts

- `renderPricePageCsv(rows: PriceRow[], opts: { currency: 'USD'|'EUR'; trendColumn?: boolean }): string` — header + `# currency:` comment line; `trendColumn: true` for the Cardmarket page.
- `renderRatioPageCsv(rows: ComparisonRow[], ratios: Map<rowKey, Record<ConditionColumn, RatioCell|null>>, opts: { pairLabel: string; fx: FxRate }): string` — `# ratio:` + `# fx:` comment lines, Basis columns.
- `renderUnmatchedCsv(unmatched: UnmatchedRow[]): string`.
- Deterministic ordering (§9.3, restated per SPEC): set (tcgcsv group release order, newest first) → name A→Z → finish (normal before foil). `csv.ts` needs a release-order input for sets — PRICE-021 supplies it from tcgcsv groups; for PRICE-020's own tests/lifted single-card usage, ordering falls back to whatever deterministic tiebreak is available (document exactly what "release order" means when the command only has one card's rows — likely insertion order is fine there since sets aren't being globally ordered from one card).

## Key sequences

1. `csv.ts` is exercised two ways in this repo: (a) `export` (PRICE-021, future) writes actual files; (b) `card --csv` (already merged in PRICE-012/#61) currently has its OWN inline writer — this task's job is to make (a) and (b) share one implementation, proven by refactoring cardCommand.ts onto csv.ts with zero behavior change (snapshot-test cardCommand's existing CSV output before and after the refactor to guarantee no regression).

## Decisions

- Lift, don't duplicate: cardCommand.ts's existing CSV logic is the reference implementation (it's already been through 3 rounds of real-data-only fixes) — csv.ts generalizes it to file output + full-catalog ordering, not the other way around.
- csv.ts stays pure (string in, string out) — no `fs.writeFile` here; PRICE-021 owns file I/O.

## Out of scope for this epic

- The `export` command itself, batching, --set filter, degraded-403 handling (PRICE-021).
- README/CLAUDE.md (PRICE-022).
