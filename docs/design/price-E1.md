# Design — price/E1: Comparison engine + card command

Grounded in: SPEC-PRICE §4.1, §4.2, §5, §7, §8, §9.1.

## Components

- `src/pricing/compare.ts` — PURE comparison engine (no fetch/fs): row matching (PRICE-010) + condition fill/fallback/ratio math (PRICE-011). Two logical halves, one module.
- `src/pricing/expansionAnchoring.ts` — already ships `normalizeCardName` (§7.1) and `resolveExpansionName`; compare.ts REUSES both, never re-implements.
- `src/cli.ts` — gains the `price-comparison` namespace with the `card` subcommand (PRICE-012); wiring only, all logic in pricing modules.
- Providers already deployed: `tcgcsv.ts` (catalog + market prices), `tcgplayerSearch.ts` (per-condition lowest listings), `cardmarket.ts` (price guide + `resolvePrices`), `fx.ts` (FxRate), `data/cardmarket-expansions.json` (set-name map).

## Data models

- `ComparisonRow`: `RowIdentity` (name, set, finish — from types.ts) + per-provider `ConditionPrices` keyed by provider id (`{ tcgplayer: ConditionPrices, cardmarket: ConditionPrices }` generalized as `Record<string, ConditionPrices>`).
- `UnmatchedRow`: `{ provider: string, name, set, finish, reason: 'no-counterpart' | 'unmapped-expansion' | 'no-price' }` (§7.3).
- `RatioCell`: `{ pct: number, basis: string }` where basis = `<sourceA>/<sourceB>` (§8.4); rendered `+30.0%`.
- Match key: `normalizeCardName(name) + '|' + normalizedSet + '|' + finish`. Unmapped CM expansions use set `cm-expansion-<idExpansion>` (they can never match, land in unmatched with `unmapped-expansion`).

## Interfaces / contracts

- PRICE-010 exports (names indicative): `buildComparisonRows(providerRows: Map<providerId, PriceRow[]>) → { rows: ComparisonRow[], unmatched: UnmatchedRow[] }`; collapse duplicates within one provider by identity, cheapest per condition wins (§4.2).
- PRICE-011 exports: `fillConditions(raw per-condition inputs) → ConditionPrices` with adjacency fallback (§8.2: nearest column, tie → better condition, source `adjacent:<COL>`), and `ratioCells(a: ConditionPrices, b: ConditionPrices, fx, currency) → Record<ConditionColumn, RatioCell | null>` (§8.4: convert to common currency first, empty propagates, basis labels).
- PRICE-012 command: `fab-cli price-comparison card <name>` — resolve via tcgcsv catalog (ambiguous → list + exit 1), live per-condition listings per printing, cli-table3 pages, chalk bold + footnote for fallback sources, flags `--csv [file]`, `--refresh`, `--currency usd|eur` (§9.1).

## Key sequences

1. `card <name>`: tcgcsv catalog (cached) → find matching products/groups → tcgplayerSearch per-condition (live) + cardmarket resolvePrices (cached) → buildComparisonRows → fillConditions per provider → 2 price tables + FX fetch → 2 ratio tables. FX failure: price tables still print, ratio tables abort with clear error (§8.4, I5-safe).
2. Engine stays pure: command assembles inputs, engine transforms, display renders.

## Decisions

- Both PRICE-010 and PRICE-011 live in `compare.ts` — the spec's §5 module list names it; splitting further adds import churn for no isolation gain.
- Reuse `normalizeCardName` from expansionAnchoring.ts as-is for §7.1 — one normalization for anchoring AND matching (reviewer note from PR #54: a future `normalization.ts` extraction is optional polish, not required).
- TCGplayer set names for matching = tcgcsv group names verbatim (canonical per §4.2); CM set names via resolveExpansionName else `cm-expansion-<id>`.
- Adjacency tie-break: distance in column order; equidistant → the better (closer-to-NM) column (§8.2).
- `card` command exit codes: 0 success, 1 ambiguous-name / FX-abort with ratio tables requested / no such card.

## Out of scope for this epic

- CSV file writing (PRICE-020, E2) — `--csv` in PRICE-012 may emit to stdout using a minimal inline formatter ONLY if PRICE-020 hasn't landed; prefer deferring `--csv` polish to E2 if it risks scope creep (state it in the PR).
- Export command, batching, degraded-403 flow (PRICE-021).
- README/CLAUDE.md documentation (PRICE-022).
