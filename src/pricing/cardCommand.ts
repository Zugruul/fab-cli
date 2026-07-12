// `fab-cli price-comparison card <name>` — SPEC-PRICE.md §9.1, §4.3, §8.4,
// §2 G1, docs/design/price-E1.md. Command logic + rendering, structured for
// testability: every external client is injected via `CardCommandDeps` so
// tests run fully mocked/offline (I3). CLI wiring (src/cli.ts) supplies the
// real clients — including the tcgcsv User-Agent fetchFn, per the tcgcsv-
// requires-user-agent lesson (tcgcsv.ts itself does not default one).
//
// ORDERING CONTRACT (PR #56/#57, restated in compare.ts): per-provider
// condition FILL (fillTcgplayerConditions / resolvePrices) runs BEFORE
// buildComparisonRows. assembleCardComparison below fills both providers'
// rows first, then matches — never the other way around.
//
// REAL-DATA-ONLY (issue #61, spec delta PRICE-061): no fabricated fill, no
// bold/footnote fallback marker anywhere — a cell is either a real price or
// empty ('—'). The Cardmarket price page additionally carries a reference-
// only Trend column (never used in ratio cells).
//
// PER-FINISH LISTING QUERIES (issue #61 follow-up): fetchProductConditions
// now returns listings split by finish (normal/foil) — querying without a
// finish filter let a cheaper finish's listings crowd out the other's
// within the search API's per-product listing cap, both fabricating
// cross-finish prices and silently dropping foil rows entirely. See
// tcgplayerSearch.ts's NORMAL_PRINTINGS/FOIL_PRINTINGS doc comment.

import chalk from "chalk";
import Table from "cli-table3";

import {
  mapWithConcurrency,
  type Group,
  type Product,
  type TcgcsvOptions,
  type TcgcsvPriceRow,
} from "./tcgcsv";
import type {
  FinishConditionPriceMap,
  TcgplayerSearchOptions,
} from "./tcgplayerSearch";
import type { CardmarketData, CardmarketOptions } from "./cardmarket";
import { resolvePrices } from "./cardmarket";
import { type FxOptions, type FxRate, isFxError } from "./fx";
import { normalizeCardName } from "./expansionAnchoring";
import type { ExpansionAnchorMap } from "./expansionAnchoring";
import {
  buildComparisonRows,
  cardmarketSetName,
  collapseDuplicates,
  computeRatioCells,
  fillTcgplayerConditions,
  formatRatioPct,
  type ComparisonRow,
  type RatioCell,
  type UnmatchedRow,
} from "./compare";
import { renderPricePageCsv, renderRatioPageCsv } from "./csv";
import { lookupCardCode } from "./cardCode";
import {
  CONDITION_COLUMNS,
  type ConditionCell,
  type ConditionColumn,
  type Finish,
  type PriceRow,
} from "./types";

// ---------------------------------------------------------------------------
// Name resolution against the tcgcsv catalog (§9.1)
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  productId: number;
  name: string;
  groupId: number;
  groupName: string;
}

export type MatchResult =
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "found"; canonicalName: string; entries: CatalogEntry[] };

/**
 * PURE substring/exact resolution over a flat catalog (§9.1): exact
 * (normalized) match wins outright; else, if the substring matches span
 * multiple distinct card names, the result is ambiguous; a single distinct
 * name resolves to all of its printings.
 */
export function matchCardProducts(
  entries: CatalogEntry[],
  nameArg: string,
): MatchResult {
  const target = normalizeCardName(nameArg);
  if (!target) return { kind: "none" };

  const exact = entries.filter((e) => normalizeCardName(e.name) === target);
  if (exact.length > 0) {
    return { kind: "found", canonicalName: exact[0].name, entries: exact };
  }

  const substringMatches = entries.filter((e) =>
    normalizeCardName(e.name).includes(target),
  );
  if (substringMatches.length === 0) return { kind: "none" };

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const e of substringMatches) {
    const key = normalizeCardName(e.name);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(e.name);
    }
  }

  if (candidates.length > 1) {
    return {
      kind: "ambiguous",
      candidates: [...candidates].sort((a, b) => a.localeCompare(b)),
    };
  }

  return {
    kind: "found",
    canonicalName: substringMatches[0].name,
    entries: substringMatches,
  };
}

