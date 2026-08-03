import fs from "node:fs";
import type { PrintingImageRef } from "./types.js";

interface RawPrinting {
  unique_id?: unknown;
  id?: unknown;
  set_id?: unknown;
  image_url?: unknown;
}

interface RawCard {
  name?: unknown;
  printings?: unknown;
}

/**
 * Extracts one {@link PrintingImageRef} per printing that carries a real
 * image_url, from the-fab-cube's vendored card.json (fab-cli/third_party/
 * flesh-and-blood-cards/json/english/card.json).
 *
 * Keyed on `printing.unique_id` — verified globally unique across the whole
 * vendored dataset (16,264 printings -> 16,264 distinct unique_ids, zero
 * URL conflicts, checked against the snapshot this was built against) —
 * deliberately NOT `printing.id` (the human-readable set+number print code,
 * e.g. "MST131"): the-fab-cube reuses that code across a dual-faced/fusion
 * card's separate name entries (e.g. "Inner Chi" and "A Drop in the Ocean"
 * both carry id "ENG025" with different images), so it is not a safe
 * per-image cache key. This identifier is also what the real-photo
 * benchmark's labeling protocol references (pipeline/docs/benchmark-
 * labeling.md) — NOT a registry id (that mapping happens at eval time, per
 * APP-025's backlog note, with no APP-085 dependency here).
 *
 * A printing missing `image_url` or `unique_id` is skipped rather than
 * fabricating a value — the vendored dataset has a small number of these
 * (18 of 16,264 printings, as of the snapshot checked).
 *
 * Returned sorted by printingId for deterministic --limit behavior.
 */
export function extractPrintingImageRefs(cards: RawCard[]): PrintingImageRef[] {
  const refs: PrintingImageRef[] = [];
  for (const card of cards) {
    const printings = Array.isArray(card.printings) ? (card.printings as RawPrinting[]) : [];
    for (const printing of printings) {
      if (typeof printing.image_url !== "string" || printing.image_url.length === 0) continue;
      if (typeof printing.unique_id !== "string" || printing.unique_id.length === 0) continue;
      refs.push({
        printingId: printing.unique_id,
        printCode: typeof printing.id === "string" ? printing.id : "",
        cardName: typeof card.name === "string" ? card.name : "",
        setId: typeof printing.set_id === "string" ? printing.set_id : "",
        imageUrl: printing.image_url,
      });
    }
  }
  return refs.sort((a, b) => a.printingId.localeCompare(b.printingId));
}

/** Reads + parses the vendored card.json wholesale — it's a single JSON
 * array (~5k cards / ~16k printings), no streaming needed. */
export function loadCardsFromFile(cardJsonPath: string): RawCard[] {
  return JSON.parse(fs.readFileSync(cardJsonPath, "utf8")) as RawCard[];
}
