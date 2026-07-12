# fab-cli — Marketplace Price Comparison Spec

## §1 Overview

fab-cli gains a `price-comparison` namespace that compares Flesh & Blood single-card prices across marketplaces — TCGplayer (USD) and Cardmarket (EUR) in v1 — per card condition (NM, SP/LP, MP, HP). Two commands: `card <name>` for a single card (terminal tables, optional CSV) and `export` for the full catalog (4 CSV files: one price page per marketplace plus a ratio page per ordered marketplace pair). The user's goal is arbitrage/valuation: seeing where a card is cheaper and by how much, in comparable currency terms.

All data access is **keyless**: the official TCGplayer API is closed to new applicants ("We are no longer granting new API access at this time"), so v1 uses the tcgcsv.com daily mirror plus TCGplayer's own storefront search endpoint, and Cardmarket's public S3 catalog downloads. There is no `auth` command in this namespace.

## §2 Goals

- G1: `fab-cli price-comparison card <name>` shows, for each printing (set + normal/foil) of the card, the lowest real price per condition on each marketplace and cross-marketplace ratio tables, in under ~15 s for a typical card.
- G2: `fab-cli price-comparison export` produces 4 deterministic CSV files covering the full FAB singles catalog (or `--set` subset), with per-condition prices, source labels for every cell, and FX-converted ratio pages.
- G3: Cross-marketplace row matching (name + set + foil) achieves high coverage, and every unmatched row is reported rather than silently dropped.
- G4: Adding a third marketplace later requires implementing one provider interface and no changes to the comparison/CSV engine (pages and ratio pairs are generated combinatorially from the registered providers).

## §3 Non-goals

- **Official TCGplayer API / `tcgplayer auth`** — access is closed; no key storage, no token flow. If LSS/TCGplayer ever reopens access this becomes a new provider implementation, not part of v1.
- **Other marketplaces** (CardTrader, eBay, TrollAndToad, …) — out of scope for v1; the provider interface must allow them (§5), but no tasks build them.
- **Cardmarket page scraping** — product pages are Cloudflare-protected; never attempt to scrape them.
- **Sealed product, non-English printings** — singles, English only.
- **Price history, alerts, portfolio tracking** — snapshot comparison only.
- **XLSX output** — CSV only in v1.
- **Shipping-inclusive pricing** — item price only; shipping varies by seller/destination and is excluded everywhere.

## §4 Domain: conditions, row identity, pages

### §4.1 Condition scales and mapping

Output uses four condition columns, always in this order: **NM, SP/LP, MP, HP**.

| Column | TCGplayer condition | Cardmarket condition |
|--------|--------------------|----------------------|
| NM     | Near Mint          | Mint, Near Mint      |
| SP/LP  | Lightly Played     | Excellent            |
| MP     | Moderately Played  | Good, Light Played   |
| HP     | Heavily Played     | Played               |
| (dropped) | Damaged         | Poor                 |

- THE SYSTEM SHALL map marketplace conditions to output columns exactly per this table; Damaged and Poor prices SHALL never appear in any output.
- Note: Cardmarket's published price guide is not condition-segmented at all (§6.3), so the Cardmarket mapping applies only if a per-condition source ever becomes available; v1 fills Cardmarket columns per §8.3.

### §4.2 Row identity and matching

- A **row** is identified by `(canonical card name, canonical set name, finish)` where finish ∈ {normal, foil}.
- WHEN multiple marketplace printings collapse to the same row identity (e.g. TCGplayer "1st Edition Normal" and "Unlimited Edition Normal", or several rainbow/cold foil printings) THE SYSTEM SHALL use the cheapest price per condition among them (finish mapping: any printing whose name contains "Foil" → foil, else normal).
- Canonical card names preserve pitch suffixes like "(Blue)"/"(Red)"/"(Yellow)" — both marketplaces use this convention; normalization is case-insensitive, apostrophe/diacritic-insensitive, whitespace-collapsed.
- Set matching uses canonical set names: TCGplayer group names (tcgcsv) are canonical; Cardmarket `idExpansion` values are mapped to canonical names via `data/cardmarket-expansions.json` (§7.2).

### §4.3 Pages

For registered providers P1…Pn (v1: tcgplayer, cardmarket):

- One **price page** per provider: columns `Name, Set, Finish, NM, NM Source, SP/LP, SP/LP Source, MP, MP Source, HP, HP Source`, prices in the provider's native currency.
- One **ratio page** per ordered pair (Pi, Pj), i≠j (v1: tcgplayer/cardmarket and cardmarket/tcgplayer): same identity columns; each condition cell is `Pi_price / Pj_price − 1` expressed as a signed percentage (e.g. `+30.0%`), computed **after converting both prices to a common currency** (§8.4). Ratio pages contain only rows that have a price for that condition on **both** providers.

