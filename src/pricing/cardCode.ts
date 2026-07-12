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
//
// PITCH DISAMBIGUATION (review finding, #68): a multi-pitch card is THREE
// separate entries in card.json — one per pitch, each with its own `pitch`
// field ("1"/"2"/"3") — and `name` never carries a pitch suffix on any of
// them (e.g. three "Bare Fangs" entries, pitch 1/2/3, each with a distinct
// Everfest code). Marketplace product names DO carry the suffix for these
// cards ("Bare Fangs (Red)"), which normalizeCardName deliberately
// preserves (§7.1) — so the suffix has to be parsed back out and routed to
// the matching pitch, not just stripped. Looking a multi-pitch card up
// WITHOUT a suffix is ambiguous (which of the 3 codes?) and returns null
// rather than guessing one; a single-pitch card (no competing pitch
// entries under that name) resolves regardless of any suffix.

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
  pitch?: string;
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

/** Marketplace pitch-suffix convention (§7.1) -> the vendored DB's `pitch` field values. */
const PITCH_BY_COLOR: Record<string, string> = {
  red: "1",
  yellow: "2",
  blue: "3",
};
const PITCH_SUFFIX = /\s*\((red|yellow|blue)\)\s*$/i;

/** Splits a trailing "(Red)"/"(Yellow)"/"(Blue)" pitch suffix off a card name, if present. */
function splitPitchSuffix(name: string): {
  base: string;
  pitch: string | null;
} {
  const m = name.match(PITCH_SUFFIX);
  if (!m) return { base: name, pitch: null };
  return {
    base: name.slice(0, m.index),
    pitch: PITCH_BY_COLOR[m[1].toLowerCase()],
  };
}

/** name|set -> pitch ("" for cards with no pitch, e.g. equipment/heroes) -> code bucket. */
let index: Map<string, Map<string, CodeBucket>> | null = null;

function buildIndex(): Map<string, Map<string, CodeBucket>> {
  if (!fs.existsSync(CARD_DB_PATH) || !fs.existsSync(SET_DB_PATH)) {
    return new Map();
  }
  const cards = JSON.parse(
    fs.readFileSync(CARD_DB_PATH, "utf-8"),
  ) as CardEntry[];
  const sets = JSON.parse(fs.readFileSync(SET_DB_PATH, "utf-8")) as SetEntry[];

  const setIdToName = new Map<string, string>();
  for (const s of sets) setIdToName.set(s.id, s.name);

  const result = new Map<string, Map<string, CodeBucket>>();
  for (const card of cards) {
    const nameKey = normalizeCardName(card.name);
    const pitchKey = card.pitch ?? "";
    for (const printing of card.printings ?? []) {
      const setName = setIdToName.get(printing.set_id);
      if (!setName) continue;

      const key = `${nameKey}|${normalizeSetName(setName)}`;
      let pitchMap = result.get(key);
      if (!pitchMap) {
        pitchMap = new Map();
        result.set(key, pitchMap);
      }
      let bucket = pitchMap.get(pitchKey);
      if (!bucket) {
        bucket = { normal: null, foil: null };
        pitchMap.set(pitchKey, bucket);
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

function getIndex(): Map<string, Map<string, CodeBucket>> {
  if (!index) index = buildIndex();
  return index;
}

/**
 * Looks up the official FAB printing code for (name, set display name,
 * finish). `name` may carry a marketplace pitch suffix ("Bare Fangs
 * (Red)") — required to disambiguate a multi-pitch card, since the
 * vendored DB has one entry per pitch under the same bare name. `set` is
 * normalized the same way as the rest of src/pricing (a matching
 * trim/lowercase/whitespace-collapse). Returns null — never throws — when
 * the vendored DB has no matching card/set/finish combo, OR when a
 * multi-pitch card is looked up without a pitch suffix (ambiguous: which
 * of its pitch variants' codes would we return? — never guessed).
 */
export function lookupCardCode(
  name: string,
  set: string,
  finish: Finish,
): string | null {
  const { base, pitch } = splitPitchSuffix(name);
  const key = `${normalizeCardName(base)}|${normalizeSetName(set)}`;
  const pitchMap = getIndex().get(key);
  if (!pitchMap) return null;

  if (pitchMap.size === 1) {
    // Single-pitch card (or a card whose set/name key otherwise has no
    // competing pitch variant) — the suffix, if any, is irrelevant.
    return pitchMap.values().next().value![finish];
  }
  if (pitch == null) return null; // multiple pitches exist, no suffix given
  const bucket = pitchMap.get(pitch);
  return bucket ? bucket[finish] : null;
}
