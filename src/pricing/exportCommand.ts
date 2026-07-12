// `fab-cli price-comparison export` — bulk full-catalog orchestration. See
// SPEC-PRICE.md §9.2 (export command), §6.1-§6.4 (data acquisition incl. the
// #61-amended 403-degraded-mode rule), §7 (matching), §8 (condition/ratio
// engine), §9.3 (CSV format), §11 (non-functional), docs/design/price-E2.md.
//
// Pure orchestration, no fs — file writing is a thin wrapper owned by
// src/cli.ts. Every external client is injected via `ExportCommandDeps` so
// tests run fully mocked/offline (I3), matching cardCommand.ts's pattern.
//
// Composition mirrors cardCommand.ts at catalog scale: per-provider
// condition FILL runs before matching (ORDERING CONTRACT, compare.ts),
// real-data-only cells (no fabricated fill, issue #61), and per-finish
// listing queries (issue #61 follow-up) — this task reuses that engine
// wholesale rather than reimplementing it; see fetchSetConditionListings
// (tcgplayerSearch.ts) for the per-set batched counterpart of
// fetchProductConditions.
//
// 403-DEGRADED EXPORT MODE (§6.2/§6.4/§8.2, PRICE-021 amendment): a set
// whose tcgplayer listing fetch throws StorefrontBlockedError degrades to
// empty tcgplayer condition cells for every row in that set — never a
// marketPrice/lowPrice stand-in — and is recorded in the summary's
// `degradedSets`. The export backs off (>=60s, injectable via
// `deps.sleep`/`opts.backoffMs` so tests never actually wait) before
// touching the storefront search host again on the next set.

import type { Group, GroupData, TcgcsvOptions, TcgcsvPriceRow } from "./tcgcsv";
import {
  StorefrontBlockedError,
  type FinishConditionPriceMap,
  type TcgplayerSearchOptions,
} from "./tcgplayerSearch";
import type { CardmarketData, CardmarketOptions } from "./cardmarket";
import { resolvePrices } from "./cardmarket";
import { type FxOptions, type FxRate, isFxError } from "./fx";
import type { ExpansionAnchorMap } from "./expansionAnchoring";
import {
  buildComparisonRows,
  cardmarketSetName,
  collapseDuplicates,
  computeRatioCells,
  fillTcgplayerConditions,
  type ComparisonRow,
  type RatioCell,
} from "./compare";
import {
  renderPricePageCsv,
  renderRatioPageCsv,
  renderUnmatchedCsv,
} from "./csv";
import {
  CONDITION_COLUMNS,
  type ConditionCell,
  type ConditionColumn,
  type ConditionPrices,
  type Finish,
  type PriceRow,
} from "./types";

// ---------------------------------------------------------------------------
// Client dependencies (injectable — real implementations wired in cli.ts)
// ---------------------------------------------------------------------------

export interface ExportCommandDeps {
  fetchGroups(opts?: TcgcsvOptions): Promise<Group[]>;
  fetchGroupData(groupId: number, opts?: TcgcsvOptions): Promise<GroupData>;
  fetchSetConditionListings(
    setName: string,
    opts?: TcgplayerSearchOptions,
  ): Promise<Map<number, FinishConditionPriceMap>>;
  fetchCardmarketData(opts?: CardmarketOptions): Promise<CardmarketData>;
  fetchEurUsdRate(opts?: FxOptions): Promise<FxRate>;
  expansionAnchorMap: ExpansionAnchorMap;
  /** Injectable clock for the 403 backoff — defaults to a real setTimeout sleep. Lets tests skip the real wait. */
  sleep?(ms: number): Promise<void>;
}

export interface SetProgressInfo {
  index: number;
  total: number;
  groupName: string;
  productCount: number;
}

