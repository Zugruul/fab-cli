// PURE comparison engine — see SPEC-PRICE.md §4.2, §7.1, §7.3, §8.1-§8.4,
// §10 I4 I5 I7, and docs/design/price-E1.md. No fetch, no fs here. This
// module owns the row-matching half (PRICE-010) and the condition
// fill/ratio math half (PRICE-011) — one module, two logical halves per the
// design doc.
//
// REAL-DATA-ONLY (issue #61, spec delta PRICE-061): there is no fabricated
// fill anymore. fillTcgplayerConditions only ever uses real per-condition
// listings; Cardmarket's resolvePrices only ever uses the real 'low' field
// for condition cells. A condition with no real price is an empty cell.
//
// ORDERING CONTRACT (orchestrator decision, carried from PR #56 review):
// per-provider condition FILL (fillTcgplayerConditions / Cardmarket's
// resolvePrices) MUST run BEFORE buildComparisonRows — wiring this order is
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
 *
 * Generic over T so callers that attach extra reference-only fields (e.g.
 * Cardmarket's `trend` column, issue #61) get them merged too: any optional
 * `trend` cell present is merged with the same cheaper-wins rule as the
 * condition columns; every other extra field is carried from the
 * first-seen occurrence.
 */
export function collapseDuplicates<
  T extends PriceRow & { trend?: ConditionCell | null },
>(rows: T[]): T[] {
  const order: string[] = [];
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const key = matchKey(r.name, r.set, r.finish);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...r });
      order.push(key);
    } else {
      existing.conditions = mergeConditions(existing.conditions, r.conditions);
      if ("trend" in r) {
        existing.trend = cheaperCell(existing.trend ?? null, r.trend ?? null);
      }
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
// PRICE-011 — condition fill + ratio math (§8.1-§8.4)
// ---------------------------------------------------------------------------

/** Raw per-condition input for `fillTcgplayerConditions` (§8.2). */
export interface TcgplayerFillInput {
  listings: Partial<Record<ConditionColumn, number | null>>;
}

/**
 * TCGplayer condition fill (§8.2, real-data-only per issue #61): a condition
 * with a live listing price uses it, source 'listing'. A condition with no
 * listing is left empty (null) — there is no adjacency copy and no
 * marketPrice/lowPrice stand-in anymore.
 */
export function fillTcgplayerConditions(
  input: TcgplayerFillInput,
): ConditionPrices {
  const result = {} as ConditionPrices;
  for (const column of CONDITION_COLUMNS) {
    const value = input.listings[column];
    result[column] = value != null ? { price: value, source: "listing" } : null;
  }
  return result;
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