## §5 Architecture

New modules (self-contained; `src/cli.ts` only gains command wiring — compatible with the pending FAB-010 decomposition):

```
src/pricing/types.ts        — PriceProvider interface, PriceRow, ConditionPrices, source labels
src/pricing/cache.ts        — disk cache for bulk downloads (~/.config/fabrary-search/cache/, 24h TTL, --refresh bypass)
src/pricing/tcgplayer.ts    — provider: tcgcsv catalog/prices + storefront search per-condition listings
src/pricing/cardmarket.ts   — provider: S3 price guide + product catalog downloads
src/pricing/fx.ts           — daily FX rates via frankfurter.dev (ECB)
src/pricing/compare.ts      — PURE: name/set normalization, row matching, condition fill + adjacency fallback, ratio math
src/pricing/csv.ts          — PURE: deterministic CSV rendering for price + ratio pages
scripts/cardmarket-expansions.ts — anchoring generator for data/cardmarket-expansions.json (§7.2)
data/cardmarket-expansions.json  — committed idExpansion → canonical set name map (+ manual overrides)
```

- **Provider interface**: a provider exposes `id`, `currency`, `displayName`, and `fetchRows(scope) → PriceRow[]` where each `PriceRow` carries the row identity plus per-condition `{ price, source } | null`. `compare.ts` and `csv.ts` operate only on `PriceRow[]` — adding a marketplace means adding one provider module and registering it (G4).
- **Why these sources**: tcgcsv gives the whole TCGplayer catalog + market prices in ~101 cheap JSON fetches; the storefront search endpoint is the only keyless source of per-condition listing prices; Cardmarket's S3 files are the only non-Cloudflare Cardmarket source.
- Pure engine modules (`compare.ts`, `csv.ts`) take data in, return data/strings out — no fetch, no fs — so the merge gate tests them fully offline (§12).

## §6 Data acquisition

### §6.1 tcgcsv.com (TCGplayer catalog + market prices)

- Base: `https://tcgcsv.com/tcgplayer/62` (category 62 = Flesh & Blood TCG). Endpoints: `/groups`, `/{groupId}/products`, `/{groupId}/prices`.
- Price rows: `{ productId, lowPrice, midPrice, highPrice, marketPrice, directLowPrice, subTypeName: "Normal"|"Foil" }`.
- THE SYSTEM SHALL cache each tcgcsv response on disk for 24 h (tcgcsv updates daily); `--refresh` SHALL bypass and rewrite the cache.
- IF a group returns 0 price rows (observed for just-released sets) THEN THE SYSTEM SHALL still include its products, with condition cells filled only from live listings (§8.2), and SHALL note the group in the export summary.

### §6.2 TCGplayer storefront search (per-condition live listings)

- `POST https://mp-search-api.tcgplayer.com/v1/search/request` with browser-like headers (User-Agent, Origin/Referer `https://www.tcgplayer.com`). Body filters: `productLineName: ["flesh-and-blood-tcg"]`, optional `setName`, and `listingSearch.filters.term` with `condition: [<one condition>]`, `sellerStatus: "Live"`, `quantity ≥ 1`; sort price-ascending. Each returned product embeds its cheapest matching listings → lowest listing per (product, condition).
- Export batching: WHEN exporting THE SYSTEM SHALL query per (set, condition) with page size ≈50 and paginate, rather than per product (≈4 requests per set page for the 4 conditions).
- THE SYSTEM SHALL NOT call `mp-search-api.tcgplayer.com/v1/product/{id}/listings` (returns 403 outside a browser session).
- Listing price used is the item price (`price`), excluding shipping (§3).

### §6.3 Cardmarket S3 downloads

- Price guide: `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_16.json` — per `idProduct`: `avg, low, trend, avg1, avg7, avg30` and `-foil` variants. **No per-condition segmentation.**
- Product catalog: `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_16.json` — `idProduct → { name, idExpansion, idMetacard }`.
- Both cached 24 h (files are ~3 MB each and regenerated daily upstream); `--refresh` bypasses.

### §6.4 Rate limiting and politeness

- THE SYSTEM SHALL keep concurrency ≤4 against any single external host, with exponential backoff + retry (≤3 attempts) on 429/5xx.
- IF the storefront search endpoint returns 403 THEN THE SYSTEM SHALL back off (≥60 s before retrying the host) and, WHILE the host stays unavailable, continue the export using market-price fallback (§8.2) with the appropriate source label, reporting the degradation in the summary.

