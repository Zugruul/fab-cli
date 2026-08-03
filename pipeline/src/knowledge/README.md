# Knowledge-pack builder (SPEC-APP.md §8.8, §4 Glossary — APP-085, issue #142)

Builds the knowledge-pack artifacts fab-app's retrieval engine (§9.7) and APP-029's pack
assembly consume: text-chunk embeddings, the printing-id registry, sqlite-vec-ready index
files, and delta packs with tombstones between consecutive corpus snapshots.

```bash
npm run knowledge:build:full -- --version 1.0.0
npm run knowledge:build:delta -- --from pipeline/out/knowledge/v1 --to pipeline/out/knowledge/v2
```

## Why embeddings are an input contract, not something this builder computes

SPEC-APP.md §5 names `bge-small-en-v1.5` as the default text embedder, but this repo has **no
runnable local text-embedder training/export chain** — the only training work that exists is
the SLM itself (APP-020/021). The image/recognition embedder DOES have a real chain
(`pipeline/src/train-vision/`, APP-028), but it trains at production scale under a QA gate
(real-photo-benchmark top-1 ≥95%, §8.7d) that hasn't passed yet.

So this builder never runs an embedder and never fabricates a vector. It consumes a documented
JSONL contract instead:

```jsonl
{"chunkId": "brain/judge/...", "embedderVersion": "text-embed-v1", "vector": [0.1, 0.2, ...]}
```

(mirror for images: `{"printingId": "...", "embedderVersion": "...", "vector": [...]}`). Every
record in a file must share the same `embedderVersion` and vector length — a mixed file is
refused outright at load time (`textEmbeddingsInput.ts` / `imageEmbeddingsInput.ts`).

`--text-embeddings`/`--image-embeddings` omitted entirely is the honest, first-class "no
embedder run yet" state: `provided: false` with a `reason`, and a sentinel version
(`"unembedded"` / `"unset"`) pinned into the manifest — never a fake version string. A NON-null
path that doesn't resolve to a real file IS an error (a broken/mistyped upstream stage fails
loud, same convention as `dataset/cli.ts`'s `loadChunks`).

**Boundary convention:** if text embeddings ARE provided, they must cover every shipped chunk —
partial coverage throws rather than silently shipping some chunks with no semantic-search
vector.

## The printing-id registry is append-only

`printingRegistry.ts`'s `buildPrintingRegistry(printingIds, previous, version)` is the one
function that must never remap an id. A printing that drops out of the corpus is marked
`dead: true` but its `registryId` STAYS assigned forever; a printing that reappears later is
revived at its ORIGINAL id, never reallocated a new one. This is what keeps on-device KNN ids
and catalog/QR references stable across pack updates (§9.5, §12).

## Delta packs and the embedder-version refusal

`deltaPack.ts`'s `buildDeltaPack(from, to)` diffs two snapshots' chunk sets and printing-id sets
and returns `{refused: true, changedEmbedders, reason}` if EITHER embedder's version differs
between `from` and `to` — per §8.8, that always forces a full pack instead. A delta is a generic
diff between any two given snapshots, not restricted to adjacent versions (diffing v1 directly
against v3, skipping v2, is valid and the equivalence property below still holds).

`applyChunkDelta(previousChunks, delta)` reconstructs the "to" chunk set from "from" + delta —
it exists only to prove `delta(from, to)` applied to `from` reproduces `to` exactly (tested in
`knowledge.deltaPack.test.ts` and, end to end through two real `buildFullPack` calls, in
`knowledge.build.test.ts`'s round-trip test).

## Two output files per pack: `manifest.json` and `report.json`

`manifest.json` is exactly `@fab/manifest-schema`'s `KnowledgePackManifest` — the strict,
consumer-facing shape (`retrievalFloor`/`oodThreshold` pinned straight from an APP-022
`CalibrationArtifact`, never hardcoded; `textEmbedderVersion`/`visionEmbedderVersion`;
`indexFiles` with real sha256/size computed over the actually-written bytes).

`report.json` is a richer, non-schema-constrained build record — embedder absence + reason,
registry alive/dead counts — for a human or a later pipeline stage to read. This split exists
because `KnowledgePackManifestSchema`'s fields are fixed (shared with fab-app, §7.11); the
"record honest absence with a reason" requirement doesn't fit that shape without inventing
fields no consumer expects, so it lives in the sibling report file instead.

## Index files: documented rows, not a real `.sqlite` file

Neither this task nor the `pipeline` package adds a native sqlite dependency. The
op-sqlite-backed `SqliteVecStore` is fab-app's own "thin adapter, lands with device wiring"
(§9.7 — already the documented boundary for `fab-app/src/retrieval`'s real implementation). So
`manifestBuilder.ts` writes plain, documented files that carry every row a future importer needs
to populate the real on-device tables:

- `chunks-index.jsonl` — one shipped `Chunk` per line (respecting §7.10 shipping modes — a
  stub-mode source's `text` is the stub marker here, matching what the pack actually ships for
  display/citation).
- `text-vectors.jsonl` — one `{chunkId, vector}` per line (empty file when no text embeddings
  were provided).
- `image-vectors.jsonl` — one `{printingId, vector}` per line, present only when image
  embeddings were provided.
- `printing-registry.json` — the full `PrintingRegistry` (including dead entries).

"sqlite-vec-ready" here means "carries every row the real index needs", not "already sqlite
bytes" — building the actual `.sqlite` file (and populating a `vec0` virtual table) is follow-up
work for whichever lane wires up the on-device import step.

## Boundary conventions (decided up front, per the dev brain's lesson)

- **Empty corpus** (zero chunks, zero printings): a valid pack, not an error — `chunkCount: 0`,
  empty index files, empty registry.
- **Empty delta** (identical `from`/`to` snapshots): a valid, non-refused delta with
  `addedCount: 0`, `changedCount: 0`, empty tombstone arrays.
- **Tombstone of a never-existed id**: cannot occur through this module's API — tombstones are
  always DERIVED by diffing two real snapshots, never hand-authored, so an id absent from both
  sides is simply absent from the tombstone list, never spuriously included.
- **Delta spanning more than one snapshot gap**: valid. A delta is a diff between whichever two
  snapshots the caller passes in; the equivalence property holds regardless of how many
  snapshots occurred in between.
