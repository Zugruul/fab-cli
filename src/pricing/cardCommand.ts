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
  ConditionPriceMap,
  TcgplayerSearchOptions,
} from "./tcgplayerSearch";
import type { CardmarketData, CardmarketOptions } from "./cardmarket";
import { resolvePrices } from "./cardmarket";
import { type FxOptions, type FxRate, isFxError } from "./fx";
import { normalizeCardName } from "./expansionAnchoring";
import type { ExpansionAnchorMap } from "./expansionAnchoring";
import {
  applyAdjacencyFallback,
  buildComparisonRows,
  cardmarketSetName,
  computeRatioCells,
  fillTcgplayerConditions,
  formatRatioPct,
  type ComparisonRow,
  type RatioCell,
  type UnmatchedRow,
} from "./compare";
import {
  CONDITION_COLUMNS,
  type ConditionCell,
  type ConditionColumn,
  type ConditionPrices,
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
  ): Promise<Map<number, ConditionPriceMap>>;
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
    const listings =
      conditionsByProduct.get(entry.productId) ??
      ({ NM: null, "SP/LP": null, MP: null, HP: null } as ConditionPriceMap);
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

    const seenFinishes = new Set<string>();
    for (const priceRow of finishRows) {
      const finish = priceRow.subTypeName === "Foil" ? "foil" : "normal";
      if (seenFinishes.has(finish)) continue; // one row per finish per product
      seenFinishes.add(finish);

      rows.push({
        name: entry.name,
        set: entry.groupName,
        finish,
        conditions: fillTcgplayerConditions({
          listings,
          marketPrice: priceRow.marketPrice,
          lowPrice: priceRow.lowPrice,
        }),
      });
    }
  }
  return rows;
}

function conditionsFromResolved(
  nm: ConditionCell | null,
  others: ConditionCell | null,
): ConditionPrices {
  return applyAdjacencyFallback({
    NM: nm,
    "SP/LP": others,
    MP: others,
    HP: others,
  });
}

