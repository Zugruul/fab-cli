import type { DeckResults, FabCard, GameResult } from "./types";

const GET_DECK_QUERY = `
query getDeck($deckId: ID!) {
  getDeck(deckId: $deckId) {
    deckCards {
      cardIdentifier
      quantity
      sideboardQuantity
      maybeQuantity
      matchupQuantities {
        matchupId
        quantity
        sideboardQuantity
      }
      card {
        types
        subtypes
        pitch
        cost
        power
        defense
        keywords
        talents
        classes
        rarity
      }
    }
    matchups {
      matchupId
      name
      preferredTurnOrder
      notes
    }
  }
}
`;

export interface DeckCardType {
  cardIdentifier: string;
  types: string[];
}

interface RawDeckCard {
  cardIdentifier: string;
  quantity: number;
  sideboardQuantity: number | null;
  maybeQuantity: number | null;
  matchupQuantities: Array<{ matchupId: string; quantity: number; sideboardQuantity: number | null }> | null;
  card: {
    types: string[];
    subtypes: string[];
    pitch: number | null;
    cost: number | null;
    power: number | null;
    defense: number | null;
    keywords: string[] | null;
    talents: string[] | null;
    classes: string[] | null;
    rarity: string;
  } | null;
}

interface RawDeck {
  deckCards: RawDeckCard[];
  matchups: MatchupSummary[];
}

async function getRawDeck(token: string, deckId: string): Promise<RawDeck> {
  const data = (await gql(token, GET_DECK_QUERY, { deckId })) as {
    getDeck: RawDeck;
  };
  return data.getDeck;
}

export async function getDeckCardTypes(
  token: string,
  deckId: string
): Promise<DeckCardType[]> {
  const deck = await getRawDeck(token, deckId);
  return deck.deckCards.map((c) => ({
    cardIdentifier: c.cardIdentifier,
    types: c.card?.types ?? [],
  }));
}

const GRAPHQL_URL =
  "https://42xrd23ihbd47fjvsrt27ufpfe.appsync-api.us-east-2.amazonaws.com/graphql";

