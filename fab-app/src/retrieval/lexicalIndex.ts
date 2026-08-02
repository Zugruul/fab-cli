import type { ChunkCorpus, LexicalSeedResult } from "./types";

/**
 * Exact/tag lexical matching (§9.7): "instant, no embedding" required.
 * Built once from the corpus at construction time as two inverted
 * indexes — tags and card names — then queried per `search()` call.
 *
 * Card-name matching is a substring/equality check against the whole
 * query (not tokenized): card names can contain internal punctuation and
 * spaces (e.g. "Bravo, Showstopper") that a token split would break apart.
 * Tag matching splits the query on whitespace only (not `\W+`), for the
 * same reason — tags like "go-again" are single hyphenated tokens and
 * must stay matchable as a whole word.
 */
export class LexicalIndex {
  private readonly byTag = new Map<string, Set<string>>();
  private readonly cardNames: { name: string; chunkIds: string[] }[];

  constructor(corpus: ChunkCorpus) {
    const byCardName = new Map<string, Set<string>>();

    for (const chunk of corpus.all()) {
      for (const tag of chunk.tags) {
        const key = tag.toLowerCase();
        if (!this.byTag.has(key)) this.byTag.set(key, new Set());
        this.byTag.get(key)!.add(chunk.id);
      }
      for (const name of chunk.cardNames) {
        const key = name.toLowerCase();
        if (!byCardName.has(key)) byCardName.set(key, new Set());
        byCardName.get(key)!.add(chunk.id);
      }
    }

    // Sorted once at build time so search() iterates deterministically.
    this.cardNames = [...byCardName.entries()]
      .map(([name, ids]) => ({ name, chunkIds: [...ids].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  search(query: string): LexicalSeedResult {
    const q = query.toLowerCase().trim();
    const hits = new Set<string>();
    let cardNameMatched = false;

    for (const { name, chunkIds } of this.cardNames) {
      if (q === name || q.includes(name)) {
        cardNameMatched = true;
        for (const id of chunkIds) hits.add(id);
      }
    }

    for (const token of q.split(/\s+/).filter(Boolean)) {
      const ids = this.byTag.get(token);
      if (ids) for (const id of ids) hits.add(id);
    }

    return { chunkIds: [...hits].sort(), cardNameMatched };
  }
}
