import type { ChunkCorpus, Embedder, RetrievalConfig, RetrievalFloors, RetrievalResult, SqliteVecStore } from "./types";
import { DEFAULT_RETRIEVAL_CONFIG } from "./types";
import { LexicalIndex } from "./lexicalIndex";
import { hybridSeed } from "./seeding";
import { expandLinks } from "./linkExpansion";
import { rankAndClipToBudget } from "./ranking";
import { computeOodSignal } from "./ood";

/**
 * Orchestrates the full §9.7 pipeline: hybrid seeding → bounded-hop link
 * expansion → activation ranking within the token budget → §10.4/§10.9
 * signal computation. Every dependency is injected (see ./types) so this
 * is fully unit-testable against in-memory fakes; the real op-sqlite/
 * on-device embedder wiring is out of scope here — device wiring lands
 * with the Q&A-flow tasks that consume this engine (APP-040/044).
 *
 * The lexical index is built once, at construction time, from the whole
 * corpus (a one-time load cost, not a per-query cost) — see
 * __tests__/perf.test.ts for why that split matters for the §9.7 p95
 * acceptance measurement.
 */
export class RetrievalEngine {
  private readonly lexicalIndex: LexicalIndex;

  constructor(
    private readonly corpus: ChunkCorpus,
    private readonly vectorStore: SqliteVecStore,
    private readonly embedder: Embedder,
    private readonly floors: RetrievalFloors,
    private readonly config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG,
  ) {
    this.lexicalIndex = new LexicalIndex(corpus);
  }

  async query(queryText: string): Promise<RetrievalResult> {
    const seedResult = await hybridSeed(
      queryText,
      this.lexicalIndex,
      this.vectorStore,
      this.embedder,
      this.corpus,
      this.config,
    );
    const expanded = expandLinks(seedResult.activation, this.corpus, this.config);
    const ranked = rankAndClipToBudget(expanded, this.corpus, this.config);

    const topActivation = ranked.length > 0 ? ranked[0].activation : 0;
    const oodSignal = computeOodSignal(
      {
        cardNameMatched: seedResult.cardNameMatched,
        topActivation,
        lexicalHitCount: seedResult.lexicalHitCount,
      },
      this.floors,
    );

    const usedTokens = ranked.reduce((sum, c) => sum + c.estimatedTokens, 0);

    return {
      chunks: ranked,
      usedTokens,
      belowFloor: oodSignal.belowFloor,
      oodFastRefusal: oodSignal.oodFastRefusal,
    };
  }
}