## §7 Matching & set mapping

### §7.1 Name normalization

- THE SYSTEM SHALL normalize card names for matching by: lowercasing, removing apostrophes/diacritics/punctuation except parentheses, collapsing whitespace, and preserving parenthesized pitch suffixes.
- WHEN a normalized (name, set, finish) exists on both providers THE SYSTEM SHALL join them into one comparison row.

### §7.2 Cardmarket expansion mapping (anchoring)

Cardmarket publishes no expansion-name catalog (the S3 expansion list is Access-Denied). The mapping is derived by **anchoring**:

- `scripts/cardmarket-expansions.ts` SHALL: for every card name that exists in exactly one TCGplayer set and whose Cardmarket products all share one `idExpansion`, record a vote `idExpansion → tcgcsv group name`; assign each `idExpansion` the majority-vote name; write `data/cardmarket-expansions.json` with per-expansion vote counts and a separate `overrides` section that always wins.
- The generated file is **committed**; regeneration is manual (run the script when new sets release). IF an `idExpansion` has no mapping THEN its rows SHALL appear on the Cardmarket price page with set `cm-expansion-<id>` and SHALL be listed in the unmatched report; they never silently vanish.

### §7.3 Unmatched report

- WHEN `export` finishes THE SYSTEM SHALL write `unmatched.csv` in the output directory listing every row present on exactly one provider (columns: `Provider, Name, Set, Finish, Reason` where Reason ∈ `no-counterpart`, `unmapped-expansion`, `no-price`), and print match-rate summary counts (matched rows, unmatched per provider).

## §8 Condition price engine

### §8.1 General rule

Each condition cell is `{ price, source }`; `source` states exactly where the number came from. Source labels: `listing` (real lowest listing for that condition), `adjacent:<COL>` (copied from another condition column), `market` (TCGplayer marketPrice), `trend` / `low` (Cardmarket price-guide fields).

### §8.2 TCGplayer

- WHEN at least one live listing exists for (row, condition) THE SYSTEM SHALL use the lowest listing price with source `listing`.
- IF a condition has no listings THEN THE SYSTEM SHALL copy the nearest available condition column's price (distance in column order NM–SP/LP–MP–HP; on equidistant ties prefer the better condition, i.e. the one closer to NM) with source `adjacent:<COL>`.
- IF no condition has any listing THEN THE SYSTEM SHALL fill NM from tcgcsv `marketPrice` (falling back to `lowPrice` if marketPrice is null) with source `market`, then apply the adjacency rule to the remaining columns.
- IF neither listings nor tcgcsv prices exist THEN all four cells SHALL be empty and the row SHALL appear in `unmatched.csv` with reason `no-price`.

### §8.3 Cardmarket

No per-condition source exists (§6.3), so deterministically:

- NM = `trend` (or `trend-foil` for foil rows), source `trend`; IF trend is null/0 THEN fall back to `avg30`→`avg7`→`avg1`→`low` in that order, keeping the field name as source.
- SP/LP, MP, HP = `low` (or `low-foil`), source `low` — always flagged as fallback since `low` is the cheapest listing of *any* condition.
- IF every field is null THEN all cells empty, reason `no-price`.

### §8.4 Ratio math

- THE SYSTEM SHALL fetch the ECB reference rate for the export date from `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD` (cached 24 h) and convert Cardmarket EUR prices to USD before computing ratios.
- Ratio cell for pair (A, B), condition C: `priceA_usd / priceB_usd − 1`, rendered as a signed percentage with one decimal (`+30.0%`, `-12.5%`).
- IF either side's cell is empty for that condition THEN the ratio cell SHALL be empty (fallback-sourced cells DO participate, and the ratio page carries their source via companion `<COL> Basis` columns of the form `listing/trend`, `adjacent:MP/low`).
- WHEN the FX request fails THE SYSTEM SHALL abort ratio-page generation with a clear error (price pages still produced) rather than emit unconverted ratios.

## §9 Commands & output

### §9.1 `fab-cli price-comparison card <name>`

- Resolves `<name>` against the tcgcsv catalog (case-insensitive substring; if multiple distinct card names match, list them and exit 1; exact match wins outright).
- Fetches per-condition listings live for every printing row of the card (per-product queries are fine at this scale), Cardmarket data from cache/downloads, then prints one cli-table3 table per page (provider pages in native currency, ratio pages per §8.4) with the FX rate + date line above the ratio tables.
- Fallback-sourced prices render **bold** (chalk) with a footnote below each table: `bold = price not found for this condition; taken from <sources actually used>`.
- Flags: `--csv [file]` (emit the 4-page CSV format instead — to stdout or file… identical layout to §9.3 with a `# page N — <title>` comment line before each table), `--refresh`, `--currency usd|eur` (common currency for ratio pages, default usd).