async function gql(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL HTTP error: ${response.status}`);
  }

  const data = (await response.json()) as {
    data?: unknown;
    errors?: Array<{ message: string }>;
  };
  if (data.errors?.length) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

const GET_RESULTS_QUERY = `
query getResults($deckId: ID!) {
  getResults(deckId: $deckId) {
    results {
      result
      source
      notes
      deckId
      gameId
      turns
      firstPlayer
      cardResults {
        cardIdentifier
        blocked
        pitched
        played
      }
    }
    nextToken
  }
}
`;

export async function getDeckResults(
  token: string,
  deckId: string
): Promise<DeckResults> {
  const data = (await gql(token, GET_RESULTS_QUERY, { deckId })) as {
    getResults: DeckResults;
  };
  return data.getResults;
}

export interface MatchupSummary {
  matchupId: string;
  name: string;
  preferredTurnOrder: string | null;
  notes: string | null;
}

const GET_DECK_VERSIONS_QUERY = `
query getDeckVersions($deckId: ID!) {
  getDeckVersions(deckId: $deckId) {
    versions {
      version
      format
      heroIdentifier
      deckCards {
        cardIdentifier
        quantity
        sideboardQuantity
        maybeQuantity
        matchupQuantities {
          matchupId
          quantity
          sideboardQuantity
        }
      }
      matchups {
        matchupId
        name
        preferredTurnOrder
      }
    }
  }
}
`;

interface DeckVersionData {
  version: string;
  format: string;
  heroIdentifier: string;
  deckCards: Array<{
    cardIdentifier: string;
    quantity: number;
    sideboardQuantity: number | null;
    maybeQuantity: number | null;
    matchupQuantities: Array<{ matchupId: string; quantity: number; sideboardQuantity: number | null }> | null;
  }>;
  matchups: MatchupSummary[];
}

async function getLatestDeckVersion(
  token: string,
  deckId: string
): Promise<DeckVersionData | null> {
  const data = (await gql(token, GET_DECK_VERSIONS_QUERY, { deckId })) as {
    getDeckVersions: { versions: DeckVersionData[] };
  };
  const versions = data.getDeckVersions.versions;
  return versions.length ? versions[versions.length - 1] : null;
}

export interface CardData {
  types: string[];
  subtypes: string[];
  pitch: number | null;
  cost: number | null;
  power: number | null;
  defense: number | null;
  keywords: string[];
  talents: string[];
  classes: string[];
  rarity: string;
}

export interface DeckCard {
  cardIdentifier: string;
  quantity: number;
  sideboardQuantity: number;
  maybeQuantity: number;
  matchupQuantities: Array<{ matchupId: string; quantity: number; sideboardQuantity: number | null }> | null;
  cardData: CardData | null;
}

export interface DeckVersionInfo {
  cards: DeckCard[];
  inventoryCards: DeckCard[];
  matchups: MatchupSummary[];
  typeMap: Map<string, string[]>;
}

export async function getDeckVersionInfo(
  token: string,
  deckId: string
): Promise<DeckVersionInfo> {
  const deck = await getRawDeck(token, deckId);

  const allCards = deck.deckCards.map((c) => ({
    cardIdentifier: c.cardIdentifier,
    quantity: c.quantity ?? 0,
    sideboardQuantity: c.sideboardQuantity ?? 0,
    maybeQuantity: c.maybeQuantity ?? 0,
    matchupQuantities: c.matchupQuantities ?? null,
    cardData: c.card ? {
      types: c.card.types ?? [],
      subtypes: c.card.subtypes ?? [],
      pitch: c.card.pitch ?? null,
      cost: c.card.cost ?? null,
      power: c.card.power ?? null,
      defense: c.card.defense ?? null,
      keywords: c.card.keywords ?? [],
      talents: c.card.talents ?? [],
      classes: c.card.classes ?? [],
      rarity: c.card.rarity ?? "",
    } : null,
  }));

  const typeMap = new Map(deck.deckCards.map((c) => [c.cardIdentifier, c.card?.types ?? []]));

  return {
    cards: allCards.filter((c) => c.quantity > 0),
    // Exclude cards where all sideboard copies are in the maybe list
    inventoryCards: allCards.filter((c) => c.sideboardQuantity > c.maybeQuantity),
    matchups: deck.matchups ?? [],
    typeMap,
  };
}

export function computeWinRate(results: GameResult[]): {
  wins: number;
  losses: number;
  total: number;
  winRate: number;
} {
  let wins = 0;
  let losses = 0;
  for (const r of results) {
    if (r.result === "Won") wins++;
    else if (r.result === "Lost") losses++;
  }
  const total = wins + losses;
  return { wins, losses, total, winRate: total > 0 ? wins / total : 0 };
}

const SEARCH_CARDS_QUERY = `
query searchCards($text: String!) {
  searchCards(text: $text) {
    matchingPrintings {
      artists edition foiling identifier image isExpansionSlot
      oppositeImage print rarity set treatment treatments
    }
    artists
    cardIdentifier
    classes
    cost
    defense
    defaultImage
    fusions
    hero
    isCardBack
    keywords
    name
    pitch
    power
    rarity
    restrictedFormats
    setIdentifiers
    specialImage
    specializations
    subtypes
    talents
    types
    young
    printings {
      artists edition foiling identifier image isExpansionSlot
      oppositeImage print rarity set treatment treatments
    }
    oppositeSideCard {
      cardIdentifier name defaultImage types subtypes rarity pitch keywords artists
      printings {
        artists edition foiling identifier image isExpansionSlot
        oppositeImage print rarity set treatment treatments
      }
    }
  }
}
`;

export async function searchCards(
  token: string,
  text: string
): Promise<FabCard[]> {
  const data = (await gql(token, SEARCH_CARDS_QUERY, { text })) as {
    searchCards: FabCard[];
  };
  return data.searchCards;
}

// Run N promises with max P concurrent
export async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let i = 0;

  async function worker(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}
