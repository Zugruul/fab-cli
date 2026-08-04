# Pack assembly + publish (SPEC-APP.md §8.8, §8.9, §7.10 — APP-029, issue #141)

Turns real producer output (APP-021's export chain, APP-027/028's train-vision chains,
APP-085's knowledge-pack builder) into the versioned release bundles fab-app's artifact manager
(APP-031) downloads from — model packs per tier and knowledge packs (full + delta), with
manifests, checksums, and a documented GitHub Release layout. This module is **assembly +
publish machinery, proven by dry-run with schema validation and real fixture bundles** — it does
not itself train models or claim any particular release is production-ready; see the scope note
at the bottom.

```bash
npm run publish:dry-run -- --release-version 1.0.0 --config path/to/artifact-map.json
npm run publish:release -- --release-version 1.0.0 --yes            # real gh release, guarded
npm run publish:release -- --release-version 1.0.0 --yes --force    # re-upload an existing tag
```

## Versioned release layout

GitHub Release assets are a **flat namespace** — no subdirectories — so every asset name is a
single string encoding what it is:

| Bundle | Asset name pattern | Example |
|---|---|---|
| Model pack | `model-<tier>-<file>` | `model-1.7B-fab-slm-1.7b-q4_k_m.gguf`, `model-1.7B-manifest.json` |
| Knowledge full pack | `knowledge-full-<version>-<file>` | `knowledge-full-1.0.0-chunks-index.jsonl` |
| Knowledge delta pack | `knowledge-delta-<from>-to-<to>-<file>` | `knowledge-delta-1.0.0-to-1.1.0-manifest.json` |

Release tag: `pack-<releaseVersion>` (e.g. `pack-1.0.0`). Every release also carries a flat
`checksums.txt` (SHA256SUMS format: `<sha256>  <assetName>` per line, sorted by name) and a
`release-manifest.json` — the exact plan of what was/would be uploaded (asset name, local path,
sha256, size, kind, label).

Model-pack asset naming takes **no release-version argument** — it's a pure function of
`(tier, fileBaseName)` (see `releaseLayout.ts`). This is deliberate: the app-side artifact
manager (`fab-app/src/artifacts/manager.ts`'s `FullPackDownloadRequest.files`) needs a per-file
download URL it can re-derive per release without a separate index lookup, so the URL SHAPE
stays predictable across releases that happen to reuse the same underlying artifact.

**This is a URL-addressing convenience only — it is NEVER a content-identity guarantee.** A
repeated asset name across two releases is not evidence the bytes behind it are the same (a
re-quantized GGUF, a fixed tflite, or any bug-fix re-export can legitimately reuse the same
`(tier, fileBaseName)` pair while shipping different content). `fab-app`'s artifact manager
(`AtomicInstaller.install`, §9.2) already enforces the only safe rule here — every download is
SHA-256-verified against the manifest's `sha256` field before it's ever installed, name reuse or
not — and nothing in this module's naming convention should be read as relaxing that. Name
stability exists so a URL can be re-derived, not so a checksum check can be skipped.

## `dry-run`: never touches the network

Reads a JSON artifact-map config (shape: `Omit<BuildReleasePlanInput, "releaseVersion" | "outDir">`
from `types.ts` — model-pack artifact maps per tier, an optional knowledge-full builder input,
an optional knowledge-delta `{from, to}` snapshot pair, and the raw corpus-snapshot-manifest JSON
the §7.10 shipping-mode precondition is checked against), runs `buildReleasePlan`, and writes the
**complete flat bundle tree** — every real file, named exactly as it would be uploaded — plus
`checksums.txt` and `release-manifest.json` under `pipeline/out/publish/<releaseVersion>/`
(gitignored, regenerable, never committed — see `noCommitGuard.test.ts`).

### Boundary conventions (decided up front)

- **Partial-tier publishing is supported.** A model-pack tier whose artifact map is incomplete
  (e.g. the vision embedder tflite hasn't been produced yet) is reported as
  `{tier, status: "failed", error}` and simply excluded from the bundle — it does not abort tiers
  that DID assemble. Shipping only the 0.6B tier while 1.7B isn't ready is expected, not a bug.
- **The §7.10 shipping-mode precondition and the outDir-reuse check both run BEFORE any
  assembly is attempted.** A failure here writes zero bytes anywhere.
- **Re-publishing the same `outDir` (or, for the real publish path, the same release tag) is
  refused by default.** Pass `force` to knowingly overwrite — release immutability by default,
  matching SPEC-APP.md §14's "corrupted artifacts detected... revoked versions disabled"
  reliability posture: nothing should silently replace what a device may have already fetched.
- **Cross-pack embedder-version check runs at publish time, not just load time.** No single
  manifest schema enforces that a jointly-published model pack and knowledge pack were built
  against the same text/vision embedder — `fab-app`'s `checkModelKnowledgeCompatibility` (§9.3)
  only discovers a mismatch when a device tries to load the pair, which is too late for a publish
  that already shipped a broken combination. `releasePlan.ts` checks it here instead and refuses
  the WHOLE plan (writing nothing) on a mismatch — except when the knowledge side honestly has NO
  embeddings of that kind yet (the `NO_TEXT_EMBEDDER_VERSION`/`NO_VISION_EMBEDDER_VERSION`
  sentinels from `knowledge/textEmbeddingsInput.ts` / `imageEmbeddingsInput.ts`), since an absent
  embedder has no version to disagree with the model pack about.

## `publish`: the real path, gh-CLI-based, guarded

Re-reads the dry-run's `release-manifest.json` and uploads it via `gh release create --draft
--prerelease` + `gh release upload` (an injectable `CommandRunner` in `ghRelease.ts` — never
touches the network in tests). Requires `--yes` explicitly; never defaults to true. Draft +
prerelease by default so a real publish is reversible/invisible until a human promotes it.
Re-publishing an existing tag is refused unless `--force` (which re-uploads with `--clobber`).

## Checksums

Every asset's sha256 is computed from the **real file bytes on disk** at assembly time — never
trusted from a caller-supplied or producer-recorded checksum (`modelPackAssembler.ts`,
`knowledgePackAssembler.ts`). `checksums.txt`'s `<sha256>  <assetName>` lines are the same
values recorded in each pack's own `manifest.json` (`ModelPackArtifact.sha256` /
`KnowledgePackIndexFile.sha256`) — the flat file exists for tooling/humans that want to verify a
downloaded asset without parsing the schema-shaped manifest.

## Scope note (recorded honestly, per the task brief)

As of this task, several real inputs don't exist at production scale yet:

- The merged + quantized LLM GGUF (APP-021's export chain) is real and runnable, but no
  production-scale run had completed at the time this module was written.
- The detector and vision-embedder tflites (APP-027/028) exist only as toy-scale, QA-gated smoke
  outputs — real-photo-benchmark accuracy hasn't been measured yet.
- The text embedder has **no local producer at all** in this repo (bge-small-en-v1.5 conversion
  happens out-of-repo) — see `knowledge/README.md`'s "input contract, not something this builder
  computes" section.

This module's deliverable is the assembly + publish MACHINERY: given real files (of whatever
scale), it assembles schema-valid packs, enforces every invariant above, and can genuinely
publish a draft/prerelease GitHub Release. It is proven here via unit tests against fixture files
clearly labeled as fixtures (never published, never presented as real models) plus a manual
dry-run + a real draft-release mechanism test against this repo (recorded in the PR description)
— not by claiming any specific release is production-ready.
