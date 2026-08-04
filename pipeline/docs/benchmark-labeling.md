# Real-photo benchmark labeling protocol

SPEC-APP.md §8.7(e), APP-025 (issue #137). This is the contract a human
labeler works against when shooting and annotating the real-photo benchmark
that G3's on-device recognition/detection accuracy target is measured
against (§8.7d, §8.7c). It is a stable, versioned contract precisely so
photo-shooting can proceed independently of, and ahead of, the detector/
embedder training work (APP-027/APP-028) that consumes it.

The tooling that validates and versions a labeled set against this protocol
lives in `pipeline/src/benchmark/` (`validate.ts`, `manifest.ts`,
`loadSet.ts`, `cli.ts`) — run `npm run benchmark:manifest` (from
`pipeline/`) to build + validate a manifest from a photos+labels directory.

**Producing the labels themselves**: hand-authoring this JSON is the
tedious, error-prone part this protocol exists to make trustworthy, so use
the labeling tool (issue #258) rather than writing label files by hand:

```bash
cd pipeline
npm run benchmark:label   # starts a local-only server at http://localhost:4173
```

A browser-based corner annotator (`pipeline/src/benchmark-label/`) — no
external network calls, everything reads/writes local disk only. Walks a
photo directory, lets you click each card's 4 corners (clockwise TL/TR/BR/
BL, drag to correct, out-of-bounds clicks explicitly supported for amodal
labeling), searches the local the-fab-cube catalog for the printing
`unique_id` (never auto-picking when a set+collector code resolves to more
than one printing — see catalogSearch.ts), and validates every write through
the EXISTING `validatePhotoLabel` before it touches disk. It also parses the
user's real-photo shooting filename convention (`<SETCODE><NUM>[-U|-1st]-
<sleeved|unsleeved>-<name>-[marvel-]<cf|rf|nf>[-N].ext`) to pre-fill
sleeved/foil tags and the printing search query — visibly, never silently,
so an unparsed filename is flagged rather than guessed at.

## What "hundreds of photos" needs to cover

Per §8.7(e), the benchmark set must cover, across its photos as a whole
(not necessarily every combination on every single photo):

- **Sleeved and unsleeved** cards
- **Foil and non-foil** printings
- **Glare present and absent** (sleeve glare, foil glare, overhead lighting)
- **Both orientations**: portrait and landscape
- **Scene types**: single-card close-ups, field scenes (cards scattered/laid
  out on a surface), and binder scenes (cards in a binder page grid)

A photo may combine several of these (e.g. a foil card, sleeved, with
glare, in a binder scene) — the labeling protocol below records all of them
per-quad, so coverage accounting doesn't require separate photos per
combination.

## Directory layout

Bulk photo content is training-host/artifact-storage-only and is **never
committed to git** (§7.7, like every other bulk dataset artifact in this
pipeline) — it lives under the gitignored `pipeline/out/` tree:

```
pipeline/out/benchmark-photos/
  <scene-type>/<photo-id>.<jpg|jpeg|png|heic|webp>   # the photo itself
  labels/<scene-type>/<photo-id>.json                # its label file
```

The label file's path mirrors the photo's path relative to
`benchmark-photos/`, with the extension replaced by `.json` (e.g.
`field/photo-042.jpg` labels at `labels/field/photo-042.json`). This is
exactly what `loadSet.ts`'s `loadBenchmarkPhotoSet` expects; a photo with no
matching label file is reported (not silently dropped) by both the loader
and the manifest builder.

`<scene-type>` is a labeling convenience for organizing photos, not a
protocol requirement — the manifest is keyed by the label file's own
`sceneType` field, not by directory name.

## Label file schema

One JSON file per photo (types in `pipeline/src/benchmark/types.ts`,
enforced by `validate.ts`'s `validatePhotoLabel`):

```jsonc
{
  "photoId": "photo-042",
  "fileName": "field/photo-042.jpg",
  "sceneType": "field",       // "single" | "field" | "binder"
  "orientation": "landscape", // "portrait" | "landscape"
  "quads": [
    {
      "printingId": "q9B6nmKrdz8HnQnJMpQdc",
      "corners": [
        { "x": 120, "y": 80 },   // top-left
        { "x": 340, "y": 84 },   // top-right
        { "x": 336, "y": 512 },  // bottom-right
        { "x": 116, "y": 508 }   // bottom-left
      ],
      "tags": ["sleeved", "glare"]
    }
  ]
}
```

- **`quads`**: one entry per card visible in the photo. A photo must have
  at least one quad — a photo with zero cards labeled isn't useful
  benchmark data and is rejected by `validatePhotoLabel`.
- **`corners`**: exactly 4 `{x, y}` pixel coordinates, in the photo's
  **native, unrotated pixel space** (not display-rotated), in clockwise
  order starting top-left: TL, TR, BR, BL.
- **`tags`**: zero or more of `sleeved`, `foil`, `glare` — whichever apply
  to that specific card in that specific photo (a photo can mix sleeved and
  unsleeved cards in a field/binder scene; tag per-quad, not per-photo).

### Partially-visible or frame-cropped cards (amodal labeling)

A card whose true extent isn't fully visible in the photo — cropped by the
photo frame edge, or partly hidden behind another card in a field/binder
scene — is still labeled by its full, inferred quad, estimated from
whatever visible edges/perspective cues the photo gives (the **amodal**
convention: label what the card actually occupies, not just the pixels
you can see). Concretely:

- Corner coordinates MAY fall outside the photo's own pixel bounds
  (negative, or beyond width/height) when a card's estimated true edge
  extends past the frame — this is expected, not an error;
  `validatePhotoLabel` deliberately does not bound-check `corners`
  against the photo's dimensions.
- If a card is cropped or occluded so severely that its true extent can't
  be plausibly estimated, leave it unlabeled rather than guessing — a
  missing quad is honest; a fabricated one is not.

This convention matches, rather than diverges from, the synthetic-
composite generator's (APP-026): every pasted card's label quad is the
exact geometric transform of its full source rectangle, regardless of how
much of it a later overlapping card covers or how close it sits to the
canvas edge (see `pipeline/src/composites/geometry.ts`'s doc comment).
Training (synthetic) and eval (real-photo) ground truth need to agree on
this convention, or the detector learns one thing and gets measured
against another.

### `printingId` — which identifier, and why

`printingId` is the-fab-cube's **printing-level `unique_id`** (see
`pipeline/src/images/catalog.ts`'s doc comment), **not**:

- the human-readable set+number print code (e.g. `"MST131"`) — the-fab-cube
  reuses that code across a dual-faced/fusion card's separate name entries
  (e.g. both "Inner Chi" and "A Drop in the Ocean" carry `id: "ENG025"`
  with different images), so it cannot safely identify a single image/print.
- a **registry id** — mapping a labeled photo's printings to registry ids
  is an eval-time concern (APP-025's backlog note explicitly calls this out
  so labeling isn't blocked on APP-085's registry work).

This is the same identifier the printing-image downloader
(`pipeline/src/images/downloader.ts`) uses as its cache key, so a labeled
photo's `printingId` values line up directly with the downloaded catalog
images without any extra mapping step.

## Versioning: the benchmark manifest

`pipeline/src/benchmark/manifest.ts`'s `buildBenchmarkManifest` (wired up
via `benchmark:manifest`) assembles a versioned manifest from a labeled
photo set, mirroring `pipeline/src/dataset/manifest.ts`'s discipline
(§7.7):

- `schemaVersion` (the manifest's own shape) and `labelSchemaVersion` (the
  per-photo label shape) — bumped independently when either changes
- `photoCount`, `countsBySceneType`, `countsByTag` — coverage accounting
  against the "hundreds of photos covering X/Y/Z" requirement above
- Per photo: `photoContentHash` (sha256 of the photo's actual bytes) and
  `labelFileHash` (sha256 of the label file's actual on-disk bytes) — so a
  benchmark-set version is a verifiable, content-addressed snapshot, not
  just a file count
- `skipped`: every photo excluded from the set (missing label file,
  unparseable label JSON, or a label that fails `validatePhotoLabel`) with
  the specific reason — a degraded/incomplete labeling pass is visible in
  the manifest itself, never silently under-counted

The manifest itself is a small JSON file (hashes + counts, no photo bytes)
and is written under the gitignored `pipeline/out/benchmark/` by default —
same convention as every other manifest this pipeline produces
(`dataset:build`, `qa:generate`, `qa:sample`, `behavior:build` all write
their manifests under `pipeline/out/**` too). The bulk photos it describes
never leave `pipeline/out/benchmark-photos/` / artifact storage.

## Validating a labeled batch

```bash
cd pipeline
npm run benchmark:manifest -- --photos-dir /path/to/photos --labels-dir /path/to/labels --out /path/to/manifest.json
```

Run this after labeling a batch of photos to catch malformed label files
(bad JSON, wrong scene type, wrong number of corners, unknown tag, missing
`printingId`, etc.) before they're relied on for G3 measurement — every
rejection names the specific field and photo, per `validatePhotoLabel`'s
"report every violation" contract.

## Non-goals (out of scope here)

- **Registry-id mapping** — labels carry `printingId` only; mapping to
  registry ids is an eval-time concern (APP-085), not a labeling concern.
- **Synthetic composites** — this document is the *real*-photo benchmark
  protocol only; the synthetic-composite generator (APP-026) is unrelated,
  separately-scoped tooling for training data, not benchmark data.
- **The actual photo set** — this PR ships the builder/protocol only; the
  hundreds of real photos are shot and labeled by the user against this
  contract as a separate, user-gated QA-stage step.
