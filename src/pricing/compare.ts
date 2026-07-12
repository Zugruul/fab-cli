// PURE comparison engine — see SPEC-PRICE.md §4.2, §7.1, §7.3, §10 I7, and
// docs/design/price-E1.md. No fetch, no fs here. This module owns the
// row-matching half (PRICE-010); condition fill/fallback/ratio math
// (PRICE-011) is a second, later export from this same file per the
// design doc's "one module, two logical halves" decision.

import { normalizeCardName, resolveExpansionName } from "./expansionAnchoring";
import type { ExpansionAnchorMap } from "./expansionAnchoring";
import {
  CONDITION_COLUMNS,
  type ConditionCell,
  type ConditionPrices,
  type Finish,
  type PriceRow,
} from "./types";

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

function matchKey(name: string, set: string, finish: Finish): string {
  return `${normalizeCardName(name)}|${set.trim().toLowerCase()}|${finish}`;
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

interface CollapsedRow {
  name: string;
  set: string;
  finish: Finish;
  conditions: ConditionPrices;
}

/**
 * Collapses duplicate identities within a single provider's rows, cheapest
 * price per condition winning across the duplicates (§4.2). Preserves first-
 * seen order of each identity's first occurrence.
 */
function collapseDuplicates(rows: PriceRow[]): CollapsedRow[] {
  const order: string[] = [];
  const byKey = new Map<string, CollapsedRow>();
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
  const collapsedByProvider = new Map<string, CollapsedRow[]>();
  for (const [providerId, rows] of entries) {
    collapsedByProvider.set(providerId, collapseDuplicates(rows));
  }

  // key -> providerId -> collapsed row (first-seen key order overall)
  const keyOrder: string[] = [];
  const byKey = new Map<string, Map<string, CollapsedRow>>();

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
