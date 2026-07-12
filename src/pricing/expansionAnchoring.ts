// PURE anchoring logic for the Cardmarket idExpansion -> canonical set name
// map — see SPEC-PRICE.md §7.2. No fetch, no fs here; the CLI runner
// (scripts/cardmarket-expansions.ts) owns I/O and calls into this module.
//
// Algorithm: for every normalized card name that exists in exactly one
// tcgcsv set AND whose Cardmarket products all share exactly one
// idExpansion, cast one vote idExpansion -> tcgcsv group name. Each
// idExpansion is then assigned its majority-vote name (ties broken
// lexicographically by name, smallest wins, for determinism).

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
  const nameGroupIds = nameToGroupIds(productsByGroupId);
  const nameExpansion = nameToSingleExpansion(cardmarketProducts);

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
      return a[0].localeCompare(b[0]); // tie: lexicographically smallest name
    });
    const [topName, topVotes] = ranked[0];
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
