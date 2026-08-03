import { performance } from "node:perf_hooks";
import { RetrievalEngine } from "../engine";
import type { ChunkRecord, RetrievalConfig, RetrievalFloors } from "../types";
import { HashingBagOfWordsEmbedder, InMemoryChunkCorpus, LinearScanVectorStore } from "./testDoubles";

/**
 * Pathological-regression smoke test (issue #225), NOT the §9.7 p95 < 50ms
 * acceptance bound. This measures the JS-side retrieval algorithm end to
 * end — lexical seeding, a real linear-scan cosine KNN over an in-memory
 * vector map, bounded-hop link expansion, and ranking — against a synthetic
 * corpus sized to the same chunkCount (6,410) as @fab/manifest-schema's
 * validKnowledgePackManifest fixture.
 *
 * Why not a tight wall-clock bound: BACKLOG-APP.md's APP-033 acceptance
 * criterion is explicit that "p95 retrieval < 50 ms" is measured
 * **on-device, under APP-024's protocol** (tracked separately at #136),
 * not by a Node process sharing a CI/dev host with other work. A prior
 * attempt (#210, this file's history) tried a retry-once tolerance —
 * remeasure fresh samples once if the first window breaches 50ms — but
 * that still false-reds whenever load is *sustained* across both
 * measurement windows, which is common on a shared host running multiple
 * concurrent gates, installs, or an iOS archive: #225 observed 51.58ms p95
 * under exactly that condition, against a typical idle-host p95 of
 * 7-30ms. A wall-clock assertion tight enough to mean anything on this
 * fixture is inherently load-sensitive; the only way to stop it
 * false-redding the gate is to stop asserting device-target tightness
 * here at all.
 *
 * So: this test asserts a generous, host-load-tolerant smoke bound
 * (PATHOLOGICAL_P95_SMOKE_BOUND_MS below) whose only job is to catch a
 * genuine algorithmic blowup (e.g. an accidentally-quadratic pass over the
 * corpus) — see the bound's own doc comment for the mutation proof this
 * was calibrated against. It is NOT a performance target; the real
 * on-device p95 target lives in APP-024/#136 (§8.6's device benchmark,
 * recorded in the release manifest). The measured p95 is still logged
 * every run as a non-asserting diagnostic, so a real trend is still
 * visible in CI output without gating on it.
 */

// Generous on purpose: ~10x the worst load-induced p95 observed in
// practice (#225: 51.58ms under sustained concurrent host load, vs
// 7-30ms typical idle-host p95). This bound's only purpose is to catch a
// genuine pathological regression (e.g. an accidentally-quadratic pass
// introduced somewhere in seeding/link-expansion/ranking) — it is NOT the
// §9.7 device p95 target (that's APP-024/#136, on real hardware, gated at
// release per §8.6). Verified by local mutation: injecting a ~600ms
// busy-wait into RetrievalEngine.query() reliably fails this bound while
// a healthy engine stays under it by roughly two orders of magnitude
// (see PR body for the exact before/revert run).
const PATHOLOGICAL_P95_SMOKE_BOUND_MS = 500;

// Bit-twiddling is intrinsic to this well-known PRNG algorithm, not a style
// choice — disabled for the whole function rather than sprinkled per line.
/* eslint-disable no-bitwise */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* eslint-enable no-bitwise */

const TAGS = [
  "dominate",
  "go-again",
  "intimidate",
  "combo",
  "blade-break",
  "ability",
  "hero",
  "equipment",
  "action",
  "reaction",
];

function buildFixture(chunkCount: number): {
  corpus: InMemoryChunkCorpus;
  vectors: Map<string, number[]>;
  embedder: HashingBagOfWordsEmbedder;
} {
  const rand = mulberry32(42);
  const embedder = new HashingBagOfWordsEmbedder();
  const chunks: ChunkRecord[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const id = `chunk-${i}`;
    const tagCount = 1 + Math.floor(rand() * 2);
    const tags = Array.from({ length: tagCount }, () => TAGS[Math.floor(rand() * TAGS.length)]);
    const cardNames = rand() < 0.1 ? [`synthetic card ${i}`] : [];
    const text = `chunk body text number ${i} about ${tags.join(" ")} and rules interactions`;
    const linkCount = Math.floor(rand() * 3);
    const links = Array.from({ length: linkCount }, () => ({
      targetId: `chunk-${Math.floor(rand() * chunkCount)}`,
      weight: 0.5 + rand() * 0.5,
    })).filter((l) => l.targetId !== id);
    chunks.push({
      id,
      text,
      tags,
      cardNames,
      links,
      source: { document: "synthetic", url: `https://example.test/${id}` },
    });
  }

  const corpus = new InMemoryChunkCorpus(chunks);
  const vectors = new Map(chunks.map((c) => [c.id, embedder.embed(c.text)]));
  return { corpus, vectors, embedder };
}

describe("RetrievalEngine perf smoke test (pathological-regression bound only; real p95 target is on-device — APP-024/#136)", () => {
  it(`keeps p95 query() latency under the ${PATHOLOGICAL_P95_SMOKE_BOUND_MS}ms smoke bound against an in-memory 6,410-chunk fixture`, async () => {
    const CHUNK_COUNT = 6410; // matches @fab/manifest-schema's validKnowledgePackManifest.chunkCount
    const { corpus, vectors, embedder } = buildFixture(CHUNK_COUNT);
    const vectorStore = new LinearScanVectorStore(vectors);
    const floors: RetrievalFloors = { retrievalFloor: 0.3, oodThreshold: 0.1 };
    const config: RetrievalConfig = { semanticK: 8, maxHops: 2, hopDecay: 0.5, tokenBudget: 1024, charsPerToken: 4 };

    // Index build (LexicalIndex over the whole corpus) happens once, inside
    // the constructor — a one-time load cost, not a per-query cost, so it's
    // intentionally outside the timed loop below.
    const engine = new RetrievalEngine(corpus, vectorStore, embedder, floors, config);

    const queries = [
      "dominate",
      "go-again ability",
      "synthetic card 12",
      "combo intimidate",
      "blade-break reaction",
      "equipment action rules",
      "hero ability text",
      "synthetic card 4021",
      "unrelated rules interaction text",
      "chunk body about combo",
    ];
    const N = 30;

    async function measureP95(): Promise<number> {
      const latenciesMs: number[] = [];
      for (let i = 0; i < N; i++) {
        const query = queries[i % queries.length];
        const start = performance.now();
        await engine.query(query);
        latenciesMs.push(performance.now() - start);
      }

      latenciesMs.sort((a, b) => a - b);
      const p95Index = Math.min(latenciesMs.length - 1, Math.ceil(0.95 * latenciesMs.length) - 1);
      return latenciesMs[p95Index];
    }

    const p95 = await measureP95();

    // Non-asserting diagnostic: the real number worth watching over time,
    // logged unconditionally (pass or fail) so a slow drift is still
    // visible in CI output even though only PATHOLOGICAL_P95_SMOKE_BOUND_MS
    // below gates the test. Compare against typical idle-host p95 (7-30ms)
    // when reading this in CI logs, not against the smoke bound itself.
    console.log(
      `[perf] RetrievalEngine.query p95 over ${N} runs on ${CHUNK_COUNT} chunks: ${p95.toFixed(2)}ms ` +
        `(smoke bound: ${PATHOLOGICAL_P95_SMOKE_BOUND_MS}ms; real on-device target is APP-024/#136, §8.6)`,
    );

    expect(p95).toBeLessThan(PATHOLOGICAL_P95_SMOKE_BOUND_MS);
  });
});
