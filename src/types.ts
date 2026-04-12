export interface AlgoliaDeck {
  deckId: string;
  name: string;
  author: string;
  hero: string;
  heroIdentifier: string;
  format: string;
  cards: string[];
  hasMatchups: boolean;
  hasNotes: boolean;
  hasResults: boolean;
  hasYoutube: boolean;
  isPrecon: boolean;
  isTournament: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  objectID: string;
}

export interface AlgoliaSearchResult {
  hits: AlgoliaDeck[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  facets?: Record<string, Record<string, number>>;
}

export interface CardResult {
  cardIdentifier: string;
  blocked: number;
  pitched: number;
  played: number;
}

export interface GameResult {
  result: "Won" | "Lost" | "Draw";
  source: string | null;
  notes: string | null;
  deckId: string;
  gameId: string | null;
  turns: number | null;
  firstPlayer: boolean | null;
  cardResults: CardResult[] | null;
}

export interface DeckResults {
  results: GameResult[];
  nextToken: string | null;
}

export interface DeckWithStats extends AlgoliaDeck {
  wins: number;
  losses: number;
  total: number;
  winRate: number;
}

export interface Config {
  authToken?: string;
  refreshToken?: string;
  tokenExpiry?: number; // unix ms
}

export interface SearchOptions {
  hero?: string;
  format?: string;
  days?: number;
  minGames?: number;
  limit?: number;
  hasMatchups?: boolean;
  hasResults?: boolean;
  source?: string;
  page?: number;
  query?: string;
}

export interface CardPrinting {
  artists: string[];
  edition: string | null;
  foiling: string | null;
  identifier: string;
  image: string;
  isExpansionSlot: boolean | null;
  oppositeImage: string | null;
  print: string;
  rarity: string;
  set: string;
  treatment: string | null;
  treatments: string[] | null;
}

export interface FabCard {
  cardIdentifier: string;
  name: string;
  defaultImage: string;
  specialImage: string | null;
  hero: string | null;
  isCardBack: boolean | null;
  keywords: string[] | null;
  pitch: number | null;
  cost: number | null;
  defense: number | null;
  power: number | null;
  talents: string[] | null;
  classes: string[] | null;
  fusions: string[] | null;
  rarity: string;
  restrictedFormats: string[] | null;
  setIdentifiers: string[];
  specializations: string[] | null;
  subtypes: string[];
  types: string[];
  young: boolean | null;
  artists: string[];
  printings: CardPrinting[];
  matchingPrintings: CardPrinting[];
  oppositeSideCard: Partial<FabCard> | null;
}
