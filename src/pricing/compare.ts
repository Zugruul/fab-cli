// PURE comparison engine — see SPEC-PRICE.md §4.2, §7.1, §7.3, §8.1-§8.4,
// §10 I4 I5 I7, and docs/design/price-E1.md. No fetch, no fs here. This
// module owns the row-matching half (PRICE-010) and the condition
// fill/fallback/ratio math half (PRICE-011) — one module, two logical
// halves per the design doc.
//
// ORDERING CONTRACT (orchestrator decision, carried from PR #56 review):
// per-provider condition FILL (fillTcgplayerConditions / Cardmarket's
// resolvePrices + applyAdjacencyFallback) MUST run BEFORE
// buildComparisonRows. A listing-less TCGplayer row with a valid
// marketPrice needs to be filled (source 'market') before matching, or it
// gets misreported as no-price / no-counterpart here. Wiring this order is
// PRICE-012's job; this module only requires that callers already pass in
// filled ConditionPrices.

import { normalizeCardName, resolveExpansionName } from "./expansionAnchoring";
import type { ExpansionAnchorMap } from "./expansionAnchoring";
import {
  CONDITION_COLUMNS,
  type ConditionCell,
  type ConditionColumn,
  type ConditionPrices,
  type Finish,
  type PriceRow,
} from "./types";
import type { FxRate } from "./fx";
import { eurToUsd, usdToEur } from "./fx";

/** A row matched across every registered provider (SPEC-PRICE §4.2). */
export interface ComparisonRow {
  name: string;
  set: string;
  finish: Finish;
  /** Keyed by provider id, e.g. "tcgplayer" / "cardmarket". */
  conditionsByProvider: Record<string, ConditionPrices>;
}

export type UnmatchedReason =
  "no-counterpart" | "unmapped-expansion" | "no-price";

/** A row that could not be joined into a ComparisonRow (SPEC-PRICE §7.3, I7). */
export interface UnmatchedRow {
  provider: string;
  name: string;
  set: string;
  finish: Finish;
  reason: UnmatchedReason;
}

/** Cardmarket rows for an unmapped idExpansion are given this set prefix. */
const CM_UNMAPPED_PREFIX = "cm-expansion-";

function normalizeSetName(set: string): string {
  return set.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchKey(name: string, set: string, finish: Finish): string {
  return `${normalizeCardName(name)}|${normalizeSetName(set)}|${finish}`;
}

function isAllNull(conditions: ConditionPrices): boolean {
  return CONDITION_COLUMNS.every((column) => conditions[column] == null);
}

function cheaperCell(
  a: ConditionCell | null,
  b: ConditionCell | null,
): ConditionCell | null {
  if (a == null) return b;
  if (b == null) return a;
  return a.price <= b.price ? a : b;
}

function mergeConditions(
  a: ConditionPrices,
  b: ConditionPrices,
): ConditionPrices {
  const merged = {} as ConditionPrices;
  for (const column of CONDITION_COLUMNS) {
    merged[column] = cheaperCell(a[column], b[column]);
  }
  return merged;
}

/**
 * Collapses duplicate identities within a single provider's rows, cheapest
 * price per condition winning across the duplicates (§4.2). Preserves first-
 * seen order of each identity's first occurrence. Exported so callers that
 * render a single provider's raw rows (e.g. the `card` command's price
 * pages) apply the same collapse the matching engine applies internally —
 * two same-identity rows must never appear as separate lines on a price
 * page while the ratio page (built from the already-collapsed
 * ComparisonRow[]) shows one.
 */
export function collapseDuplicates(rows: PriceRow[]): PriceRow[] {
  const order: string[] = [];
  const byKey = new Map<string, PriceRow>();
  for (const r of rows) {
    const key = matchKey(r.name, r.set, r.finish);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: r.name,
        set: r.set,
        finish: r.finish,
        conditions: r.conditions,
      });
      order.push(key);
    } else {
      existing.conditions = mergeConditions(existing.conditions, r.conditions);
    }
  }
  return order.map((key) => byKey.get(key)!);
}

/**
 * Joins PriceRow[] from every registered provider into ComparisonRow[] +
 * UnmatchedRow[] (SPEC-PRICE §4.2, §7.1, §7.3, I7). Deterministic ordering:
 * rows/unmatched follow provider iteration order (Map/object insertion
 * order), then each provider's row order after duplicate collapse.
 */
