import type { ActivatedChunk, ChunkCorpus, RetrievalConfig } from "./types";

/**
 * Bounded-hop link expansion (§9.7): seeds propagate along chunk links[],
 * up to `config.maxHops`, decaying by `hopDecay * link.weight` each hop,
 * keeping the max activation seen per chunk (a chunk reached by two
 * different paths — or already a seed — keeps whichever activation is
 * higher, matching the identity-brain recall engine's max-per-note rule
 * exactly, including that a strong enough link CAN raise a seed's own
 * recorded activation/stage above what seeding gave it).
 *
 * Traversal order is sorted by chunk id at every hop (not object/Map
 * insertion order), and each chunk's outgoing links are sorted by target
 * id before traversal, so results are deterministic regardless of how the
 * corpus or seed set was built.
 */
export function expandLinks(
  seedActivation: Map<string, ActivatedChunk>,
  corpus: ChunkCorpus,
  config: RetrievalConfig,
): Map<string, ActivatedChunk> {
  const activation = new Map(seedActivation);

  let frontier = [...activation.values()].sort((a, b) => a.chunkId.localeCompare(b.chunkId));

  for (let hop = 0; hop < config.maxHops; hop++) {
    const next: ActivatedChunk[] = [];

    for (const { chunkId: srcId, activation: srcActivation } of frontier) {
      const src = corpus.getById(srcId);
      if (!src) continue;

      const links = [...src.links].sort((a, b) => a.targetId.localeCompare(b.targetId));
      for (const link of links) {
        if (!corpus.getById(link.targetId)) continue; // dangling link, skip

        const decayed = srcActivation * config.hopDecay * link.weight;
        const existing = activation.get(link.targetId);
        if (!existing || decayed > existing.activation) {
          const entry: ActivatedChunk = { chunkId: link.targetId, activation: decayed, stage: "link" };
          activation.set(link.targetId, entry);
          next.push(entry);
        }
      }
    }

    frontier = next.sort((a, b) => a.chunkId.localeCompare(b.chunkId));
  }

  return activation;
}
