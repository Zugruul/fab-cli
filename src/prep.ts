// Matchup prep sheet: aggregates the top decks for hero X's guides against hero Y,
// plus X-vs-Y win rate/games from the meta-results endpoint. See docs/design/fab-E5.md
// for why win rate/games comes from fetchMetaResults() and not raw GameResult[] —
// GameResult has no opponent-hero field, so it can't be computed per-game.
import { searchDecks } from "./algolia";
import { resolveFormat } from "./format";
import { fetchMetaResults, type HeroMatchup } from "./meta";
import {
  getDeckResults,
  getDeckVersionInfo,
  computeWinRate,
  pLimit,
  type MatchupSummary,
} from "./graphql";
import { buildMatchupCardDiff, type MatchupDiffEntry } from "./display";
import { getValidToken } from "./config";
import type { AlgoliaDeck } from "./types";

export interface DeckCardDiffEntry {
  cardIdentifier: string;
  quantity: number;
  pitch: number | null;
}

export interface PrepDeckGuide {
  deckId: string;
  deckName: string;
  author: string;
  matchup: MatchupSummary;
  cardDiff: { added: DeckCardDiffEntry[]; removed: DeckCardDiffEntry[] };
}

export interface PrepSheet {
  heroX: string;
  heroY: string;
  matchupStat: HeroMatchup | null;
  noMatchupStatReason: string;
  deckGuides: PrepDeckGuide[];
  noDeckGuidesReason: string;
  decksWithoutGuide: number;
}

export interface PrepOptions {
  format?: string;
  /** Max top decks (by win rate, min-games filtered) whose full detail is fetched. Smaller
   *  than `top`'s default since each candidate costs a full getDeck call, not just results. */
  deckLimit?: number;
  minGames?: number;
}

const DEFAULT_DECK_LIMIT = 10;
const DEFAULT_MIN_GAMES = 5;
const DEFAULT_SEARCH_LIMIT = 40;
const DEFAULT_META_PERIOD = "last-30-days";

/** Loosely normalize a hero name/identifier for fuzzy matching (e.g. "heroy" vs "hero-y"). */
function normalizeHeroKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toDiffEntries(
  entries: MatchupDiffEntry[],
  sign: "+" | "-",
): DeckCardDiffEntry[] {
  return entries
    .filter((e) => e.sign === sign)
    .map((e) => ({ cardIdentifier: e.id, quantity: e.qty, pitch: e.pitch }));
}

/** Same case-insensitive substring match `deck --matchup <name>` uses to resolve a
 *  partial matchup-name input. */
function findMatchupByName(
  matchups: MatchupSummary[],
  needle: string,
): MatchupSummary | undefined {
  const lower = needle.toLowerCase();
  return matchups.find((m) => m.name.toLowerCase().includes(lower));
}

export async function buildPrepSheet(
  heroX: string,
  heroY: string,
  opts: PrepOptions = {},
): Promise<PrepSheet> {
  const deckLimit = opts.deckLimit ?? DEFAULT_DECK_LIMIT;
  const minGames = opts.minGames ?? DEFAULT_MIN_GAMES;
  const resolvedFormat = resolveFormat(opts.format);

  const metaRows = await fetchMetaResults(
    opts.format ?? "cc",
    DEFAULT_META_PERIOD,
  );
  const heroXKey = normalizeHeroKey(heroX);
  const heroYKey = normalizeHeroKey(heroY);
  const heroRow = metaRows.find((r) =>
    normalizeHeroKey(r.hero).includes(heroXKey),
  );
  const matchupStat =
    heroRow?.matchups.find((m) =>
      normalizeHeroKey(m.opponent).includes(heroYKey),
    ) ?? null;
  const noMatchupStatReason = `No meta data found for the "${heroX}" vs "${heroY}" matchup in the current meta period.`;

  const searchResult = await searchDecks({
    hero: heroX,
    format: resolvedFormat,
    hasResults: true,
    limit: DEFAULT_SEARCH_LIMIT,
  });

  let deckGuides: PrepDeckGuide[] = [];
  let decksWithoutGuide = 0;

  if (searchResult.hits.length > 0) {
    const token = await getValidToken();

    const resultsTasks = searchResult.hits.map(
      (deck: AlgoliaDeck) => async () => {
        const r = await getDeckResults(token, deck.deckId);
        return { deck, ...computeWinRate(r.results) };
      },
    );
    const withStats = await pLimit(resultsTasks, 8);

    const topDecks = withStats
      .filter((d) => d.total >= minGames)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, deckLimit);

    const guideTasks = topDecks.map((d) => async () => {
      const info = await getDeckVersionInfo(token, d.deck.deckId);
      const matchup = findMatchupByName(info.matchups, heroY);
      if (!matchup) return null;
      const diff = buildMatchupCardDiff(
        matchup.matchupId,
        info.cards,
        info.inventoryCards,
      );
      const guide: PrepDeckGuide = {
        deckId: d.deck.deckId,
        deckName: d.deck.name,
        author: d.deck.author,
        matchup,
        cardDiff: {
          removed: toDiffEntries(diff, "-"),
          added: toDiffEntries(diff, "+"),
        },
      };
      return guide;
    });
    const guideResults = await pLimit(guideTasks, 8);
    deckGuides = guideResults.filter((g): g is PrepDeckGuide => g !== null);
    decksWithoutGuide = topDecks.length - deckGuides.length;
  }

  const noDeckGuidesReason = `No deck-specific matchup guides found for "${heroY}" among the top ${deckGuides.length + decksWithoutGuide} "${heroX}" decks checked.`;

  return {
    heroX,
    heroY,
    matchupStat,
    noMatchupStatReason,
    deckGuides,
    noDeckGuidesReason,
    decksWithoutGuide,
  };
}