export function buildComparisonRows(
  providerRows: Map<string, PriceRow[]> | Record<string, PriceRow[]>,
): { rows: ComparisonRow[]; unmatched: UnmatchedRow[] } {
  const entries: [string, PriceRow[]][] =
    providerRows instanceof Map
      ? [...providerRows.entries()]
      : Object.entries(providerRows);

  const providerIds = entries.map(([id]) => id);
  const collapsedByProvider = new Map<string, PriceRow[]>();
  for (const [providerId, rows] of entries) {
    collapsedByProvider.set(providerId, collapseDuplicates(rows));
  }

  // key -> providerId -> collapsed row (first-seen key order overall)
  const keyOrder: string[] = [];
  const byKey = new Map<string, Map<string, PriceRow>>();

  for (const providerId of providerIds) {
    for (const row of collapsedByProvider.get(providerId)!) {
      const key = matchKey(row.name, row.set, row.finish);
      let byProvider = byKey.get(key);
      if (!byProvider) {
        byProvider = new Map();
        byKey.set(key, byProvider);
        keyOrder.push(key);
      }
      byProvider.set(providerId, row);
    }
  }

  const rows: ComparisonRow[] = [];
  const unmatched: UnmatchedRow[] = [];

  for (const key of keyOrder) {
    const byProvider = byKey.get(key)!;
    // Priced entries only; all-null rows are excluded from matching and
    // reported no-price regardless of how many providers carry them.
    const pricedEntries = [...byProvider.entries()].filter(
      ([, row]) => !isAllNull(row.conditions),
    );
    const noPriceEntries = [...byProvider.entries()].filter(([, row]) =>
      isAllNull(row.conditions),
    );

    for (const [providerId, row] of noPriceEntries) {
      unmatched.push({
        provider: providerId,
        name: row.name,
        set: row.set,
        finish: row.finish,
        reason: "no-price",
      });
    }

    if (pricedEntries.length === 0) continue;

    if (pricedEntries.length === providerIds.length) {
      const conditionsByProvider: Record<string, ConditionPrices> = {};
      let name = "";
      let set = "";
      let finish: Finish = "normal";
      for (const [providerId, row] of pricedEntries) {
        conditionsByProvider[providerId] = row.conditions;
        name = row.name;
        set = row.set;
        finish = row.finish;
      }
      rows.push({ name, set, finish, conditionsByProvider });
    } else {
      for (const [providerId, row] of pricedEntries) {
        const reason: UnmatchedReason = row.set.startsWith(CM_UNMAPPED_PREFIX)
          ? "unmapped-expansion"
          : "no-counterpart";
        unmatched.push({
          provider: providerId,
          name: row.name,
          set: row.set,
          finish: row.finish,
          reason,
        });
      }
    }
  }

  return { rows, unmatched };
}

/**
 * Resolves a Cardmarket idExpansion to its canonical set name (§7.2), or a
 * deterministic `cm-expansion-<id>` / `cm-expansion-unknown` placeholder
 * when unmapped — those rows survive into the unmatched report rather than
 * being dropped (I7).
 */
export function cardmarketSetName(
  idExpansion: number | undefined,
  map: ExpansionAnchorMap,
): string {
  if (idExpansion == null) return `${CM_UNMAPPED_PREFIX}unknown`;
  return (
    resolveExpansionName(map, idExpansion) ??
    `${CM_UNMAPPED_PREFIX}${idExpansion}`
  );
}

// ---------------------------------------------------------------------------
// PRICE-011 — condition fill + adjacency fallback + ratio math (§8.1-§8.4)
// ---------------------------------------------------------------------------

/** Column order distance for the adjacency fallback rule (§8.2). */
const COLUMN_INDEX: Record<ConditionColumn, number> = {
  NM: 0,
  "SP/LP": 1,
  MP: 2,
  HP: 3,
};

/**
 * Generic §8.2 adjacency fallback: every null column is filled from the
 * nearest column that already holds a REAL price (i.e. a value present on
 * input to this function — never a value this same call produced), with
 * distance measured in column order and ties broken toward the better
 * (closer-to-NM) condition. This is a single pass over the original input,
 * so a fallback cell is always sourced from real data and fallbacks never
 * chain off one another (no copy-of-a-copy drift).
 *
 * All-null input passes through unchanged. Used directly for Cardmarket
 * rows (resolvePrices already produces §8.3 cells; this is a defensive
 * pass-through for the normal case and a real fill for all-null rows) and
 * internally by `fillTcgplayerConditions`.
 */
