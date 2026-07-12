// Official FAB printing code (e.g. "EVR141") lookup — SPEC-PRICE.md §4.3,
// §9.1, §9.3. Reads the vendored the-fab-cube DB
// (third_party/flesh-and-blood-cards, same source as src/carddb.ts) as the
// code's authority — never either marketplace's own product naming. Lazy,
// built once, pure thereafter; never throws on a missing card/set/finish —
// an unmatched lookup is an empty result, never a guess.
//
// A printing's `foiling` field ("S" Standard, "R" Rainbow Foil, "C" Cold
// Foil, "G" Gold Foil) is a finish variant of the SAME printing id far more
// often than not (e.g. Haze Bending's Everfest EVR141 carries both an "S"
// and an "R" row) — but not always: some sets assign a distinct id to the
// foil-exclusive row (e.g. Ironsong Response's Local Game Store Promos
// printings: LGS008 normal, LGS029 foil). So the index keeps one code per
// (name, set, finish) bucket rather than collapsing foiling variants.

import * as fs from "fs";
import * as path from "path";
import { normalizeCardName } from "./expansionAnchoring";
import type { Finish } from "./types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CARD_DB_PATH = path.join(
  REPO_ROOT,
  "third_party",
  "flesh-and-blood-cards",
  "json",
  "english",
  "card.json",
);
const SET_DB_PATH = path.join(
  REPO_ROOT,
  "third_party",
  "flesh-and-blood-cards",
  "json",
  "english",
  "set.json",
);

interface CardPrinting {
  id: string;
  set_id: string;
  foiling: string;
}

interface CardEntry {
  name: string;
  printings?: CardPrinting[];
}

interface SetEntry {
  id: string;
  name: string;
}

interface CodeBucket {
  normal: string | null;
  foil: string | null;
}

function normalizeSetName(set: string): string {
  return set.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Standard ("S") is normal; Rainbow/Cold/Gold Foil (or unlabeled) counts as foil. */
function finishOf(foiling: string): Finish {
  return foiling === "S" ? "normal" : "foil";
}

let index: Map<string, CodeBucket> | null = null;

function buildIndex(): Map<string, CodeBucket> {
  if (!fs.existsSync(CARD_DB_PATH) || !fs.existsSync(SET_DB_PATH)) {
    return new Map();
  }
  const cards = JSON.parse(fs.readFileSync(CARD_DB_PATH, "utf-8")) as CardEntry[];
  const sets = JSON.parse(fs.readFileSync(SET_DB_PATH, "utf-8")) as SetEntry[];

  const setIdToName = new Map<string, string>();
  for (const s of sets) setIdToName.set(s.id, s.name);

  const result = new Map<string, CodeBucket>();
  for (const card of cards) {
    const nameKey = normalizeCardName(card.name);
    for (const printing of card.printings ?? []) {
      const setName = setIdToName.get(printing.set_id);
      if (!setName) continue;

      const key = `${nameKey}|${normalizeSetName(setName)}`;
      let bucket = result.get(key);
      if (!bucket) {
        bucket = { normal: null, foil: null };
        result.set(key, bucket);
      }
      const finish = finishOf(printing.foiling);
      // First-seen wins per bucket — deterministic (card.json array order),
      // and the rare case of 2+ distinct ids for the same finish (e.g. a
      // cold-foil-only alt art alongside a rainbow-foil row) has no single
      // "correct" pick anyway.
      if (bucket[finish] === null) bucket[finish] = printing.id;
    }
  }
  return result;
}

function getIndex(): Map<string, CodeBucket> {
  if (!index) index = buildIndex();
  return index;
}

/**
 * Looks up the official FAB printing code for (name, set display name,
 * finish). `name`/`set` are normalized the same way as the rest of
 * src/pricing (expansionAnchoring.ts's `normalizeCardName` for the card
 * name; a matching trim/lowercase/whitespace-collapse for the set name).
 * Returns null — never throws — when the vendored DB has no matching
 * card/set/finish combo (unmapped Cardmarket expansions, or genuinely
 * absent data).
 */
export function lookupCardCode(
  name: string,
  set: string,
  finish: Finish,
): string | null {
  const key = `${normalizeCardName(name)}|${normalizeSetName(set)}`;
  const bucket = getIndex().get(key);
  if (!bucket) return null;
  return bucket[finish];
}
