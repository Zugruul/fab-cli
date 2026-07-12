// PURE anchoring logic for the Cardmarket idExpansion -> canonical set name
// map — see SPEC-PRICE.md §7.2. No fetch, no fs here; the CLI runner
// (scripts/cardmarket-expansions.ts) owns I/O and calls into this module.
//
// Algorithm: for every normalized card name that exists in exactly one
// tcgcsv set AND whose Cardmarket products all share exactly one
// idExpansion, cast one vote idExpansion -> tcgcsv group name. Each
// idExpansion is then assigned its majority-vote name, subject to two
// confidence guards (§7.2, #60) applied before a name is written to
// `votes`:
//   1. Tie guard: if the top vote count is shared by 2+ candidate names,
//      the idExpansion is omitted from `votes` entirely (no lexicographic
//      tiebreak — a tie is not a majority).
//   2. Size-plausibility guard: the CM idExpansion's total product count
//      (all CM products sharing that idExpansion, not just the voting
//      ones) must be within 2.5x the winning tcgcsv group's total product
//      count. A CM expansion much larger than the group it "won" almost
//      always means Cardmarket merged multiple physical products under
//      one idExpansion — the vote is kept but the name is untrustworthy,
//      so it's omitted rather than assigned.
// Both guards make regeneration idempotent: `votes` is always rebuilt from
// scratch, so a previously-passing entry that no longer clears a guard is
// dropped, not carried forward.

import type { Group, Product } from "./tcgcsv";
import type { CardmarketProduct } from "./cardmarket";

export interface ExpansionVote {
  name: string;
  votes: number;
  runnerUp?: { name: string; votes: number };
}

export interface ExpansionAnchorMap {
  generatedAt: string;
  /** Keyed by idExpansion (as a string). Absent = no majority vote. */
  votes: Record<string, ExpansionVote>;
  /** Keyed by idExpansion (as a string). Always wins over `votes` at lookup. */
  overrides: Record<string, string>;
}

/**
 * Normalizes a card name for cross-marketplace matching per SPEC-PRICE §7.1:
 * lowercase, strip apostrophes/diacritics/punctuation except parentheses,
 * collapse whitespace. Parenthesized pitch suffixes ("(Blue)") survive.
 */
