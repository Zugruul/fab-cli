// PURE deterministic CSV writers — SPEC-PRICE.md §9.3, §7.3, §8.4, §11;
// docs/design/price-E2.md. No fetch/fs here: string in, string out. Lifted
// from cardCommand.ts's inline `card --csv` writer (PRICE-020) — that writer
// had already been through 3 rounds of real-data-only fixes (#58, #60, #61),
// so this module generalizes it rather than reimplementing from scratch.
// PRICE-021's bulk `export` command will call these same writers for file
// output; cardCommand.ts is refactored (same PR) to delegate here too, with
// a characterization test proving zero behavior change.
//
// Callers are responsible for row collapsing (compare.ts's
// collapseDuplicates) before calling in — these writers only render and
// order what they're given.

import {
  CONDITION_COLUMNS,
  type ConditionCell,
  type ConditionColumn,
  type Finish,
  type PriceRow,
} from "./types";
import type { ComparisonRow, RatioCell, UnmatchedRow } from "./compare";
import { formatRatioPct } from "./compare";
import type { FxRate } from "./fx";

// ---------------------------------------------------------------------------
// Escaping + row helpers
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: (string | number)[]): string {
  return values.map((v) => csvEscape(String(v))).join(",");
}

/**
 * Deterministic row ordering (§9.3, §11): set → name A→Z → finish (normal
 * before foil). `compareSets` defaults to alphabetical set-name ordering;
 * PRICE-021 passes a tcgcsv-release-order (newest-first) comparator instead.
 * For single-card usage (the `card` command lifted here) alphabetical is the
 * only ordering available — there's no cross-catalog release order to draw
 * on from one card's rows — so the default stands unchanged for that caller.
 */
export interface CsvOrderingOptions {
  compareSets?: (a: string, b: string) => number;
}

function defaultCompareSets(a: string, b: string): number {
  return a.localeCompare(b);
}

function sortRows<T extends { set: string; name: string; finish: Finish }>(
  rows: T[],
  compareSets: (a: string, b: string) => number = defaultCompareSets,
): T[] {
  return [...rows].sort(
    (a, b) =>
      compareSets(a.set, b.set) ||
      a.name.localeCompare(b.name) ||
      (a.finish === b.finish ? 0 : a.finish === "normal" ? -1 : 1),
  );
}

// ---------------------------------------------------------------------------
// Price page CSV (§9.3)
// ---------------------------------------------------------------------------

/** A price row optionally carrying the Cardmarket reference-only Trend cell (§8.3/§9.3). */
export type PriceRowWithTrend = PriceRow & { trend?: ConditionCell | null };

export interface RenderPricePageOptions extends CsvOrderingOptions {
  currency: "USD" | "EUR";
  /** True for the Cardmarket page, which gains a trailing Trend,Trend Source pair (§9.3). */
  trendColumn?: boolean;
}

/**
 * Renders one price page: `# currency:` comment, header, then one row per
 * (name, set, finish). Empty cells render as an empty string — never a
 * placeholder like "0" or "—" (CSV convention differs from the terminal's
 * dash marker).
 */
export function renderPricePageCsv(
  rows: PriceRowWithTrend[],
  opts: RenderPricePageOptions,
): string {
  const header = opts.trendColumn
    ? "Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source,Trend,Trend Source"
    : "Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source";
  const lines = [`# currency: ${opts.currency}`, header];

  const sorted = sortRows(rows, opts.compareSets);
  for (const row of sorted) {
    const cells = CONDITION_COLUMNS.flatMap((column) => {
      const cell = row.conditions[column];
      return [cell ? cell.price : "", cell ? cell.source : ""];
    });
    const trendCells = opts.trendColumn
      ? [row.trend ? row.trend.price : "", row.trend ? row.trend.source : ""]
      : [];
    lines.push(
      csvRow([row.name, row.set, row.finish, ...cells, ...trendCells]),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Ratio page CSV (§9.3, §8.4)
// ---------------------------------------------------------------------------

export interface RenderRatioPageOptions extends CsvOrderingOptions {
  /** e.g. "tcgplayer / cardmarket" — used in the `# ratio:` comment line. */
  pairLabel: string;
  fx: FxRate;
}

/**
 * Renders one ratio page: `# ratio:` + `# fx:` comment lines, header, then
 * one row per ComparisonRow. `ratios` maps each row to its already-computed
 * per-condition ratio cells (compare.ts's `computeRatioCells`) — this module
 * only renders, it never computes ratio math itself. A missing/null cell for
 * a condition renders as two empty fields (value + Basis) — post-#61, Basis
 * is only ever `listing/low` or empty (§8.4).
 */
export function renderRatioPageCsv(
  rows: ComparisonRow[],
  ratios: Map<ComparisonRow, Record<ConditionColumn, RatioCell | null>>,
  opts: RenderRatioPageOptions,
): string {
  const lines = [
    `# ratio: ${opts.pairLabel}`,
    `# fx: 1 EUR = ${opts.fx.rate} USD (ECB ${opts.fx.date})`,
    "Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis",
  ];

  const sorted = sortRows(rows, opts.compareSets);
  for (const row of sorted) {
    const rowRatios = ratios.get(row);
    const cells = CONDITION_COLUMNS.flatMap((column) => {
      const cell = rowRatios?.[column];
      return [cell ? formatRatioPct(cell.pct) : "", cell ? cell.basis : ""];
    });
    lines.push(csvRow([row.name, row.set, row.finish, ...cells]));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// unmatched.csv (§7.3)
// ---------------------------------------------------------------------------

/**
 * Renders `unmatched.csv`: `Provider,Name,Set,Finish,Reason`. Row order
 * follows the input order (buildComparisonRows already produces `unmatched`
 * deterministically from deterministic provider input) — §9.3's set/name/
 * finish ordering rule is scoped to the price/ratio pages, not this report.
 */
export function renderUnmatchedCsv(unmatched: UnmatchedRow[]): string {
  const lines = ["Provider,Name,Set,Finish,Reason"];
  for (const row of unmatched) {
    lines.push(
      csvRow([row.provider, row.name, row.set, row.finish, row.reason]),
    );
  }
  return lines.join("\n");
}