### §9.2 `fab-cli price-comparison export`

- Flags: `--out <dir>` (default `./price-comparison/`), `--set <name...>` (repeatable, matches tcgcsv group names case-insensitively; default full catalog), `--refresh`, `--currency usd|eur`.
- Prints per-set progress (`[12/101] Everfest — 413 products`) and a final summary (rows per page, match rate, degraded sets, elapsed time).
- Exit code 0 on success (even with unmatched rows), 1 on abort (FX failure, sustained upstream failure).

### §9.3 CSV format

- Files: `prices-tcgplayer.csv`, `prices-cardmarket.csv`, `ratio-tcgplayer-cardmarket.csv`, `ratio-cardmarket-tcgplayer.csv`, `unmatched.csv`.
- Price page header: `Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source`. Prices are plain decimals (no currency symbol); the currency is stated in a leading comment line `# currency: USD` .
- Ratio page header: `Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis`, preceded by comment lines `# ratio: tcgplayer / cardmarket` and `# fx: 1 EUR = <rate> USD (ECB <date>)`.
- THE SYSTEM SHALL order rows deterministically: set (tcgcsv group release order, newest first), then name A→Z, then finish (normal before foil). Two exports from identical cached data SHALL be byte-identical.

## §10 Invariants

- I1: Marketplace access is keyless — never require, store, or ship TCGplayer/Cardmarket API credentials; no `auth` command exists in the price-comparison namespace.
- I2: Keep concurrency ≤4 per external host with retry/backoff; a 403 from mp-search-api is rate-limiting/bot protection — degrade to market-price fallback, never hammer or retry-storm.
- I3: All merge-gating tests run with the network disabled; live HTTP happens only behind explicit user commands.
- I4: Every price cell that is not an exact per-condition value carries a source label saying where it came from (`adjacent:<COL>`, `market`, `trend`, `low`); no unlabeled fallback number ever reaches output.
- I5: Ratio cells are computed only from prices converted to one common currency with a dated ECB rate recorded in the output; never divide raw USD by raw EUR.
- I6: Never scrape Cloudflare-protected Cardmarket pages or spoof authenticated browser sessions; only public keyless endpoints.
- I7: Unmatched or unpriced rows are reported (unmatched.csv / summary), never silently dropped.

## §11 Non-functional

- Full-catalog export completes in under ~30 min on a residential connection (≈101 sets × ~4 listing requests per set page + cached bulk files).
- `card` completes in under ~15 s for a card with ≤6 printings.
- Deterministic output (§9.3) so exports diff cleanly run-over-run.
- Bulk caches live under `~/.config/fabrary-search/cache/pricing/` and are safe to delete at any time.

## §12 Testing strategy

- **Pure engine** (`compare.ts`, `csv.ts`): unit tests for condition mapping, adjacency fallback (all gap patterns incl. all-empty), name/set normalization, ratio math incl. FX conversion and empty-cell propagation, CSV determinism (snapshot).
- **Clients** (`tcgplayer.ts`, `cardmarket.ts`, `fx.ts`, `cache.ts`): fixture-based tests using the existing HTTP-mock harness (`test/fixtures/pricing/` with captured tcgcsv/search/S3/frankfurter responses); cache TTL + `--refresh` behavior; 403-degradation path.
- **Anchoring script**: unit test on synthetic catalogs (unique-name voting, majority resolution, override precedence).
- All of the above are merge-gating and offline (I3). Live smoke (`card` against real endpoints) is manual/advisory only.

## §13 Open questions

| # | Question | Owner | Default if unanswered |
|---|----------|-------|----------------------|
| Q1 | Should TCGplayer 1st Edition vs Unlimited be separate rows instead of cheapest-wins collapse (§4.2)? | user | Collapse, cheapest per condition wins |
| Q2 | Should `card` also match Cardmarket-only cards (no TCGplayer printing)? | user | No — card resolution is via tcgcsv catalog; CM-only rows only appear in export unmatched report |
| Q3 | Listing price vs price+shipping for "lowest" (§3 excludes shipping)? | user | Item price only |
| Q4 | Should export cache per-set listing responses for resume after abort? | dev | No resume in v1; per-set progress makes re-runs cheap for `--set` subsets |