export function applyAdjacencyFallback(
  cells: ConditionPrices,
): ConditionPrices {
  const realColumns = CONDITION_COLUMNS.filter((c) => cells[c] != null);
  const result = {} as ConditionPrices;
  for (const column of CONDITION_COLUMNS) {
    if (cells[column] != null) {
      result[column] = cells[column];
      continue;
    }
    if (realColumns.length === 0) {
      result[column] = null;
      continue;
    }
    // realColumns is already in NM->HP order, so the first strictly-nearest
    // match found also wins any tie (it has the smaller index, i.e. the
    // better condition), giving the §8.2 tie-break for free.
    let best: ConditionColumn = realColumns[0];
    let bestDist = Math.abs(COLUMN_INDEX[best] - COLUMN_INDEX[column]);
    for (const candidate of realColumns.slice(1)) {
      const dist = Math.abs(COLUMN_INDEX[candidate] - COLUMN_INDEX[column]);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    const source = cells[best]!;
    result[column] = { price: source.price, source: `adjacent:${best}` };
  }
  return result;
}

/** Raw per-condition input for `fillTcgplayerConditions` (§8.2). */
export interface TcgplayerFillInput {
  listings: Partial<Record<ConditionColumn, number | null>>;
  marketPrice?: number | null;
  lowPrice?: number | null;
}

/**
 * TCGplayer condition fill (§8.2):
 * - A condition with a listing price uses it, source 'listing'.
 * - IF no condition has any listing THEN NM is filled from marketPrice
 *   (falling back to lowPrice if marketPrice is null/undefined), source
 *   'market'; the remaining columns are then adjacency-filled from NM.
 * - Missing individual conditions (while at least one other condition has a
 *   listing) are filled via the generic adjacency rule from the real
 *   listing columns — market/lowPrice are NOT consulted in that case.
 * - If neither listings nor marketPrice/lowPrice exist, all four cells are
 *   null.
 */
export function fillTcgplayerConditions(
  input: TcgplayerFillInput,
): ConditionPrices {
  const base = {} as ConditionPrices;
  let anyListing = false;
  for (const column of CONDITION_COLUMNS) {
    const value = input.listings[column];
    if (value != null) {
      base[column] = { price: value, source: "listing" };
      anyListing = true;
    } else {
      base[column] = null;
    }
  }

  if (!anyListing) {
    const marketValue = input.marketPrice ?? input.lowPrice;
    if (marketValue == null) {
      return { NM: null, "SP/LP": null, MP: null, HP: null };
    }
    base.NM = { price: marketValue, source: "market" };
  }

  return applyAdjacencyFallback(base);
}

/** One ratio cell (§8.4): signed pct as a fraction (0.3 = +30%) + basis label. */
export interface RatioCell {
  pct: number;
  basis: string;
}

export interface RatioOptions {
  fx: FxRate;
  currencyA: "USD" | "EUR";
  currencyB: "USD" | "EUR";
  /** Common currency both sides are converted to before dividing. Defaults to 'usd'. */
  common?: "usd" | "eur";
}

function toCommonCurrency(
  price: number,
  from: "USD" | "EUR",
  common: "usd" | "eur",
  fx: FxRate,
): number {
  const commonCurrency = common === "usd" ? "USD" : "EUR";
  if (from === commonCurrency) return price;
  return from === "EUR" ? eurToUsd(price, fx) : usdToEur(price, fx);
}

/**
 * Ratio cells for a provider pair (A, B) per §8.4: converts both sides to a
 * common currency (default USD) via the given dated `FxRate`, then computes
 * `priceA / priceB - 1` as a signed fraction. Either side missing for a
 * condition -> that cell is null (empty propagation, §8.4). `priceB`
 * converting to exactly 0 is also treated as a null cell — dividing by zero
 * never produces Infinity/NaN in the output (a genuine zero Cardmarket
 * `trend` price, §8.3, is a real input that simply can't be a ratio
 * denominator). `basis` records both sides' sources as `<sourceA>/<sourceB>`
 * (I4 — fallback-sourced ratio cells still carry their provenance).
 */
export function computeRatioCells(
  a: ConditionPrices,
  b: ConditionPrices,
  opts: RatioOptions,
): Record<ConditionColumn, RatioCell | null> {
  const common = opts.common ?? "usd";
  const result = {} as Record<ConditionColumn, RatioCell | null>;
  for (const column of CONDITION_COLUMNS) {
    const cellA = a[column];
    const cellB = b[column];
    if (cellA == null || cellB == null) {
      result[column] = null;
      continue;
    }
    const priceA = toCommonCurrency(
      cellA.price,
      opts.currencyA,
      common,
      opts.fx,
    );
    const priceB = toCommonCurrency(
      cellB.price,
      opts.currencyB,
      common,
      opts.fx,
    );
    if (priceB === 0) {
      result[column] = null;
      continue;
    }
    result[column] = {
      pct: priceA / priceB - 1,
      basis: `${cellA.source}/${cellB.source}`,
    };
  }
  return result;
}

/** Formats a ratio fraction as a signed percentage with one decimal (§8.4, e.g. '+30.0%'). */
export function formatRatioPct(pct: number): string {
  const rounded = Math.round(pct * 100 * 10) / 10;
  const sign = rounded < 0 ? "-" : "+";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}
