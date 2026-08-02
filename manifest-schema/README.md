# @fab/manifest-schema

Shared manifest/compatibility schema for the FAB app ecosystem (SPEC-APP.md §7.11): the single
place that defines the shape of the corpus snapshot manifest, model pack manifest, knowledge pack
manifest, delta pack manifest, and revocation list — so `pipeline/` (producer) and `fab-app`
(consumer) validate against the exact same schema, and no lane invents its own manifest shape.

Built with [zod](https://zod.dev) (pure JS, no native dependencies — safe for both a Node
pipeline and a React Native app).

## Schemas

- `CorpusSnapshotManifestSchema` — mirrors `pipeline/src/types.ts`'s `CorpusSnapshotManifest`.
  Every source entry REQUIRES `shippingMode` (`"verbatim" | "paraphrase" | "stub"`, §7.10) and
  `skipped` (a count, always present even when zero); `note` is optional.
- `ModelPackManifestSchema` — each artifact REQUIRES `licenseId`: a bare SPDX identifier (e.g.
  `"MIT"`, `"Apache-2.0"`, `"GPL-3.0-only"`), format-checked against the SPDX identifier character
  set and rejected if it's a known placeholder (`"TODO"`, `"TBD"`, etc.) or contains free text/
  spaces — full SPDX license-expression grammar (AND/OR/WITH) and membership in the real SPDX
  license list are out of scope for v0.1.0. Also: `tier` (`"1.7B" | "0.6B"`), embedder/detector
  versions, `compatibleKnowledgePacks` (a semver range), `appMinVersion`, and `corpusSnapshotHash`.
- `KnowledgePackManifestSchema` — REQUIRES `retrievalFloor` (§9.7's calibrated
  retrieval-confidence abstention floor) and `oodThreshold` (§10.9's calibrated OOD fast-path
  threshold); both are runtime-calibrated values, never hardcoded or defaulted by the schema.
- `DeltaPackManifestSchema` — REQUIRES a `tombstones: { chunkIds[], printingIds[] }` field (may be
  empty arrays, but must be present). Encodes §8.8's invariant directly: a delta whose
  `fromTextEmbedderVersion`/`toTextEmbedderVersion` (or the vision-embedder pair) differ fails
  validation, attributed to the specific `to*EmbedderVersion` field that changed — either embedder
  changing forces a full pack, never a delta.
- `RevocationListSchema` — `revokedVersions: { artifact, version, reason }[]` (§9.5).

Every schema requires a non-empty `schemaVersion` string.

## Validation helpers

Each schema has a `validate<Type>Manifest(input: unknown)` function returning
`{ success: true, data }` or `{ success: false, errors: { path, message }[] }` — a plain,
zod-shape-agnostic result with precise error paths (e.g. `["sources", 0, "shippingMode"]`).

```ts
import { validateKnowledgePackManifest } from "@fab/manifest-schema";

const result = validateKnowledgePackManifest(parsedJson);
if (!result.success) {
  console.error(result.errors); // [{ path: ["retrievalFloor"], message: "..." }]
}
```

## Fixtures

Exported for consumer tests — one valid fixture per manifest type, plus the invalid fixtures
called out in APP-016's AC:

- `validCorpusSnapshotManifest` / `invalidCorpusSnapshotManifestMissingShippingMode`
- `validModelPackManifest` / `invalidModelPackManifestMissingLicenseId` /
  `invalidModelPackManifestBadLicenseId`
- `validKnowledgePackManifest` / `invalidKnowledgePackManifestMissingRetrievalFloor` /
  `invalidKnowledgePackManifestMissingOodThreshold`
- `validDeltaPackManifest` / `tombstonedDeltaPackManifest` /
  `invalidDeltaPackManifestMismatchedEmbedder`
- `validRevocationList` / `emptyRevocationList`

## Consumers

- **pipeline/** (producer): `pipeline/test/manifest-schema-alignment.test.ts` validates
  `runExport()`'s real emitted corpus snapshot manifest against `CorpusSnapshotManifestSchema` —
  proof the producer's actual output stays aligned with the shared schema.
  `pipeline/src/manifest.ts` itself is not yet refactored to import this package directly (its own
  local `SCHEMA_VERSION` constant and hand-typed `CorpusSnapshotManifest` interface in
  `pipeline/src/types.ts` remain the emit-side source of truth for now) — that refactor is
  follow-up work, kept out of this task to avoid conflicting with a parallel lane actively editing
  `pipeline/src`.
- **fab-app** (consumer): not yet wired up. Deferred to APP-031/APP-032 (artifact
  manager/compatibility-check work), which will import `validateModelPackManifest`,
  `validateKnowledgePackManifest`, etc. directly per §9.3.