export interface RunExportOptions {
  /** Filters tcgcsv groups by case-insensitive substring match (§9.2). Default: full catalog. */
  sets?: string[];
  /** Common currency ratio pages convert to. Defaults to 'usd' (§9.2). */
  currency?: "usd" | "eur";
  refresh?: boolean;
  /** Backoff (ms) after a 403-blocked set before continuing (§6.4). Defaults to 60000. */
  backoffMs?: number;
  onSetProgress?(info: SetProgressInfo): void;
}

export interface ExportSummary {
  setsProcessed: number;
  rowsPerPage: { tcgplayer: number; cardmarket: number };
  /** matched ComparisonRow[] / (matched + unmatched entries), 0 when nothing was found. */
  matchRate: number;
  degradedSets: string[];
  elapsedMs: number;
}

export interface ExportResult {
  pricesTcgplayerCsv: string;
  pricesCardmarketCsv: string;
  /** Empty string when `ratioError` is set — FX failure aborts ratio generation only (§8.4). */
  ratioTcgplayerCardmarketCsv: string;
  ratioCardmarketTcgplayerCsv: string;
  unmatchedCsv: string;
  summary: ExportSummary;
  /** Set when the FX fetch failed — price pages/unmatched.csv are still produced (§8.4). */
  ratioError?: string;
}

// ---------------------------------------------------------------------------
// Set filtering + deterministic release-order comparator (§9.2, §9.3)
// ---------------------------------------------------------------------------

function matchesSetFilter(name: string, filters: string[]): boolean {
  const lower = name.toLowerCase();
  return filters.some((f) => lower.includes(f.toLowerCase()));
}

function filterGroups(groups: Group[], filters?: string[]): Group[] {
  if (!filters || filters.length === 0) return groups;
  return groups.filter((g) => matchesSetFilter(g.name, filters));
}

/** Newest-first by `publishedOn`; groups with no date sort last; ties broken by name (§9.3). */
function buildSetOrder(groups: Group[]): Map<string, number> {
  const sorted = [...groups].sort((a, b) => {
    const da = a.publishedOn
      ? Date.parse(a.publishedOn)
      : Number.NEGATIVE_INFINITY;
    const db = b.publishedOn
      ? Date.parse(b.publishedOn)
      : Number.NEGATIVE_INFINITY;
    if (da !== db) return db - da;
    return a.name.localeCompare(b.name);
  });
  const order = new Map<string, number>();
  sorted.forEach((g, i) => order.set(g.name.toLowerCase(), i));
  return order;
}

/** Known sets sort by release order; anything unknown (e.g. an unmapped `cm-expansion-<id>`) sorts after, alphabetically. */
function compareSetsByOrder(
  order: Map<string, number>,
): (a: string, b: string) => number {
  return (a, b) => {
    const ra = order.get(a.toLowerCase());
    const rb = order.get(b.toLowerCase());
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return a.localeCompare(b);
  };
}

// ---------------------------------------------------------------------------
// Per-set TCGplayer row assembly (mirrors cardCommand.ts's buildTcgplayerRows,
// but iterates a whole set's products instead of one card's matched entries)
// ---------------------------------------------------------------------------

function emptyFinishConditionPriceMap(): FinishConditionPriceMap {
  return {
    normal: { NM: null, "SP/LP": null, MP: null, HP: null },
    foil: { NM: null, "SP/LP": null, MP: null, HP: null },
  };
}

