# fab-cli price-comparison backlog — spec: SPEC-PRICE.md (prefix PRICE)

Ranges: E0=001–009 (foundations), E1=010–019 (engine + card command), E2=020–029 (export + CSV), infra=090–099.
Build order: E0 → E1 → E2 (guarded). Priority P0 > P1 > P2. Points ≈ complexity incl. testing.
DoD for every task: `npm run gate` green (offline — SPEC-PRICE §10 I3), README/CLAUDE.md updated if the command surface changed, cited §s satisfied.

## E0 — Foundations: providers & clients (001–009) — no guard

### PRICE-001 · Pricing types, provider interface, disk cache · P0 · 3pt · §5 §6.1 §11
`src/pricing/types.ts` (`PriceProvider`, `PriceRow`, `ConditionPrices`, source-label union) + `src/pricing/cache.ts` (JSON disk cache under `~/.config/fabrary-search/cache/pricing/`, 24h TTL, refresh bypass, safe-to-delete).
**AC:** cache returns fresh data within TTL without hitting the fetcher; `refresh: true` re-fetches and rewrites; corrupted cache files self-heal (re-fetch); unit tests offline.

### PRICE-002 · tcgcsv client (groups / products / prices) · P0 · 3pt · §6.1 §6.4
Fetch + cache category-62 groups, per-group products and prices; typed rows incl. `subTypeName`; 0-price-row groups flagged. Fixtures captured into `test/fixtures/pricing/tcgcsv/`.
**AC:** fixture tests cover groups list, product+price join by productId, Normal vs Foil rows, empty-prices group flag; concurrency ≤4 with backoff on 429/5xx.

### PRICE-003 · TCGplayer storefront search client (per-condition listings) · P0 · 5pt · §6.2 §6.4 §10 I2 I6
`POST mp-search-api.tcgplayer.com/v1/search/request` with browser headers; query by card name or by (set, condition) batched with pagination; extract lowest listing per (product, printing, condition); 403 → host backoff ≥60s + degraded-mode signal.
**AC:** fixture tests for single-card and set-batch queries, all four conditions, empty-condition case, pagination, and the 403 degradation path; never calls `/v1/product/{id}/listings`.

### PRICE-004 · Cardmarket client (price guide + product catalog) · P0 · 3pt · §6.3 §8.3
Download + cache `price_guide_16.json` and `products_singles_16.json`; join by idProduct; expose per-product `{trend, low, avg30, avg7, avg1}` plain + foil.
**AC:** fixture tests for join, foil-field selection, null-cascade (`trend→avg30→avg7→avg1→low`), missing-product handling.

### PRICE-005 · Expansion anchoring script + committed map · P1 · 5pt · §7.2
`scripts/cardmarket-expansions.ts`: unique-card-name voting from tcgcsv sets × CM `idExpansion`, majority resolution, `overrides` section wins; writes `data/cardmarket-expansions.json` (committed). Run it once for real and commit the result.
**AC:** unit tests on synthetic catalogs (voting, majority, override precedence, unmapped expansion left absent); real generated map committed with vote counts; unmapped expansions surface as `cm-expansion-<id>`.

### PRICE-006 · FX client (frankfurter.dev) · P1 · 2pt · §8.4
EUR↔USD ECB reference rate, cached 24h, returns `{rate, date}`; failure is a typed error the caller can turn into "abort ratio pages".
**AC:** fixture test for rate parse + cache; failure path returns typed error, no throw-through.

## E1 — Comparison engine + card command (010–019) — blocked by E0 (Deployed)

### PRICE-010 · Matching engine: normalization + row join + unmatched reasons · P0 · 5pt · §4.2 §7.1 §7.2 §7.3 §10 I7
Pure `compare.ts` part 1: name normalization (case/apostrophe/diacritic-insensitive, pitch-suffix preserving), finish collapse (printing contains "Foil" → foil; cheapest-wins within identity), set mapping via `data/cardmarket-expansions.json`, join to comparison rows + unmatched list with reasons (`no-counterpart`, `unmapped-expansion`, `no-price`).
**AC:** unit tests for normalization edge cases (apostrophes, pitch suffixes, diacritics), 1st/Unlimited collapse, foil split, unmapped-expansion rows kept + reported.

### PRICE-011 · Condition fill + adjacency fallback + ratio math · P0 · 5pt · §8.1 §8.2 §8.3 §8.4 §10 I4 I5
Pure `compare.ts` part 2: per-provider condition cell fill with source labels (`listing`, `market`, `trend`, `low`, `adjacent:<COL>`), nearest-neighbor fallback (ties prefer better condition), Cardmarket NM=trend / rest=low rule, FX conversion, ratio cells + basis labels, empty-cell propagation.
**AC:** unit tests enumerate all gap patterns (single missing, runs, all-missing, market-only), tie-break direction, CM null-cascade, ratio ± rendering (`+30.0%`), empty propagation, never-unlabeled-fallback (I4).

### PRICE-012 · `price-comparison card <name>` command · P0 · 5pt · §9.1 §2 G1
Wire namespace into `src/cli.ts`; resolve name via tcgcsv catalog (ambiguity → list + exit 1); live per-condition listings for the card's printings; cli-table3 pages with chalk-bold fallbacks + footnote; `--csv`, `--refresh`, `--currency`.
**AC:** command tests with mocked clients cover: happy path (all 4 pages rendered), ambiguous name exit 1, bold+footnote only when fallback sources present, `--csv` emits §9.3 layout with `# page N` separators; README/CLAUDE.md updated.

## E2 — Export + CSV pages (020–029) — blocked by E1 (Deployed)

### PRICE-020 · CSV writers: price pages, ratio pages, unmatched.csv · P0 · 3pt · §9.3 §7.3 §10 I4 I5 I7
Pure `csv.ts`: headers with Source/Basis companion columns, `# currency` / `# ratio` / `# fx` comment lines, deterministic ordering (set release-order desc, name A→Z, normal before foil).
**AC:** snapshot tests for all five files; byte-identical output on repeated render of same input; empty cells render empty (not 0).

### PRICE-021 · `price-comparison export` command · P0 · 5pt · §9.2 §6.2 §6.4 §11 §2 G2
Full-catalog + `--set` filter; per-(set, condition) batched listing fetch with pagination; per-set progress lines; degraded-mode (403) continues with `market` source + summary note; final summary (rows per page, match rate, degraded sets, elapsed); `--out`, `--refresh`, `--currency`; exit codes per §9.2.
**AC:** command tests with mocked clients: full flow writes 5 files, `--set` filters, degraded path produces market-sourced cells + summary note, FX failure aborts ratio pages with exit 1 while price pages exist.

### PRICE-022 · Docs + live smoke checklist · P1 · 2pt · §9 §12
README + CLAUDE.md sections (commands, user-pattern table rows, data-source notes incl. official-API-closed rationale); manual live smoke checklist (`card` for a multi-printing card, `--set` export) documented in docs/DEV.md.
**AC:** docs updated; smoke checklist executed once and results noted in the PR.

## Infra reserve (090–099)

(unassigned — headroom for discovered work)
