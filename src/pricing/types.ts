// Shared pricing domain types — see SPEC-PRICE.md §4, §5, §8.1.

/** Canonical condition columns, always rendered in this order (SPEC-PRICE §4.1). */
export type ConditionColumn = "NM" | "SP/LP" | "MP" | "HP";

/** Canonical column order NM, SP/LP, MP, HP — export as a runtime constant too. */
export const CONDITION_COLUMNS: readonly ConditionColumn[] = [
  "NM",
  "SP/LP",
  "MP",
  "HP",
];

/**
 * Where a condition cell's price came from. Every non-exact fallback carries
 * a label (repo invariant I4) so no unlabeled fallback number ever reaches
 * output.
 */
export type PriceSource =
  | "listing"
  | "market"
  | "trend"
  | "low"
  | "avg30"
  | "avg7"
  | "avg1"
  | `adjacent:${ConditionColumn}`;

/** A filled price cell. Cells may be absent (null) in a row. */
export interface ConditionCell {
  price: number;
  source: PriceSource;
}

/** Per-condition prices for a row; a column may have no available price. */
export type ConditionPrices = Record<ConditionColumn, ConditionCell | null>;

export type Finish = "normal" | "foil";

/** Identity a row is matched/joined on across marketplaces (SPEC-PRICE §4.2). */
export interface RowIdentity {
  name: string;
  set: string;
  finish: Finish;
}

export interface PriceRow extends RowIdentity {
  conditions: ConditionPrices;
}

/**
 * A marketplace price source. `compare.ts`/`csv.ts` operate only on
 * `PriceRow[]` — adding a marketplace means adding one provider module and
 * registering it (SPEC-PRICE §5, G4).
 */
export interface PriceProvider {
  id: string;
  displayName: string;
  currency: "USD" | "EUR";
  fetchRows(scope?: { sets?: string[] }): Promise<PriceRow[]>;
}