export function normalizeCardName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritic marks
    .toLowerCase()
    .replace(/[^a-z0-9()\s]/g, "") // drop punctuation, keep parens
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Size-plausibility guard (§7.2, #60): a CM idExpansion's total product
 * count SHALL be within 2.5x the winning tcgcsv group's total product count.
 * A ratio above that strongly suggests Cardmarket merged multiple physical
 * products (e.g. several small decks) under one idExpansion.
 *
 * Ratio chosen from a full empirical pass over the live data (not just the
 * bug case): legitimate full-size expansions consistently land at 1.4x-2.0x
 * (CM catalogs more finish/variant rows per card than a tcgcsv group does —
 * e.g. Dynasty 1.98x, Everfest 1.83x, Uprising 1.85x, Compendium of Rathe
 * 1.80x — Dynasty's 1.98x was the highest observed legitimate ratio). Actual
 * merged-expansion cases are far above that band: idExpansion 4501 (the
 * reported "Armory Deck: Azalea" bug, a 34-card Armory Deck merged with
 * ~14 other small CM products) sits at 13.9x, and a second real case found
 * during regeneration (idExpansion 6014, "GEM Pack 4") sits at 5.6x. 2.5x
 * sits in the gap between the two clusters, comfortably above every
 * legitimate ratio observed and comfortably below every merge case found.
 */
const PLAUSIBILITY_RATIO = 2.5;

export function isPlausibleMatch(
  cmProductCount: number,
  tcgGroupProductCount: number,
): boolean {
  if (tcgGroupProductCount === 0) return cmProductCount === 0;
  return cmProductCount <= tcgGroupProductCount * PLAUSIBILITY_RATIO;
}

/** Builds idExpansion -> total count of CM products sharing it. */
function idExpansionProductCounts(
  cardmarketProducts: CardmarketProduct[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const product of cardmarketProducts) {
    if (product.idExpansion == null) continue;
    counts.set(product.idExpansion, (counts.get(product.idExpansion) ?? 0) + 1);
  }
  return counts;
}

/** Builds normalized-name -> set of tcgcsv groupIds it appears in. */
function nameToGroupIds(
  productsByGroupId: Map<number, Product[]>,
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const [groupId, products] of productsByGroupId) {
    for (const product of products) {
      const key = normalizeCardName(product.name);
      let groupIds = result.get(key);
      if (!groupIds) {
        groupIds = new Set();
        result.set(key, groupIds);
      }
      groupIds.add(groupId);
    }
  }
  return result;
}

/**
 * Builds normalized-name -> the single idExpansion shared by every CM
 * product with that name, or `null` if the name doesn't qualify (spans 2+
 * idExpansions, or any matching product is missing idExpansion entirely).
 */
function nameToSingleExpansion(
  cardmarketProducts: CardmarketProduct[],
): Map<string, number | null> {
  const expansionsByName = new Map<string, Set<number | undefined>>();
  for (const product of cardmarketProducts) {
    const key = normalizeCardName(product.name);
    let expansions = expansionsByName.get(key);
    if (!expansions) {
      expansions = new Set();
      expansionsByName.set(key, expansions);
    }
    expansions.add(product.idExpansion);
  }

  const result = new Map<string, number | null>();
  for (const [key, expansions] of expansionsByName) {
    if (expansions.size === 1) {
      const [only] = expansions;
      result.set(key, only == null ? null : only);
    } else {
      result.set(key, null);
    }
  }
  return result;
}

/**
 * Runs the anchoring algorithm and produces the committed map's contents.
 * `overrides` is passed through verbatim — the CLI runner is responsible for
 * loading it from the existing committed file (§7.2: overrides section is
 * preserved across regeneration, votes are recomputed).
 */
export function buildExpansionAnchorMap(
  groups: Group[],
  productsByGroupId: Map<number, Product[]>,
  cardmarketProducts: CardmarketProduct[],
  generatedAt: string,
  overrides: Record<string, string> = {},
): ExpansionAnchorMap {
  const groupNameById = new Map(groups.map((g) => [g.groupId, g.name]));
  const groupIdByName = new Map(groups.map((g) => [g.name, g.groupId]));
  const nameGroupIds = nameToGroupIds(productsByGroupId);
  const nameExpansion = nameToSingleExpansion(cardmarketProducts);
  const cmCounts = idExpansionProductCounts(cardmarketProducts);

  // idExpansion -> groupName -> vote count
  const tally = new Map<number, Map<string, number>>();

  for (const [name, groupIds] of nameGroupIds) {
    if (groupIds.size !== 1) continue; // ambiguous: name in 2+ tcgcsv sets
    const expansion = nameExpansion.get(name);
    if (expansion == null) continue; // no qualifying single CM idExpansion

    const [groupId] = groupIds;
    const groupName = groupNameById.get(groupId);
    if (!groupName) continue; // unknown group — nothing to vote for

    let byName = tally.get(expansion);
    if (!byName) {
      byName = new Map();
      tally.set(expansion, byName);
    }
    byName.set(groupName, (byName.get(groupName) ?? 0) + 1);
  }

  const votes: Record<string, ExpansionVote> = {};
  for (const [expansion, byName] of tally) {
    const ranked = [...byName.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // votes desc
      return a[0].localeCompare(b[0]); // stable ordering only (not a tiebreak)
    });
    const [topName, topVotes] = ranked[0];

    // Tie guard: 2+ candidates sharing the top vote count is not a
    // majority — omit the idExpansion entirely rather than silently
    // picking one via lexicographic order.
    if (ranked.length > 1 && ranked[1][1] === topVotes) continue;

    // Size-plausibility guard: the CM expansion's total product count must
    // be within PLAUSIBILITY_RATIO of the winning tcgcsv group's size.
    const winningGroupId = groupIdByName.get(topName);
    const tcgGroupProductCount =
      winningGroupId != null
        ? (productsByGroupId.get(winningGroupId)?.length ?? 0)
        : 0;
    const cmProductCount = cmCounts.get(expansion) ?? 0;
    if (!isPlausibleMatch(cmProductCount, tcgGroupProductCount)) continue;

    const vote: ExpansionVote = { name: topName, votes: topVotes };
    if (ranked.length > 1) {
      const [runnerUpName, runnerUpVotes] = ranked[1];
      vote.runnerUp = { name: runnerUpName, votes: runnerUpVotes };
    }
    votes[String(expansion)] = vote;
  }

  return { generatedAt, votes, overrides };
}

/** override (if any) > majority vote name > null (unmapped). */
export function resolveExpansionName(
  map: ExpansionAnchorMap,
  idExpansion: number,
): string | null {
  const key = String(idExpansion);
  const override = map.overrides[key];
  if (override) return override;
  const vote = map.votes[key];
  return vote ? vote.name : null;
}