// ---------------------------------------------------------------------------
// Client dependencies (injectable — real implementations wired in cli.ts)
// ---------------------------------------------------------------------------

export interface CardCommandDeps {
  fetchGroups(opts?: TcgcsvOptions): Promise<Group[]>;
  fetchGroupProducts(groupId: number, opts?: TcgcsvOptions): Promise<Product[]>;
  fetchGroupPrices(
    groupId: number,
    opts?: TcgcsvOptions,
  ): Promise<TcgcsvPriceRow[]>;
  fetchProductConditions(
    q: string,
    opts?: TcgplayerSearchOptions,
  ): Promise<Map<number, FinishConditionPriceMap>>;
  fetchCardmarketData(opts?: CardmarketOptions): Promise<CardmarketData>;
  fetchEurUsdRate(opts?: FxOptions): Promise<FxRate>;
  expansionAnchorMap: ExpansionAnchorMap;
}

export interface CardCommandOptions {
  refresh?: boolean;
  /** Common currency ratio pages convert to. Defaults to 'usd' (§9.1). */
  currency?: "usd" | "eur";
}

/** Fetches groups + every group's products (cached, concurrency-capped) and resolves the name against them. */
export async function resolveCardProducts(
  nameArg: string,
  deps: Pick<CardCommandDeps, "fetchGroups" | "fetchGroupProducts">,
  opts: TcgcsvOptions = {},
): Promise<MatchResult> {
  const groups = await deps.fetchGroups(opts);
  const productLists = await mapWithConcurrency(groups, 4, async (group) => {
    const products = await deps.fetchGroupProducts(group.groupId, opts);
    return products.map((p): CatalogEntry => ({
      productId: p.productId,
      name: p.name,
      groupId: group.groupId,
      groupName: group.name,
    }));
  });
  return matchCardProducts(productLists.flat(), nameArg);
}

// ---------------------------------------------------------------------------
// Per-provider row assembly (fill happens here, before matching — see
// ORDERING CONTRACT above)
// ---------------------------------------------------------------------------

