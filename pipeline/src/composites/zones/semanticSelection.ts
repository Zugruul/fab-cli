/**
 * Semantic card selection by zone kind (#253), reading directly from the
 * vendored the-fab-cube catalog (fab-cli/third_party/flesh-and-blood-
 * cards/json/english/card.json). Grounded in REAL records (read before
 * writing this file, not guessed):
 *
 *  - There is no separate `subtypes`/`classes`/`talents` field on this
 *    dataset — equipment slot, weapon hand-count, and hero-ness are all
 *    encoded together in one flat `types: string[]` array, e.g. Ironhide
 *    Helm is `["Generic","Equipment","Head"]`, Ball Breaker (a 1H weapon)
 *    is `["Brute","Weapon","Flail","1H"]`.
 *  - "Off-Hand" is its OWN distinct `types` token, never co-occurring with
 *    "Weapon" in the dataset (verified: the intersection is empty) — it is
 *    NOT "any second 1H weapon", it's a dedicated slot like Head/Chest/
 *    Arms/Legs (e.g. Arcane Lantern: `["Generic","Equipment","Off-Hand"]`).
 *  - Blood Debt is `card_keywords: ["Blood Debt"]` (exact title-case
 *    string, e.g. on Battlefield Breaker).
 *  - The stable per-image identifier is `printing.unique_id` (catalog.ts's
 *    existing extraction convention — NOT `printing.id`, the human-
 *    readable print code reused across dual-faced/fusion entries).
 */
import { cachePathFor } from "../../images/cache.js";
import type { PrintingImageRef } from "../../images/types.js";
import type { ZoneKind } from "./zoneMap.js";

export type SelectableZoneKind = Exclude<ZoneKind, "deck">;

/** Defensive, `unknown`-typed raw shapes (mirrors images/catalog.ts's own
 * RawCard/RawPrinting style) — the vendored JSON is external data, never
 * trusted blindly. */
export interface RawPrintingForSelection {
  unique_id?: unknown;
  id?: unknown;
  set_id?: unknown;
  image_url?: unknown;
}

export interface RawCardForSelection {
  name?: unknown;
  types?: unknown;
  card_keywords?: unknown;
  printings?: unknown;
}

export interface EligibleCard extends PrintingImageRef {
  imagePath: string;
}

function hasAllTypes(card: RawCardForSelection, required: string[]): boolean {
  if (!Array.isArray(card.types)) return false;
  return required.every((t) => (card.types as unknown[]).includes(t));
}

function hasBloodDebt(card: RawCardForSelection): boolean {
  return Array.isArray(card.card_keywords) && (card.card_keywords as unknown[]).includes("Blood Debt");
}

/**
 * Zone-kind eligibility predicates (#253 brief, verbatim mapping):
 *  - head/chest/arms/legs: Equipment + the matching slot token
 *  - weapon: any Weapon-type card (1H or 2H — this doesn't model the real
 *    "2H excludes an off-hand item" play restriction; these are training
 *    photos of a game state, not a legality check, #253 scope decision)
 *  - offHand: the dedicated Off-Hand type token
 *  - hero: any Hero-type card (young or adult)
 *  - banished: the Blood Debt keyword
 *  - pitch/graveyard/arsenal: "any card" (brief: "PITCH zone: any card...
 *    a resource card face-up is realistic"; graveyard/arsenal extended the
 *    same way for symmetry, #253 scope decision)
 */
export function cardMatchesZoneKind(card: RawCardForSelection, kind: SelectableZoneKind): boolean {
  switch (kind) {
    case "head":
      return hasAllTypes(card, ["Equipment", "Head"]);
    case "chest":
      return hasAllTypes(card, ["Equipment", "Chest"]);
    case "arms":
      return hasAllTypes(card, ["Equipment", "Arms"]);
    case "legs":
      return hasAllTypes(card, ["Equipment", "Legs"]);
    case "weapon":
      return Array.isArray(card.types) && card.types.includes("Weapon");
    case "offHand":
      return hasAllTypes(card, ["Off-Hand"]);
    case "hero":
      return Array.isArray(card.types) && card.types.includes("Hero");
    case "banished":
      return hasBloodDebt(card);
    case "pitch":
    case "graveyard":
    case "arsenal":
      return true;
  }
}

/**
 * All printings matching `kind`, sorted deterministically by printingId
 * (same convention as images/catalog.ts's extractPrintingImageRefs).
 * `imagePath` is the DESTINATION cache path (cachePathFor), computed
 * whether or not the file has been downloaded yet — planning is decoupled
 * from IO (the caller downloads exactly the printings actually picked,
 * #253's "download what's needed for the run", not the whole catalog).
 *
 * Throws a loud error naming the zone kind when zero printings match —
 * lesson from #253: "catalog having ZERO cards matching a semantic slot
 * (loud error naming the slot — never silent skip)".
 */
export function eligiblePrintingsForZoneKind(cards: RawCardForSelection[], kind: SelectableZoneKind, imagesCacheDir: string): EligibleCard[] {
  const out: EligibleCard[] = [];
  for (const card of cards) {
    if (!cardMatchesZoneKind(card, kind)) continue;
    const printings = Array.isArray(card.printings) ? (card.printings as RawPrintingForSelection[]) : [];
    for (const printing of printings) {
      if (typeof printing.image_url !== "string" || printing.image_url.length === 0) continue;
      if (typeof printing.unique_id !== "string" || printing.unique_id.length === 0) continue;
      const ref: PrintingImageRef = {
        printingId: printing.unique_id,
        printCode: typeof printing.id === "string" ? printing.id : "",
        cardName: typeof card.name === "string" ? card.name : "",
        setId: typeof printing.set_id === "string" ? printing.set_id : "",
        imageUrl: printing.image_url,
      };
      out.push({ ...ref, imagePath: cachePathFor(imagesCacheDir, ref) });
    }
  }
  out.sort((a, b) => a.printingId.localeCompare(b.printingId));
  if (out.length === 0) {
    throw new Error(
      `eligiblePrintingsForZoneKind: zero printings match zone kind "${kind}" in the vendored catalog — ` +
        "cannot plan a zone-layout composite without at least one candidate card for this slot",
    );
  }
  return out;
}

/**
 * Deterministic index pick from `draw01` (a [0,1) value drawn from the
 * seeded rng stream) — never Math.random, never re-rolled. Defensive
 * clamp at draw01 === 1 (or any float-rounding overshoot) so this never
 * indexes past the array end.
 */
export function pickDeterministic<T>(items: T[], draw01: number): T {
  const idx = Math.min(items.length - 1, Math.floor(draw01 * items.length));
  return items[idx];
}