async function buildCardmarketRows(
  canonicalName: string,
  anchorMap: ExpansionAnchorMap,
  deps: CardCommandDeps,
): Promise<PriceRow[]> {
  const data = await deps.fetchCardmarketData();
  const target = normalizeCardName(canonicalName);
  const matches = data.products.filter(
    (p) => normalizeCardName(p.name) === target,
  );

  const rows: PriceRow[] = [];
  for (const product of matches) {
    const guideRow = data.priceGuideByProduct.get(product.idProduct);
    const set = cardmarketSetName(product.idExpansion, anchorMap);

    const normal = guideRow
      ? resolvePrices(guideRow, "normal")
      : { nm: null, others: null };
    rows.push({
      name: product.name,
      set,
      finish: "normal",
      conditions: conditionsFromResolved(normal.nm, normal.others),
    });

    if (guideRow) {
      const foil = resolvePrices(guideRow, "foil");
      // Only emit a foil row when there's an actual foil price — otherwise
      // this would manufacture a spurious all-null "no-price" row for a
      // product that may not even have a foil printing.
      if (foil.nm != null || foil.others != null) {
        rows.push({
          name: product.name,
          set,
          finish: "foil",
          conditions: conditionsFromResolved(foil.nm, foil.others),
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
      cardmarketRows: PriceRow[];
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
// Bold-fallback decision (§9.1: "fallback-sourced prices render bold") — pure
// ---------------------------------------------------------------------------

export type PriceProviderId = "tcgplayer" | "cardmarket";

/**
 * The "exact" (non-fallback) source for a column on a given provider's price
 * page (§8): tcgplayer's exact source is 'listing'; cardmarket's only exact
 * source is 'trend', and only for the NM column — SP/LP, MP, HP are always
 * sourced from 'low' (§8.3), so they are always considered fallback there.
 */
function exactSource(
  providerId: PriceProviderId,
  column: ConditionColumn,
): string | null {
  if (providerId === "tcgplayer") return "listing";
  return column === "NM" ? "trend" : null;
}

export function isFallbackCell(
  cell: ConditionCell | null,
  providerId: PriceProviderId,
  column: ConditionColumn,
): boolean {
  if (cell == null) return false;
  const exact = exactSource(providerId, column);
  if (exact == null) return true;
  return cell.source !== exact;
}

function fallbackSourcesOnPage(
  rows: PriceRow[],
  providerId: PriceProviderId,
): string[] {
  const sources = new Set<string>();
  for (const row of rows) {
    for (const column of CONDITION_COLUMNS) {
      const cell = row.conditions[column];
      if (isFallbackCell(cell, providerId, column) && cell) {
        sources.add(cell.source);
      }
    }
  }
  return [...sources].sort();
}

// ---------------------------------------------------------------------------
// Terminal rendering (cli-table3 + chalk, matching src/display.ts conventions)
// ---------------------------------------------------------------------------

function priceCellText(
  cell: ConditionCell | null,
  providerId: PriceProviderId,
  column: ConditionColumn,
): string {
  if (cell == null) return chalk.dim("—");
  const text = `$${cell.price.toFixed(2)}`.replace(
    "$",
    providerId === "tcgplayer" ? "$" : "€",
  );
  return isFallbackCell(cell, providerId, column) ? chalk.bold(text) : text;
}

function renderPriceTable(
  title: string,
  rows: PriceRow[],
  providerId: PriceProviderId,
): void {
  console.log(chalk.bold.cyan(title));
  if (rows.length === 0) {
    console.log(chalk.yellow("  No rows."));
    return;
  }
  const table = new Table({
    head: ["Name", "Set", "Finish", "NM", "SP/LP", "MP", "HP"].map((h) =>
      chalk.cyan(h),
    ),
    style: { compact: true },
    wordWrap: false,
  });
  for (const row of rows) {
    table.push([
      row.name,
      row.set,
      row.finish,
      priceCellText(row.conditions.NM, providerId, "NM"),
      priceCellText(row.conditions["SP/LP"], providerId, "SP/LP"),
      priceCellText(row.conditions.MP, providerId, "MP"),
      priceCellText(row.conditions.HP, providerId, "HP"),
    ]);
  }
  console.log(table.toString());
  const sources = fallbackSourcesOnPage(rows, providerId);
  if (sources.length > 0) {
    console.log(
      chalk.dim(
        `bold = price not found for this condition; taken from: ${sources.join(", ")}`,
      ),
    );
  }
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
    head: ["Name", "Set", "Finish", "NM", "SP/LP", "MP", "HP"].map((h) =>
      chalk.cyan(h),
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
  renderPriceTable(
    `Cardmarket prices (EUR) — ${result.canonicalName}`,
    result.cardmarketRows,
    "cardmarket",
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
// CSV rendering (§9.3-shaped) — kept local to this command; PRICE-020 (E2)
// builds the shared csv.ts writer for `export`. If that lands first and this
// is trivial to delegate to it, do so there; this is intentionally minimal.
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: (string | number)[]): string {
  return values.map((v) => csvEscape(String(v))).join(",");
}

function pricePageCsv(rows: PriceRow[]): string {
  const lines = [
    "Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source",
  ];
  const sorted = [...rows].sort(
    (a, b) =>
      a.set.localeCompare(b.set) ||
      a.name.localeCompare(b.name) ||
      (a.finish === b.finish ? 0 : a.finish === "normal" ? -1 : 1),
  );
  for (const row of sorted) {
    const cells = CONDITION_COLUMNS.flatMap((column) => {
      const cell = row.conditions[column];
      return [cell ? cell.price : "", cell ? cell.source : ""];
    });
    lines.push(csvRow([row.name, row.set, row.finish, ...cells]));
  }
  return lines.join("\n");
}

function ratioPageCsv(
  rows: ComparisonRow[],
  currencyA: "USD" | "EUR",
  currencyB: "USD" | "EUR",
  fx: FxRate,
  common: "usd" | "eur",
  providerAKey: "tcgplayer" | "cardmarket",
  providerBKey: "tcgplayer" | "cardmarket",
): string {
  const lines = [
    "Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis",
  ];
  const sorted = [...rows].sort(
    (a, b) => a.set.localeCompare(b.set) || a.name.localeCompare(b.name),
  );
  for (const row of sorted) {
    const a = row.conditionsByProvider[providerAKey];
    const b = row.conditionsByProvider[providerBKey];
    const ratios = computeRatioCells(a, b, {
      fx,
      currencyA,
      currencyB,
      common,
    });
    const cells = CONDITION_COLUMNS.flatMap((column) => {
      const cell = ratios[column];
      return [cell ? formatRatioPct(cell.pct) : "", cell ? cell.basis : ""];
    });
    lines.push(csvRow([row.name, row.set, row.finish, ...cells]));
  }
  return lines.join("\n");
}

/** Renders the full §9.3-shaped, `# page N` separated CSV for the `card` command. */
export function renderCsv(
  result: CardCommandResult & { kind: "found" },
): string {
  const pages: string[] = [];

  pages.push(
    `# page 1 — TCGplayer prices (USD)\n# currency: USD\n${pricePageCsv(result.tcgplayerRows)}`,
  );
  pages.push(
    `# page 2 — Cardmarket prices (EUR)\n# currency: EUR\n${pricePageCsv(result.cardmarketRows)}`,
  );

  if (result.ratioError || !result.fx) {
    pages.push(
      `# ratio unavailable: ${result.ratioError ?? "FX rate not available"}`,
    );
    return pages.join("\n\n");
  }

  const fxLine = `# fx: 1 EUR = ${result.fx.rate} USD (ECB ${result.fx.date})`;
  pages.push(
    `# page 3 — Ratio: tcgplayer / cardmarket\n# ratio: tcgplayer / cardmarket\n${fxLine}\n${ratioPageCsv(
      result.comparisonRows,
      "USD",
      "EUR",
      result.fx,
      result.currency,
      "tcgplayer",
      "cardmarket",
    )}`,
  );
  pages.push(
    `# page 4 — Ratio: cardmarket / tcgplayer\n# ratio: cardmarket / tcgplayer\n${fxLine}\n${ratioPageCsv(
      result.comparisonRows,
      "EUR",
      "USD",
      result.fx,
      result.currency,
      "cardmarket",
      "tcgplayer",
    )}`,
  );

  return pages.join("\n\n");
}