async function buildTcgplayerRows(
  canonicalName: string,
  entries: CatalogEntry[],
  deps: CardCommandDeps,
): Promise<PriceRow[]> {
  const conditionsByProduct = await deps.fetchProductConditions(canonicalName);

  const groupIds = [...new Set(entries.map((e) => e.groupId))];
  const priceRowLists = await mapWithConcurrency(groupIds, 4, (groupId) =>
    deps.fetchGroupPrices(groupId),
  );
  const priceRowsByProductId = new Map<number, TcgcsvPriceRow[]>();
  for (const rows of priceRowLists) {
    for (const row of rows) {
      const existing = priceRowsByProductId.get(row.productId);
      if (existing) existing.push(row);
      else priceRowsByProductId.set(row.productId, [row]);
    }
  }

  const rows: PriceRow[] = [];
  for (const entry of entries) {
    const finishListings: FinishConditionPriceMap = conditionsByProduct.get(
      entry.productId,
    ) ?? {
      normal: { NM: null, "SP/LP": null, MP: null, HP: null },
      foil: { NM: null, "SP/LP": null, MP: null, HP: null },
    };
    const priceRows = priceRowsByProductId.get(entry.productId) ?? [];
    const finishRows =
      priceRows.length > 0
        ? priceRows
        : [
            {
              productId: entry.productId,
              subTypeName: "Normal",
            } as TcgcsvPriceRow,
          ];

    const seenFinishes = new Set<Finish>();
    for (const priceRow of finishRows) {
      // Real subTypeName values are NOT a plain "Normal"/"Foil" literal
      // (e.g. "1st Edition Rainbow Foil", "Cold Foil") — see tcgcsv.ts's
      // TcgcsvPriceRow doc comment. A substring check is required; an exact
      // match silently classified every real foil row as normal, which is
      // why a product's foil row could go missing entirely (issue #61
      // follow-up).
      const finish: Finish = priceRow.subTypeName.includes("Foil")
        ? "foil"
        : "normal";
      if (seenFinishes.has(finish)) continue; // one row per finish per product
      seenFinishes.add(finish);

      rows.push({
        name: entry.name,
        set: entry.groupName,
        finish,
        conditions: fillTcgplayerConditions({
          listings: finishListings[finish],
        }),
      });
    }

    // A foil variant with real live listings but no tcgcsv Foil price row
    // still gets a row — never silently dropped — mirroring Cardmarket's
    // "emit only when something real backs it" foil-skip rule (§9.1).
    if (!seenFinishes.has("foil")) {
      const hasFoilListing = CONDITION_COLUMNS.some(
        (c) => finishListings.foil[c] != null,
      );
      if (hasFoilListing) {
        rows.push({
          name: entry.name,
          set: entry.groupName,
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

/** A Cardmarket price row plus its reference-only Trend value (issue #61). */
export interface CardmarketPriceRow extends PriceRow {
  trend: ConditionCell | null;
}

async function buildCardmarketRows(
  canonicalName: string,
  anchorMap: ExpansionAnchorMap,
  deps: CardCommandDeps,
): Promise<CardmarketPriceRow[]> {
  const data = await deps.fetchCardmarketData();
  const target = normalizeCardName(canonicalName);
  const matches = data.products.filter(
    (p) => normalizeCardName(p.name) === target,
  );

  const rows: CardmarketPriceRow[] = [];
  for (const product of matches) {
    const guideRow = data.priceGuideByProduct.get(product.idProduct);
    const set = cardmarketSetName(product.idExpansion, anchorMap);

    const normal = guideRow
      ? resolvePrices(guideRow, "normal")
      : {
          conditions: { NM: null, "SP/LP": null, MP: null, HP: null },
          trend: null,
        };
    rows.push({
      name: product.name,
      set,
      finish: "normal",
      conditions: normal.conditions,
      trend: normal.trend,
    });

    if (guideRow) {
      const foil = resolvePrices(guideRow, "foil");
      // Only emit a foil row when there's an actual foil price — otherwise
      // this would manufacture a spurious all-null "no-price" row for a
      // product that may not even have a foil printing.
      if (foil.conditions.NM != null || foil.trend != null) {
        rows.push({
          name: product.name,
          set,
          finish: "foil",
          conditions: foil.conditions,
          trend: foil.trend,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Full assembly
// ---------------------------------------------------------------------------

export type CardCommandResult =
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: string[] }
  | {
      kind: "found";
      canonicalName: string;
      tcgplayerRows: PriceRow[];
      cardmarketRows: CardmarketPriceRow[];
      comparisonRows: ComparisonRow[];
      unmatched: UnmatchedRow[];
      currency: "usd" | "eur";
      fx?: FxRate;
      /** Set (and ratio tables skipped) when the FX fetch failed — price tables are still assembled (§8.4). */
      ratioError?: string;
    };

export async function assembleCardComparison(
  nameArg: string,
  deps: CardCommandDeps,
  opts: CardCommandOptions = {},
): Promise<CardCommandResult> {
  const match = await resolveCardProducts(nameArg, deps, {
    refresh: opts.refresh,
  });
  if (match.kind !== "found") return match;

  const [tcgplayerRows, cardmarketRows] = await Promise.all([
    buildTcgplayerRows(match.canonicalName, match.entries, deps),
    buildCardmarketRows(match.canonicalName, deps.expansionAnchorMap, deps),
  ]);

  const { rows: comparisonRows, unmatched } = buildComparisonRows({
    tcgplayer: tcgplayerRows,
    cardmarket: cardmarketRows,
  });

  const currency = opts.currency ?? "usd";
  let fx: FxRate | undefined;
  let ratioError: string | undefined;
  try {
    fx = await deps.fetchEurUsdRate({ refresh: opts.refresh });
  } catch (e) {
    if (isFxError(e)) {
      ratioError = `Could not fetch the EUR/USD FX rate (${e.message}) — ratio tables skipped.`;
    } else {
      throw e;
    }
  }

  return {
    kind: "found",
    canonicalName: match.canonicalName,
    tcgplayerRows,
    cardmarketRows,
    comparisonRows,
    unmatched,
    currency,
    fx,
    ratioError,
  };
}

// ---------------------------------------------------------------------------
// Terminal rendering (cli-table3 + chalk, matching src/display.ts
// conventions). Real-data-only (issue #61): no bold/fallback marking — a
// cell is either a real price or empty ('—').
// ---------------------------------------------------------------------------

export type PriceProviderId = "tcgplayer" | "cardmarket";

function priceCellText(
  cell: ConditionCell | null,
  providerId: PriceProviderId,
): string {
  if (cell == null) return chalk.dim("—");
  const symbol = providerId === "tcgplayer" ? "$" : "€";
  return `${symbol}${cell.price.toFixed(2)}`;
}

function renderPriceTable(
  title: string,
  rawRows: PriceRow[],
  providerId: PriceProviderId,
): void {
  // Collapse same-identity duplicates before rendering (§4.2) — the ratio
  // page gets this for free from ComparisonRow[] (already collapsed inside
  // buildComparisonRows); the raw per-provider rows behind the price pages
  // need the same collapse applied explicitly.
  const rows = collapseDuplicates(rawRows);
  console.log(chalk.bold.cyan(title));
  if (rows.length === 0) {
    console.log(chalk.yellow("  No rows."));
    return;
  }
  const table = new Table({
    head: ["Name", "Set", "Finish", "Code", "NM", "SP/LP", "MP", "HP"].map(
      (h) => chalk.cyan(h),
    ),
    style: { compact: true },
    wordWrap: false,
  });
  for (const row of rows) {
    table.push([
      row.name,
      row.set,
      row.finish,
      lookupCardCode(row.name, row.set, row.finish) ?? chalk.dim("—"),
      priceCellText(row.conditions.NM, providerId),
      priceCellText(row.conditions["SP/LP"], providerId),
      priceCellText(row.conditions.MP, providerId),
      priceCellText(row.conditions.HP, providerId),
    ]);
  }
  console.log(table.toString());
}

/**
 * Cardmarket-specific price table (issue #61): same four condition columns
 * (all sourced from 'low') plus a trailing reference-only Trend column,
 * never used in ratio cells.
 */
function renderCardmarketPriceTable(
  title: string,
  rawRows: CardmarketPriceRow[],
): void {
  const rows = collapseDuplicates(rawRows);
  console.log(chalk.bold.cyan(title));
  if (rows.length === 0) {
    console.log(chalk.yellow("  No rows."));
    return;
  }
  const table = new Table({
    head: [
      "Name",
      "Set",
      "Finish",
      "Code",
      "NM",
      "SP/LP",
      "MP",
      "HP",
      "Trend",
    ].map((h) => chalk.cyan(h)),
    style: { compact: true },
    wordWrap: false,
  });
  for (const row of rows) {
    table.push([
      row.name,
      row.set,
      row.finish,
      lookupCardCode(row.name, row.set, row.finish) ?? chalk.dim("—"),
      priceCellText(row.conditions.NM, "cardmarket"),
      priceCellText(row.conditions["SP/LP"], "cardmarket"),
      priceCellText(row.conditions.MP, "cardmarket"),
      priceCellText(row.conditions.HP, "cardmarket"),
      priceCellText(row.trend, "cardmarket"),
    ]);
  }
  console.log(table.toString());
}

function ratioCellText(cell: RatioCell | null): string {
  if (cell == null) return chalk.dim("—");
  const text = formatRatioPct(cell.pct);
  return cell.pct >= 0 ? chalk.green(text) : chalk.red(text);
}

function renderRatioTable(
  title: string,
  rows: ComparisonRow[],
  ratiosByRow: Map<ComparisonRow, Record<ConditionColumn, RatioCell | null>>,
): void {
  console.log(chalk.bold.cyan(title));
  const table = new Table({
    head: ["Name", "Set", "Finish", "Code", "NM", "SP/LP", "MP", "HP"].map(
      (h) => chalk.cyan(h),
    ),
    style: { compact: true },
    wordWrap: false,
  });
  for (const row of rows) {
    const ratios = ratiosByRow.get(row)!;
    table.push([
      row.name,
      row.set,
      row.finish,
      lookupCardCode(row.name, row.set, row.finish) ?? chalk.dim("—"),
      ratioCellText(ratios.NM),
      ratioCellText(ratios["SP/LP"]),
      ratioCellText(ratios.MP),
      ratioCellText(ratios.HP),
    ]);
  }
  console.log(table.toString());
  console.log(
    chalk.dim(
      "basis (which source fed each side) is per-cell; see --csv output for the Basis columns.",
    ),
  );
}

/** Prints the full 4-page (or 2-page, if FX failed) output for the `card` command. */
export function printCardComparison(
  result: CardCommandResult & { kind: "found" },
): void {
  renderPriceTable(
    `TCGplayer prices (USD) — ${result.canonicalName}`,
    result.tcgplayerRows,
    "tcgplayer",
  );
  console.log();
  renderCardmarketPriceTable(
    `Cardmarket prices (EUR) — ${result.canonicalName}`,
    result.cardmarketRows,
  );

  if (result.ratioError) {
    console.log();
    console.log(chalk.red(result.ratioError));
    return;
  }
  if (!result.fx) return;

  console.log();
  console.log(
    chalk.dim(`fx: 1 EUR = ${result.fx.rate} USD (ECB ${result.fx.date})`),
  );

  const tcgCmRatios = new Map<
    ComparisonRow,
    Record<ConditionColumn, RatioCell | null>
  >();
  const cmTcgRatios = new Map<
    ComparisonRow,
    Record<ConditionColumn, RatioCell | null>
  >();
  for (const row of result.comparisonRows) {
    const tcg = row.conditionsByProvider.tcgplayer;
    const cm = row.conditionsByProvider.cardmarket;
    tcgCmRatios.set(
      row,
      computeRatioCells(tcg, cm, {
        fx: result.fx,
        currencyA: "USD",
        currencyB: "EUR",
        common: result.currency,
      }),
    );
    cmTcgRatios.set(
      row,
      computeRatioCells(cm, tcg, {
        fx: result.fx,
        currencyA: "EUR",
        currencyB: "USD",
        common: result.currency,
      }),
    );
  }

  console.log();
  renderRatioTable(
    "Ratio: tcgplayer / cardmarket",
    result.comparisonRows,
    tcgCmRatios,
  );
  console.log();
  renderRatioTable(
    "Ratio: cardmarket / tcgplayer",
    result.comparisonRows,
    cmTcgRatios,
  );
}

// ---------------------------------------------------------------------------
// CSV rendering (§9.3-shaped) — delegates to the shared src/pricing/csv.ts
// writers (PRICE-020/E2). This command owns only the `# page N` separators
// and the per-page collapse/ratio-map plumbing csv.ts expects as input;
// csv.ts owns the actual line format, ordering, and escaping.
// ---------------------------------------------------------------------------

/** Builds the ratio-cells-per-row map renderRatioPageCsv expects (§8.4). */
function buildRatioMap(
  rows: ComparisonRow[],
  providerAKey: PriceProviderId,
  providerBKey: PriceProviderId,
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

/** Renders the full §9.3-shaped, `# page N` separated CSV for the `card` command. */
export function renderCsv(
  result: CardCommandResult & { kind: "found" },
): string {
  const pages: string[] = [];

  pages.push(
    `# page 1 — TCGplayer prices (USD)\n${renderPricePageCsv(
      collapseDuplicates(result.tcgplayerRows),
      { currency: "USD" },
    )}`,
  );
  pages.push(
    `# page 2 — Cardmarket prices (EUR)\n${renderPricePageCsv(
      collapseDuplicates(result.cardmarketRows),
      { currency: "EUR", trendColumn: true },
    )}`,
  );

  if (result.ratioError || !result.fx) {
    pages.push(
      `# ratio unavailable: ${result.ratioError ?? "FX rate not available"}`,
    );
    return pages.join("\n\n");
  }

  const fx = result.fx;
  pages.push(
    `# page 3 — Ratio: tcgplayer / cardmarket\n${renderRatioPageCsv(
      result.comparisonRows,
      buildRatioMap(
        result.comparisonRows,
        "tcgplayer",
        "cardmarket",
        "USD",
        "EUR",
        fx,
        result.currency,
      ),
      { pairLabel: "tcgplayer / cardmarket", fx },
    )}`,
  );
  pages.push(
    `# page 4 — Ratio: cardmarket / tcgplayer\n${renderRatioPageCsv(
      result.comparisonRows,
      buildRatioMap(
        result.comparisonRows,
        "cardmarket",
        "tcgplayer",
        "EUR",
        "USD",
        fx,
        result.currency,
      ),
      { pairLabel: "cardmarket / tcgplayer", fx },
    )}`,
  );

  return pages.join("\n\n");
}