function buildTcgplayerRowsForSet(
  groupName: string,
  groupData: GroupData,
  finishListingsByProductId: Map<number, FinishConditionPriceMap>,
): PriceRow[] {
  const rows: PriceRow[] = [];

  for (const product of groupData.products) {
    const finishListings =
      finishListingsByProductId.get(product.productId) ??
      emptyFinishConditionPriceMap();
    const priceRows = groupData.pricesByProductId.get(product.productId) ?? [];
    const finishRows =
      priceRows.length > 0
        ? priceRows
        : [
            {
              productId: product.productId,
              subTypeName: "Normal",
            } as TcgcsvPriceRow,
          ];

    const seenFinishes = new Set<Finish>();
    for (const priceRow of finishRows) {
      // subTypeName is NOT a plain "Normal"/"Foil" literal — see
      // tcgcsv.ts's TcgcsvPriceRow doc comment; must be a substring check.
      const finish: Finish = priceRow.subTypeName.includes("Foil")
        ? "foil"
        : "normal";
      if (seenFinishes.has(finish)) continue;
      seenFinishes.add(finish);

      rows.push({
        name: product.name,
        set: groupName,
        finish,
        conditions: fillTcgplayerConditions({
          listings: finishListings[finish],
        }),
      });
    }

    // A foil variant with real live listings but no tcgcsv Foil price row
    // still gets a row — never silently dropped (mirrors cardCommand.ts).
    if (!seenFinishes.has("foil")) {
      const hasFoilListing = CONDITION_COLUMNS.some(
        (c) => finishListings.foil[c] != null,
      );
      if (hasFoilListing) {
        rows.push({
          name: product.name,
          set: groupName,
          finish: "foil",
          conditions: fillTcgplayerConditions({
            listings: finishListings.foil,
          }),
        });
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Cardmarket row assembly — global bulk data, filtered to sets in scope when
// `--set` narrows the run (mirrors cardCommand.ts's buildCardmarketRows, but
// over the whole catalog instead of one resolved card's matches)
// ---------------------------------------------------------------------------

interface ExportCardmarketRow extends PriceRow {
  trend: ConditionCell | null;
}

function conditionsFromLow(low: ConditionCell | null): ConditionPrices {
  return { NM: low, "SP/LP": low, MP: low, HP: low };
}

function buildCardmarketRowsForExport(
  data: CardmarketData,
  anchorMap: ExpansionAnchorMap,
  setFilters: string[] | undefined,
): ExportCardmarketRow[] {
  const rows: ExportCardmarketRow[] = [];

  for (const product of data.products) {
    const set = cardmarketSetName(product.idExpansion, anchorMap);
    // Only scope-filter when a --set filter is active (§9.2). A full-catalog
    // run must keep unmapped `cm-expansion-<id>` rows visible (§7.2) — they
    // never silently vanish.
    if (
      setFilters &&
      setFilters.length > 0 &&
      !matchesSetFilter(set, setFilters)
    ) {
      continue;
    }

    const guideRow = data.priceGuideByProduct.get(product.idProduct);
    const normal = guideRow
      ? resolvePrices(guideRow, "normal")
      : { conditions: null, trend: null };
    rows.push({
      name: product.name,
      set,
      finish: "normal",
      conditions: conditionsFromLow(normal.conditions),
      trend: normal.trend,
    });

    if (guideRow) {
      const foil = resolvePrices(guideRow, "foil");
      if (foil.conditions != null || foil.trend != null) {
        rows.push({
          name: product.name,
          set,
          finish: "foil",
          conditions: conditionsFromLow(foil.conditions),
          trend: foil.trend,
        });
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Ratio-cell map builder (per-page plumbing csv.ts expects — see its own
// doc comment: each command owns this, csv.ts only renders)
// ---------------------------------------------------------------------------

function buildRatioMap(
  rows: ComparisonRow[],
  providerAKey: string,
  providerBKey: string,
  currencyA: "USD" | "EUR",
  currencyB: "USD" | "EUR",
  fx: FxRate,
  common: "usd" | "eur",
): Map<ComparisonRow, Record<ConditionColumn, RatioCell | null>> {
  const map = new Map<
    ComparisonRow,
    Record<ConditionColumn, RatioCell | null>
  >();
  for (const row of rows) {
    const a = row.conditionsByProvider[providerAKey];
    const b = row.conditionsByProvider[providerBKey];
    map.set(row, computeRatioCells(a, b, { fx, currencyA, currencyB, common }));
  }
  return map;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Full orchestration (§9.2)
// ---------------------------------------------------------------------------

export async function runExport(
  deps: ExportCommandDeps,
  opts: RunExportOptions = {},
): Promise<ExportResult> {
  const start = Date.now();
  const sleep = deps.sleep ?? defaultSleep;
  const backoffMs = opts.backoffMs ?? 60_000;
  const currency = opts.currency ?? "usd";

  const allGroups = await deps.fetchGroups({ refresh: opts.refresh });
  const groups = filterGroups(allGroups, opts.sets);

  const tcgplayerRows: PriceRow[] = [];
  const degradedSets: string[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupData = await deps.fetchGroupData(group.groupId, {
      refresh: opts.refresh,
    });

    let finishListingsByProductId: Map<number, FinishConditionPriceMap>;
    try {
      finishListingsByProductId = await deps.fetchSetConditionListings(
        group.name,
      );
    } catch (e) {
      if (e instanceof StorefrontBlockedError) {
        degradedSets.push(group.name);
        await sleep(backoffMs);
        finishListingsByProductId = new Map();
      } else {
        throw e;
      }
    }

    tcgplayerRows.push(
      ...buildTcgplayerRowsForSet(
        group.name,
        groupData,
        finishListingsByProductId,
      ),
    );

    opts.onSetProgress?.({
      index: i + 1,
      total: groups.length,
      groupName: group.name,
      productCount: groupData.products.length,
    });
  }

  const cardmarketData = await deps.fetchCardmarketData({
    refresh: opts.refresh,
  });
  const cardmarketRows = buildCardmarketRowsForExport(
    cardmarketData,
    deps.expansionAnchorMap,
    opts.sets,
  );

  const { rows: comparisonRows, unmatched } = buildComparisonRows({
    tcgplayer: tcgplayerRows,
    cardmarket: cardmarketRows,
  });

  const compareSets = compareSetsByOrder(buildSetOrder(allGroups));
  const collapsedTcgplayer = collapseDuplicates(tcgplayerRows);
  const collapsedCardmarket = collapseDuplicates(cardmarketRows);

  const pricesTcgplayerCsv = renderPricePageCsv(collapsedTcgplayer, {
    currency: "USD",
    compareSets,
  });
  const pricesCardmarketCsv = renderPricePageCsv(collapsedCardmarket, {
    currency: "EUR",
    trendColumn: true,
    compareSets,
  });
  const unmatchedCsv = renderUnmatchedCsv(unmatched);

  let ratioTcgplayerCardmarketCsv = "";
  let ratioCardmarketTcgplayerCsv = "";
  let ratioError: string | undefined;
  try {
    const fx = await deps.fetchEurUsdRate({ refresh: opts.refresh });
    ratioTcgplayerCardmarketCsv = renderRatioPageCsv(
      comparisonRows,
      buildRatioMap(
        comparisonRows,
        "tcgplayer",
        "cardmarket",
        "USD",
        "EUR",
        fx,
        currency,
      ),
      { pairLabel: "tcgplayer / cardmarket", fx, compareSets },
    );
    ratioCardmarketTcgplayerCsv = renderRatioPageCsv(
      comparisonRows,
      buildRatioMap(
        comparisonRows,
        "cardmarket",
        "tcgplayer",
        "EUR",
        "USD",
        fx,
        currency,
      ),
      { pairLabel: "cardmarket / tcgplayer", fx, compareSets },
    );
  } catch (e) {
    if (isFxError(e)) {
      ratioError = `Could not fetch the EUR/USD FX rate (${e.message}) — ratio pages skipped.`;
    } else {
      throw e;
    }
  }

  return {
    pricesTcgplayerCsv,
    pricesCardmarketCsv,
    ratioTcgplayerCardmarketCsv,
    ratioCardmarketTcgplayerCsv,
    unmatchedCsv,
    ratioError,
    summary: {
      setsProcessed: groups.length,
      rowsPerPage: {
        tcgplayer: collapsedTcgplayer.length,
        cardmarket: collapsedCardmarket.length,
      },
      matchRate:
        comparisonRows.length + unmatched.length === 0
          ? 0
          : comparisonRows.length / (comparisonRows.length + unmatched.length),
      degradedSets,
      elapsedMs: Date.now() - start,
    },
  };
}
