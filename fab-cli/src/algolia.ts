import type { AlgoliaDeck, AlgoliaSearchResult, SearchOptions } from "./types";

const ALGOLIA_URL =
  "https://4e2ysy5y4i-dsn.algolia.net/1/indexes/*/queries";
const ALGOLIA_API_KEY = "63c7b6aa56d38399d37df3c341b982c3";
const ALGOLIA_APP_ID = "4E2YSY5Y4I";
const AGENT =
  "Algolia%20for%20JavaScript%20(4.24.0)%3B%20Browser%20(lite)";

export async function searchDecks(
  opts: SearchOptions
): Promise<AlgoliaSearchResult> {
  const facetFilters: string[][] = [];

  if (opts.hero) {
    facetFilters.push([`heroIdentifier:${opts.hero}`]);
  }
  if (opts.format) {
    facetFilters.push([`format:${opts.format}`]);
  }
  if (opts.hasMatchups === true) {
    facetFilters.push(["hasMatchups:true"]);
  }
  if (opts.hasResults === true) {
    facetFilters.push(["hasResults:true"]);
  }

  const numericFilters: string[] = [];
  if (opts.days) {
    const cutoff = Math.floor(
      (Date.now() - opts.days * 24 * 60 * 60 * 1000) / 1000
    );
    // Algolia stores dates as strings, so we can't use numericFilters directly.
    // We use the query + facets approach; date filtering is done post-fetch.
  }

  const params = new URLSearchParams({
    analytics: "true",
    facets: JSON.stringify([
      "format",
      "hasMatchups",
      "hasNotes",
      "hasResults",
      "hasYoutube",
      "heroIdentifier",
      "isPrecon",
    ]),
    highlightPostTag: "__/ais-highlight__",
    highlightPreTag: "__ais-highlight__",
    hitsPerPage: String(opts.limit ?? 50),
    maxValuesPerFacet: "200",
    page: String(opts.page ?? 0),
    query: opts.query ?? "",
    tagFilters: "",
  });

  if (facetFilters.length > 0) {
    params.set("facetFilters", JSON.stringify(facetFilters));
  }
  if (opts.tournamentOnly) {
    params.set("filters", "isTournament:true");
  }

  const body = {
    requests: [
      {
        indexName: "public_decks",
        params: params.toString(),
      },
    ],
  };

  const url = `${ALGOLIA_URL}?x-algolia-agent=${AGENT}&x-algolia-api-key=${ALGOLIA_API_KEY}&x-algolia-application-id=${ALGOLIA_APP_ID}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Algolia error: ${response.status} ${response.statusText}\n${body}`);
  }

  const data = (await response.json()) as { results: AlgoliaSearchResult[] };
  return data.results[0];
}

const ALGOLIA_INDEX_URL =
  "https://4e2ysy5y4i-dsn.algolia.net/1/indexes/public_decks";

/**
 * Search Algolia for a decklist by player name + hero identifier + format.
 * Returns the best matching deck, or null if none found.
 */
export async function findFabraryDeck(
  playerName: string,
  heroIdentifier: string,
  format: string
): Promise<AlgoliaDeck | null> {
  const params = new URLSearchParams({
    analytics: "false",
    facets: JSON.stringify(["heroIdentifier", "format"]),
    facetFilters: JSON.stringify([
      [`heroIdentifier:${heroIdentifier}`],
      [`format:${format}`],
    ]),
    hitsPerPage: "10",
    query: playerName,
  });

  const body = {
    requests: [{ indexName: "public_decks", params: params.toString() }],
  };

  const url = `${ALGOLIA_URL}?x-algolia-agent=${AGENT}&x-algolia-api-key=${ALGOLIA_API_KEY}&x-algolia-application-id=${ALGOLIA_APP_ID}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { results: AlgoliaSearchResult[] };
  const hits = data.results[0]?.hits ?? [];
  return hits[0] ?? null;
}

export async function getDeckById(deckId: string): Promise<AlgoliaDeck | null> {
  const url = `${ALGOLIA_INDEX_URL}/${encodeURIComponent(deckId)}?x-algolia-api-key=${ALGOLIA_API_KEY}&x-algolia-application-id=${ALGOLIA_APP_ID}`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Algolia error: ${response.status}`);
  return (await response.json()) as AlgoliaDeck;
}

export async function getFacets(): Promise<{
  heroes: Record<string, number>;
  formats: Record<string, number>;
}> {
  const params = new URLSearchParams({
    analytics: "false",
    facets: JSON.stringify(["heroIdentifier", "format"]),
    hitsPerPage: "0",
    maxValuesPerFacet: "500",
    query: "",
  });

  const body = {
    requests: [{ indexName: "public_decks", params: params.toString() }],
  };

  const url = `${ALGOLIA_URL}?x-algolia-agent=${AGENT}&x-algolia-api-key=${ALGOLIA_API_KEY}&x-algolia-application-id=${ALGOLIA_APP_ID}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { results: AlgoliaSearchResult[] };
  const facets = data.results[0].facets ?? {};
  return {
    heroes: facets["heroIdentifier"] ?? {},
    formats: facets["format"] ?? {},
  };
}
