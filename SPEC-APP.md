# FAB Companion App Spec — on-device SLM Q&A, card scanning, catalog + QR

## §1 Overview

A React Native mobile app (iOS first, Android later) for Flesh & Blood players: ask any FAB
rules/keyword/interaction/lore/card question and get a fast, precise, **cited** answer computed
entirely on-device by a small fine-tuned language model grounded in the project's curated
knowledge corpus (judge/player/card-vault brains + rules KB); identify cards with the camera
(single card, whole play field, binder page); and keep a versioned catalog of owned cards
shareable offline via QR. The game evolves continuously (new sets, errata, CR revisions, ban
list), so every knowledge artifact — model, adapters, indexes — is versioned and updatable
out-of-band from app releases. Distribution: TestFlight first, public App Store later; all
licensing decisions target a public release, verified by an explicit per-source rights
assessment (§7.10) rather than assumed.

Research basis: three rounds of research (6 reports) consolidated during spec crafting; key
findings are recorded inline as decisions with a one-line why.

## §2 Goals

- **G1** Answer FAB questions on-device in two visible stages: lexical retrieval hits render
  < 100 ms after submit (semantic hits merge in as the query embedding completes); the
  composed, cited SLM answer starts streaming within the tier's TTFT target (§14) at the
  specified retrieval token budget.
- **G2** Answers are grounded and cited: every game-fact claim traces to a retrieved corpus
  chunk. Enforcement is two-layered: at runtime, citation-id membership in the actually-
  retrieved set is validated (§10.3); at eval time, the citation-validity suite checks the
  cited chunk actually supports the answer (§8.4). The app never shows an uncited answer.
- **G3** Scan accuracy: ≥ 95% top-1 printing identification on the **real-photo benchmark**
  (§8.7: sleeved/foil/glare/both-orientation photos, not synthetic crops); field/binder photos
  identify all sufficiently-visible cards with per-card confidence and one-tap correction.
- **G4** Catalog + share: record owned cards (printing + finish + qty, optional condition/
  notes); share the current catalog version to another device fully offline via QR (single or
  animated multi-part), or via the OS share sheet.
- **G5** Versioned evolution: a new FAB set, erratum, or ruling retraction reaches users as a
  downloadable index delta (additions, changes, **and deletions**) without retraining or an
  App Store review cycle; the app always displays "knowledge up to" provenance.
- **G6** The whole training pipeline (corpus export → dataset → train → quantize → eval →
  release) runs reproducibly on the user's own hardware (RTX 5090 24 GB VRAM notebook; 192
  GB-RAM machine; Mac/MLX optional) from committed manifests.

## §3 Non-goals

- **NG1** Deck building/editing, matchup analysis UIs, or any fabrary.net account features in
  the app (the CLI keeps owning those).
- **NG2** In-app price/marketplace features (price-comparison stays CLI-only).
- **NG3** Trading, social, or multiplayer features; hosted collection-share URLs (deferred —
  privacy; QR/AirDrop only in v1).
- **NG4** Talishar or any game-playing integration.
- **NG5** Languages other than English (corpus is English-only).
- **NG6** Apple Foundation Models framework as the answer engine (closed fixed base model;
  Apple discourages factual-recall use; can't host our fine-tune).
- **NG7** Android ship in v1: the RN codebase stays Android-viable (no iOS-only architecture
  without an Android counterpart named), but Android bring-up is a dedicated post-v1 epic
  (§16 Q7) — v1 builds, tests, and ships iOS only.
- **NG8** Server-side inference or accounts of any kind. A static artifact host (GitHub
  Releases) is the only remote dependency besides existing live legality/CDN image fetches.
- **NG9** Any other card game's content, ever (inherited hard rule).
- **NG10** In-app model training/fine-tuning on device; devices only run inference.
- **NG11** Manifest cryptographic signing in v1 — artifact integrity is SHA-256 checksums
  fetched over HTTPS from the pinned host (§9.2); signing is a revisit-at-App-Store item
  (§16 Q8).

## §4 Glossary / domain

| Term | Meaning |
|---|---|
| Corpus | The FAB knowledge sources: judge brain (~619 notes), card-vault brain (~5,052 card notes), player brain (~288 notes), rules KB chunks (CR/TRP/PPG/CPG/Rules Reprise), lore OKF pages (~394). One chunk = one retrievable, citable unit with a stable `chunk_id`. |
| Corpus snapshot | An immutable, hashed export of the corpus at a point in time, stamped with CR version, latest set code, and legality-policy fetch date. |
| Chunk | Normalized retrieval unit derived from a corpus note/page: id, text, title, source citation (CR §/URL), typed links to other chunks, tags. |
| Knowledge pack | Versioned downloadable artifact bundle: text index (chunks + embeddings), image index (printing embeddings), printing-id registry, manifest. |
| Model pack | Versioned downloadable artifact bundle: merged fine-tuned GGUF (quantized) per tier, embedder GGUF, detector model file, manifest. |
| Manifest | JSON pinning artifact versions, SHA-256 checksums, per-artifact license identifiers, compatibility (embedder version ↔ index version, model ↔ app min-version), revoked-versions list, and corpus snapshot provenance. Integrity = checksums over HTTPS (NG11). |
| Printing-id registry | Append-only mapping printing → stable dense integer id, versioned inside the knowledge pack; the shared namespace for image-index vectors and catalog/QR encoding. |
| Delta pack | Diff between two knowledge-pack versions: added + changed chunks/vectors **and tombstones** (removed chunk_ids / printing ids). |
| Two-stage answer | Stage 1: retrieval hits rendered as result cards (lexical instantly, semantic merged when embedded). Stage 2: SLM-composed cited answer streamed below them. |
| Abstention | The SLM (or gating layer) declining to answer, with the judge-Discord escalation pointer — the REQUIRED outcome when grounding is insufficient. |
| Printing | A specific physical card release (card + set/edition + art/finish variant), the unit of scanning recognition and catalog entries. |
| Finish | Physical treatment of a printing copy: regular, rainbow foil, cold foil, etc. |
| Catalog | The user's owned-card collection: entries of (printing, finish, qty, optional condition/notes), versioned monotonically with a content hash. |
| BC-UR | Blockchain Commons Uniform Resources: CBOR payload, fountain-coded animated multi-part QR encoding (`@ngraveio/bc-ur`). |
| OBB | Oriented bounding box (rotated quad) — detector output enabling perspective rectification. |
| Tier | The model size a device runs: 1.7B on ≥6 GB RAM devices, 0.6B otherwise. Both tiers are first-class shipped experiences with their own performance targets (§14). |

Relationships: a card has 1:N printings; a catalog entry references exactly one printing (by
registry id); a chunk cites exactly one source document/section but links N:N to other chunks;
a knowledge pack is built from exactly one corpus snapshot; a model pack is compatible with ≥1
knowledge pack versions as declared in manifests.

## §5 Architecture

Monorepo (pnpm workspaces, patterned on `~/Development/monorepo`, the event-sorcerer monorepo —
load-bearing choices: root `pnpm-workspace.yaml` with explicit package globs, a private root
`package.json` whose scripts fan out via `pnpm -r`, and a root `gate` script delegating to each
package's gate):

```
<root>/                      — monorepo root: pnpm-workspace.yaml, private root package.json,
                               .claude/project.yaml (single board), SPEC-*.md, docs/
  fab-cli/                   — the existing CLI, moved wholesale (own package.json, submodules)
  fab-app/                   — the React Native app (this spec's product)
  pipeline/                  — training + artifact pipeline (corpus export, dataset gen,
                               train/eval/quantize scripts, index builders, release packaging)
  .claude/identities/        — FAB knowledge brains shared at root (judge, player, card-vault
                               + kw-* corpus); dev-side brains stay per-subproject
```

Technology decisions (each with the deciding reason):

- **llama.rn** (llama.cpp binding) is the app's single inference runtime — the only RN runtime
  covering the full pipeline today: GGUF embedding models, GBNF/JSON-schema token-level
  constrained decoding, and disk-persistable KV sessions (react-native-executorch lacks
  constrained decoding, adapter loading, session persistence).
- **Qwen3 1.7B** (primary tier) and **Qwen3 0.6B** (4 GB-device tier) as base models — Apache
  2.0 (App-Store-clean, no attribution/flow-down obligations), strong instruction-following,
  mature Unsloth/llama.cpp toolchain. Facts are NOT baked in; the fine-tune teaches behavior
  (read-cite-abstain) only. Training and inference run with Qwen3 thinking mode disabled
  (grammar-constrained JSON + temperature-0 eval interact badly with think tokens).
- **Model updates ship as full merged GGUFs per release**, not runtime LoRA hot-swap — llama.rn
  adapter hot-swap has documented defects (double-apply at init, handle leak on swap; upstream
  issue #321); the LoRA adapter remains a pipeline artifact for training continuity but is
  merged before packaging. Revisit if upstream fixes land (§16 Q9).
- **bge-small-en-v1.5 (MIT)** as default text embedder — license-clean for redistribution;
  **EmbeddingGemma-300M** is the benchmarked alternative and may only be adopted by explicitly
  accepting the Gemma Terms of Use (use-restriction flow-down) and recording them in §14's
  notices (the same terms that disqualified Gemma as base model must not ship silently).
- **op-sqlite + sqlite-vec** for all on-device vector + structured storage — brute-force KNN
  is sub-10 ms at our scale (~6.4k text chunks, ~10k image vectors); one DB for text index,
  image index, and catalog.
- **react-native-vision-camera** (frame processors, CodeScanner) + **react-native-fast-tflite**
  (Core ML/ANE delegate on iOS, GPU delegate on Android) for the vision pipeline — fast-tflite
  models are runtime-swappable files, fitting the versioned-artifact channel.
- **Apache/MIT-licensed OBB detector** trained on synthetic composites — candidates: RT-DETR
  variants (Apache 2.0), YOLOX-derived rotated heads (Apache 2.0), or a plain
  CenterNet/SSD-style head with quad regression. **Ultralytics YOLO11 is excluded: AGPL-3.0**
  (code and trainer-produced weights) violates Invariant 9 for a shipped artifact. The
  detector choice is finalized in APP-027 within this license constraint.
- **MobileNetV3-class metric-learned embedder** (ArcFace) for recognition — the industry-
  converged card-ID architecture; new sets append vectors with zero retraining.
- **BC-UR (`@ngraveio/bc-ur`) + react-native-qrcode-svg** for offline catalog QR share —
  fountain coding makes dropped frames free in screen-to-screen scanning.
- **Unsloth (QLoRA) on local CUDA (RTX 5090)** for training; **TRL** for SFT/DPO; **Claude
  API** as distillation teacher; **llama.cpp `convert_hf_to_gguf.py` + `llama-quantize`** for
  export. MLX on Mac is a supported alternative path, not the primary.
- **Retrieval design mirrors the brain recall engine** (hybrid seeding + link expansion +
  ranked budget): lexical/exact-match seeds ∪ top-K embedding neighbors → bounded-hop
  spreading over typed chunk links → activation-ranked context assembly. This is the proven
  in-house pattern (brain.py `recall`), reimplemented on-device in TypeScript.

Data flow (Q&A): query → lexical match (instant) + embed (llama.rn ctx B) → sqlite-vec KNN →
link expansion → ranked chunks within the retrieval token budget (§14) → Stage 1 UI render →
prompt assembly → llama.rn ctx A generation under JSON-schema grammar → citation validation →
Stage 2 streamed answer (or abstention).

Data flow (scan): camera frame/photo → OBB detector (fast-tflite) → per-quad perspective
rectification → embedder (fast-tflite) → sqlite-vec KNN over printing vectors → margin gate
(+ Vision OCR title tiebreaker) → results UI → (optional) catalog add.

## §6 Monorepo restructure (E0)

- **6.1** THE SYSTEM SHALL restructure the repository into a pnpm-workspaces monorepo with
  root `pnpm-workspace.yaml`, a private root `package.json` exposing `pnpm -r` scripts and a
  root `gate` script, and workspace packages `fab-cli`, `fab-app`, and `pipeline` (the latter
  two may start as stubs), following the base pattern in §5.
- **6.2** WHEN the restructure lands THE SYSTEM SHALL preserve all existing fab-cli behavior:
  `npm i -g ./fab-cli --force` installs the CLI, `bin/fab.js` + tsx still runs with no build
  step, git submodules resolve under `fab-cli/third_party/`, and the full existing gate passes
  green in the new layout.
- **6.3** THE SYSTEM SHALL move the FAB knowledge brains (judge, player, card-vault, including
  the shared kw-* keyword corpus and its symlinks) to root `.claude/identities/`; dev-side
  brains (dev, reviewer, orchestrator, talishar, assistant) SHALL likewise remain at the
  monorepo root's `.claude/identities/` rather than relocating under any individual package,
  since they serve the monorepo-level build loop (single board, single orchestrator) rather
  than one subproject; scripts whose relative paths the move breaks (`keyword-sync.py`,
  `backfill-entities.py`, `build-card-vault.py`, entity-index tooling) SHALL be updated in the
  same change, and `python3 fab-cli/scripts/keyword-sync.py check` SHALL pass when invoked from
  the monorepo root after the move.
- **6.4** THE SYSTEM SHALL keep a single GitHub Project board: `.claude/project.yaml` stays at
  root with existing `specs[]` entries' `specPath`/`backlogPath` updated to `fab-cli/`-
  prefixed paths, and `board.sh config` SHALL validate.
- **6.5** IF any step of the restructure would lose git history for moved files THEN THE
  SYSTEM SHALL use history-preserving moves (`git mv`) rather than delete+add.
- **6.6** WHEN the restructure is complete THE SYSTEM SHALL demonstrate brain recall
  (`brain.sh recall`) and entity-index tooling working against the new root brain paths.
- **6.7** THE SYSTEM SHALL resolve the repository's licensing inconsistency (LICENSE.md is
  GPL-3.0 while package.json declares ISC) as part of the restructure: per-package `license`
  fields and LICENSE files, with `fab-app` and `pipeline` under an App-Store-compatible
  permissive license (default MIT — §16 Q10; GPL-3.0 is incompatible with App Store
  distribution once third-party contributions exist). Because `fab-cli` remains GPL-3.0-only
  (§16 Q10) while `fab-app` and `pipeline` are MIT and App-Store-bound, `fab-app` and
  `pipeline` SHALL NEVER declare a workspace dependency on `fab-cli`, nor import its source,
  in any package.json dependency field or application code. Any interaction between them
  SHALL be process-boundary only (spawning the CLI as a subprocess) or via shared data files —
  never a code-level dependency that would pull GPL-3.0-licensed code into an MIT-licensed,
  App-Store-distributed binary. This is enforced structurally by `scripts/workspace.test.mjs`,
  which asserts neither `fab-app/package.json` nor `pipeline/package.json` lists `fab-cli` in
  any dependency field (keys or values).

## §7 Corpus → dataset pipeline (E1)

- **7.1** THE SYSTEM SHALL provide a sanctioned corpus exporter in `pipeline/` that reads the
  FAB knowledge brains (via the brain machinery or a build-time bypass approved for pipeline
  use — never ad-hoc direct reads from agent sessions), rules KB chunks, and lore pages, and
  emits a normalized chunk set: `{chunk_id, text, title, source, links[], tags[]}` with stable
  ids across re-exports of unchanged notes.
- **7.2** WHEN the exporter runs THE SYSTEM SHALL stamp the output as a corpus snapshot:
  content hash, CR version + document versions (from VERSIONS.txt), latest set code, lore
  commit, and export date, written to a committed manifest.
- **7.3** THE SYSTEM SHALL generate grounded Q&A training pairs per chunk using a teacher
  model (Claude API): questions in diverse phrasings, answers that cite the chunk's
  `chunk_id`(s) and stay within the chunk text; generation prompts and parameters live in
  committed config.
- **7.4** WHEN candidate pairs are generated THE SYSTEM SHALL reject-sample them: each answer
  is entailment-checked against its source chunk (teacher-as-judge or NLI check), and
  non-entailed answers are discarded; the acceptance rate is logged per run.
- **7.5** THE SYSTEM SHALL generate behavior-training data beyond plain Q&A: (a) retrieval-
  robustness examples where the prompt includes distractor/irrelevant chunks and the target
  answer uses only the relevant ones; (b) abstention examples where provided chunks do NOT
  answer the question and the target output is the structured abstention; (c) out-of-domain
  refusals (non-FAB questions, other card games) with broad phrasing coverage.
- **7.6** THE SYSTEM SHALL construct DPO preference pairs preferring cited/hedged answers over
  confident-uncited or fact-embellished ones, derived from rejected samples and teacher
  contrastive generations.
- **7.7** THE SYSTEM SHALL version datasets: each dataset build is pinned to its corpus
  snapshot and generation config hash; a dataset manifest (counts per category, acceptance
  rates, teacher model id) is committed, while bulk data files stay out of git (artifact
  storage).
- **7.8** THE SYSTEM SHALL hold out an eval split at build time, stratified by category
  (keyword definitions, card facts, multi-card interactions, tournament procedure, lore,
  abstention, OOD), disjoint from training by source chunk where the category allows.
- **7.9** IF a chunk's source is the live legality policy or ban list THEN THE SYSTEM SHALL
  exclude it from SFT fact-training data entirely (legality is never learned into weights) and
  include it only in retrieval-robustness examples marked as time-sensitive.
- **7.10** THE SYSTEM SHALL perform and record a per-source redistribution-rights assessment
  before any knowledge pack is published: for each corpus source (LSS rules documents, Card
  Vault true text, own-authored brain notes, legendarystories.net lore prose) the assessment
  records the applicable policy/permission and the shipping mode — verbatim chunk, paraphrase
  chunk, or **retrieval stub** (title + tags + `source_url`, full text fetched on demand and
  cached, mirroring Invariant 6's image pattern). Default pending assessment: lore prose ships
  as stubs; own-authored notes ship verbatim. The outcome is recorded per source in the corpus
  snapshot manifest, and the exporter SHALL enforce the recorded mode. Stub-mode runtime
  semantics: stub chunks' embeddings are computed from the FULL text at pack-build time (so
  semantic retrieval is unimpaired); stub chunks are always Stage-1-eligible (title + source
  card); they are Stage-2-groundable only when their full text is cached on device — retrieval
  of a stub chunk triggers a background text fetch when online; IF a needed stub chunk's text
  is uncached and the device offline THEN the Stage-2 answer follows the abstention path
  (§10.4) with the Stage-1 card still shown, using a cause-specific message ("source text not
  yet downloaded — connect to fetch") rather than the rules-ambiguity judge-escalation text. The §8.4 lore suite SHALL be evaluated in the
  stub-runtime configuration (what actually ships), not only against full text.
- **7.11** THE SYSTEM SHALL define the manifest and compatibility schema (model pack,
  knowledge pack, delta pack, corpus snapshot; including per-artifact license identifiers and
  the revoked-versions list) as a versioned shared package consumed by both `pipeline/`
  (producer) and `fab-app` (consumer), with schema-validation helpers and fixtures — no lane
  invents its own manifest shape.

## §8 Model training, export & evaluation (E2)

- **8.1** THE SYSTEM SHALL fine-tune Qwen3 1.7B and Qwen3 0.6B via QLoRA (Unsloth) on the E1
  dataset: SFT then DPO, thinking mode disabled, with all hyperparameters, seeds, base-model
  hashes, **and a training-environment capture (dependency lockfile hash, CUDA/driver
  versions)** recorded in a committed training manifest per run; runs execute on local
  hardware (CUDA primary, MLX supported).
- **8.2** WHEN a training run completes THE SYSTEM SHALL export a merged GGUF per tier,
  quantize (Q4_K_M primary; Q8_0 reference), and smoke-test each artifact in llama.cpp
  (load + one JSON-schema-constrained completion) before it is eligible for packaging; the
  unmerged LoRA adapter is retained as a pipeline artifact but is not shipped (§5).
- **8.3** THE SYSTEM SHALL build the eval harness scoring each eval item into a trichotomy —
  correct / incorrect / abstained — with asymmetric penalties (incorrect ≫ abstain), using
  rubric-based LLM-judge grading (rubrics derived from source-chunk claims) for open answers
  and exact-match for canonical items (keyword definitions, numeric card stats).
- **8.4** THE SYSTEM SHALL include eval suites for: adjudication-critical rules categories,
  multi-card interactions, lore, citation validity (cited chunk actually supports the answer),
  abstention quality (abstains when chunks insufficient), OOD rejection, retrieval-robustness
  (distractor resistance), **and a human-authored adjudication suite** — questions and
  expected rulings transcribed from independent sources (e.g. #ask-a-judge answers, Rules
  Reprise worked examples), NOT teacher-generated, present from the first release as the
  anti-circularity control. "Adjudication-critical rules categories" (BUG-186, resolved
  2026-08-02) is a curated subset of §7.8's chunk-grounded content, distinct from — and
  narrower than — the "multi-card interactions" eval suite named separately in this same
  list. An eval example qualifies only when its grounding chunk_id matches `rules/cr/**`
  (Comprehensive Rules sections; TRP/PPG/CPG/legality are tournament procedure, not
  adjudication) or a brain note documenting a specific card-interaction ruling
  (`ci-`/`ruling-`/`interaction-` slug, or an `"interaction"` tag, identity-agnostic — e.g.
  judge's `ci-*` convention, or an equivalently tagged card-vault note). Explicitly
  EXCLUDED: Rules Reprise articles (`rules/reprise/**` — LSS's worked-example commentary,
  not the rules text itself), undifferentiated brain rulings/strategy notes with no matching
  slug/tag (categorize.ts's fallback bucket), lore, and keyword-definition notes
  (`kw-*`/`"keyword"`-tagged — adjudication-relevant but already covered by this section's
  separate exact-match "keyword definitions" suite; including them here too would
  double-count the same content). Mechanically implemented as
  `pipeline/src/dataset/adjudication.ts`'s `isAdjudicationCritical(chunkId, tags)`, exported
  for APP-022's eval harness and precomputed as an `adjudicationCritical` flag on every
  assembled dataset example (`pipeline/src/dataset/types.ts`) so the harness never has to
  re-derive it.
- **8.5** IF a candidate model, on any suite, (a) scores incorrect above the configured
  near-zero threshold on adjudication-critical categories, (b) scores **below the configured
  per-suite minimum-correct (coverage) floor** — so an always-abstaining model fails — or
  (c) regresses vs the previous released version THEN THE SYSTEM SHALL fail the release gate;
  for major versions a human-audited sample review is additionally required before release.
- **8.6** THE SYSTEM SHALL benchmark on-device performance for **both tiers** on their floor
  devices (§14): decode tokens/sec, **prefill tokens/sec at the specified retrieval token
  budget**, time-to-first-token warm/cold, query-embedding latency, and RAM peak — recorded in
  the release manifest. WHEN measured prefill throughput cannot meet the TTFT target at the
  configured budget THE SYSTEM SHALL apply the fallback ladder (§10.2) and record the
  resulting configuration, rather than shipping an unmet target.
- **8.7** THE SYSTEM SHALL produce the vision models within Invariant 9's license constraint
  (§5): (a) a printing-image dataset builder that downloads catalog images to the training
  host with rate limiting and caching, never committing images to git (training-time use only,
  per §14 licensing); (b) a synthetic-composite generator (backgrounds, overlap, rotation,
  perspective, lighting/glare/sleeve augmentation); (c) detector training + export; (d)
  ArcFace embedder training + export; and (e) a **real-photo labeled benchmark** (hundreds of
  photos covering sleeves, foils, glare, both orientations, field and binder scenes) on which
  G3's accuracy target is measured. Both models export to fast-tflite-loadable files with the
  same manifest discipline.
- **8.8** THE SYSTEM SHALL build knowledge-pack artifacts: text-chunk embeddings (embedder-
  version-pinned), image printing embeddings, the printing-id registry, sqlite-vec-ready index
  files, and delta packs between consecutive corpus snapshots carrying additions, changes,
  **and tombstones** (removed chunk_ids and printing ids). IF the version of EITHER embedder
  (text embedder or image/recognition embedder) changes between snapshots THEN delta packs
  SHALL be refused by the builder and a full pack forced.
- **8.9** THE SYSTEM SHALL assemble and publish release bundles: model packs (per tier) and
  knowledge packs (full + delta) with their manifests, uploaded to the artifact host (default
  GitHub Releases) under a documented versioned layout by a repeatable publish script; device
  tests elsewhere in this spec consume artifacts from this channel, not hand-copied files.

## §9 App foundation & artifact versioning (E3)

- **9.1** THE SYSTEM SHALL scaffold `fab-app` as a React Native (TypeScript) iOS-first app in
  the monorepo with llama.rn, op-sqlite (+sqlite-vec), react-native-vision-camera, and
  react-native-fast-tflite integrated and passing a device smoke test on the floor devices
  (§14).
- **9.2** THE SYSTEM SHALL implement the artifact manager: downloads model packs and knowledge
  packs post-install from the configured artifact host with resumable downloads, SHA-256
  checksum verification over HTTPS (NG11), and background download support; the app binary
  ships with no bundled model weights.
- **9.3** WHEN loading artifacts THE SYSTEM SHALL verify manifest compatibility (embedder
  version ↔ index version, model ↔ app min-version) using the shared schema package (§7.11)
  and SHALL refuse to load mismatched combinations with a user-visible remediation message.
- **9.4** THE SYSTEM SHALL surface knowledge provenance in the UI: "knowledge up to: <latest
  set>, CR <version>, legality as of <date>" derived from the active manifests.
- **9.5** WHEN a newer compatible artifact version is available THE SYSTEM SHALL offer an
  in-app update (Wi-Fi-preferred, user-confirmable) applying index deltas — including
  tombstone deletions — without reinstall; model-pack updates replace the prior pack
  atomically. IF the active manifest's revoked-versions list names a currently-installed
  artifact THEN THE SYSTEM SHALL stop using it, notify the user, and download the newest
  non-revoked version.
- **9.6** WHILE the app is backgrounded or under memory pressure THE SYSTEM SHALL release
  inference contexts (models unloaded, sessions persisted via saveSession) so iOS Jetsam does
  not terminate the app; contexts lazily reload with session restore on foreground.
- **9.7** THE SYSTEM SHALL implement the on-device retrieval engine: hybrid seeding (lexical
  exact/tag match ∪ top-K sqlite-vec neighbors) → bounded-hop link expansion over chunk links
  → activation-ranked selection within the configured retrieval token budget (§14), with unit
  tests over a fixture index. The retrieval-confidence abstention floor SHALL be calibrated
  per embedder version against the eval set (not hardcoded).
- **9.8** IF the device has < 6 GB RAM or the 1.7B pack fails to load THEN THE SYSTEM SHALL
  run the 0.6B tier automatically and record the active tier in settings/diagnostics.
  (Note: iPhone 13/13 mini have 4 GB and run the 0.6B tier; iPhone 13 Pro-class and later
  6 GB devices run 1.7B — §14.)
- **9.9** WHEN the app runs before its artifacts are installed THE SYSTEM SHALL present a
  first-run experience: explicit download consent with sizes shown, Wi-Fi-preferred gating,
  progress with pause/resume/retry, and graceful degradation — catalog CRUD and previously
  cached content work model-free; Q&A and scanning show their "downloading/not ready" states
  rather than errors.
- **9.10** THE SYSTEM SHALL establish the iOS distribution pipeline: Apple Developer app
  record + bundle id, code signing/provisioning, an automated build-and-upload path to
  TestFlight, and a documented device-test provisioning flow — the channel through which every
  on-device acceptance criterion in this spec is executed.
- **9.11** THE SYSTEM SHALL support app-language selection across a registered set of shipped
  locales — currently English (`en`, the source-of-truth resource bundle) and Brazilian
  Portuguese (`pt-BR`) — for every user-facing UI string, compiled into the JS bundle at build
  time (no runtime network fetch of translations, per §13 invariant 5). Adding a locale to the
  set SHALL require only a new resource bundle plus its registration, with no change to the
  gate-check logic in the paragraph below. WHEN the app starts AND no manual language override
  is persisted THE SYSTEM SHALL resolve the UI language from the device/system locale, mapping
  it to the closest registered locale (e.g. any `pt-*` locale to `pt-BR`) and otherwise falling
  back to the source locale (`en`). THE SYSTEM SHALL provide a manual language-override control
  that persists the user's choice on-device (no account, no server round-trip) and applies it
  at runtime without requiring app reinstall or restart. THE SYSTEM SHALL enforce, as part of
  the merge gate (network-disabled, per §13 invariant 10): (a) zero hardcoded user-facing
  string literals in UI component source — every such string SHALL be sourced through the i18n
  layer's translation function; and (b) full key parity between the source locale's resource
  bundle and every other registered locale's bundle, failing the gate on any key present in one
  and missing from another, checked generically over the full registered locale set (not a
  hardcoded pair). Knowledge-corpus content, retrieval results, and model answers (§10 onward)
  SHALL remain English-only in this version — this section governs UI chrome only. Because
  consent-screen legal text (§9.9) carries release-relevant obligations, each non-source
  locale's translation of it SHALL be verified by a human legal/content reviewer before
  release; this is a named human release gate (like §9.10's TestFlight pipeline), not something
  the merge gate can substitute for.

## §10 Q&A experience (E4)

- **10.1** WHEN the user submits a question THE SYSTEM SHALL render Stage 1 progressively:
  lexically-seeded retrieval results within 100 ms on the active tier's floor device, with
  semantically-seeded results merged in as soon as the query embedding completes (embedding
  latency budgeted in §14); results render as tappable source cards (title, snippet, source
  citation) before any generation begins.
- **10.2** WHEN Stage 1 completes above the calibrated retrieval floor THE SYSTEM SHALL stream
  the Stage 2 composed answer generated under a JSON-schema grammar constraint
  (`{answer, citation_ids[], confidence}`, where `confidence` is the closed categorical scale
  `"high" | "medium" | "low" | "abstain"` defined as `Confidence`/`ConfidenceSchema` in
  `@fab/manifest-schema` — the authoritative definition, imported rather than redeclared by
  every producer/consumer), with first token within the tier's TTFT target at
  the configured retrieval token budget (§14). IF the target is unreachable on measured
  hardware (§8.6) THEN THE SYSTEM SHALL apply, in order: reduced retrieval budget → tier
  downgrade → relaxed target recorded in the release manifest — never silent shipping of a
  missed target.
- **10.3** WHEN a generated answer arrives THE SYSTEM SHALL validate every `citation_id`
  against the actually-retrieved chunk set; IF validation fails THEN THE SYSTEM SHALL discard
  the answer and show the abstention outcome instead (retrieval hits remain visible).
- **10.4** IF retrieval scores fall below the calibrated floor, or the model emits low
  confidence / abstention THEN THE SYSTEM SHALL show "not clearly settled" messaging with the
  judge Discord #ask-a-judge escalation pointer (same contract as `rules ask`) — never a best
  guess.
- **10.5** WHILE a question touches card legality THE SYSTEM SHALL fetch the live legality
  policy when online and label the answer's legality portion "as of <fetch time>"; IF offline
  THEN THE SYSTEM SHALL mark legality claims as potentially stale with last-known date.
- **10.6** THE SYSTEM SHALL support multi-turn conversations with KV-session persistence
  across app launches (llama.rn saveSession/loadSession) and bounded context management:
  retrieval re-runs per turn, the last N turns are kept verbatim with older turns evicted
  (summary line retained), and N plus the per-turn retrieval budget are chosen so total
  context never exceeds the model context window.
- **10.7** THE SYSTEM SHALL let the user open any cited source card to read the full chunk
  text (or fetch-on-demand stub content per §7.10) and its source reference (CR §, Card Vault
  URL, lore URL).
- **10.8** WHEN the user asks about a specific card by name THE SYSTEM SHALL resolve it
  against the card index (exact/fuzzy) and pin that card's chunk(s) into the retrieved set.
- **10.9** IF the question is out-of-domain (not FAB) THEN THE SYSTEM SHALL refuse within
  500 ms without full generation. The fast-path trigger is deliberately STRICTER than the
  §10.4 abstention floor: no card-name match AND retrieval scores below a separate OOD
  threshold calibrated well below the abstention floor AND near-zero lexical/tag overlap with
  the FAB vocabulary → immediate scoped-purpose refusal template (no SLM call). A question at
  or near the abstention floor without a card name is NOT out-of-domain — it takes the §10.4
  "not clearly settled" + judge-escalation path. Borderline cases proceed to generation,
  where the trained refusal behavior (§7.5c) applies.

## §11 Card scanning (E5)

- **11.1** WHEN the user photographs a single card THE SYSTEM SHALL detect, rectify, and
  identify the printing, showing top-1 with confidence and top-3 alternates for one-tap
  correction; end-to-end < 1 s on the floor devices.
- **11.2** WHEN the user photographs a field or binder page THE SYSTEM SHALL detect all card
  quads (oriented boxes), identify each, and render an overlay of results; a 10-card scene
  SHALL complete identification < 2 s on the floor devices.
- **11.3** THE SYSTEM SHALL gate each identification: accept when the top-1 embedding match
  clears a margin over top-2; WHEN ambiguous THE SYSTEM SHALL run on-device OCR of the title
  bar (Apple Vision / ML Kit) and fuzzy-match card names as tiebreaker; IF still below floor
  THEN THE SYSTEM SHALL mark the card "unidentified" with a retake affordance — never a
  silent low-confidence guess.
- **11.4** WHEN a card is identified THE SYSTEM SHALL offer: view card details (true-text
  chunk if present), ask the SLM about it (pre-pinned retrieval, §10.8), and add to catalog.
- **11.5** THE SYSTEM SHALL load detector and embedder models from the model pack (not the app
  binary) so vision models update through the same versioned channel.
- **11.6** WHEN a new set's image index delta is installed THE SYSTEM SHALL identify the new
  printings without any model update (vectors + registry ids appended; recognition is
  retrieval).
- **11.7** THE SYSTEM SHALL handle both card orientations (0°/180°) and sleeved/foil cards;
  accuracy per G3 is measured on the real-photo benchmark (§8.7e) as a release gate.

## §12 Catalog & QR share (E6)

- **12.1** THE SYSTEM SHALL store catalog entries as (printing registry id, finish, quantity)
  with optional condition (NM/SP/MP/HP) and freetext note, in op-sqlite, offline, no account.
- **12.2** WHEN the catalog changes THE SYSTEM SHALL bump a monotonic catalog version and
  content hash (visible in the UI) — "current version" is always well-defined for sharing.
- **12.3** WHEN the user scans cards (single/field/binder, §11) THE SYSTEM SHALL support bulk
  add-to-catalog with a confirm/adjust sheet (quantities, finish, duplicates merged).
- **12.4** THE SYSTEM SHALL encode catalog shares as a compact binary format: canonical
  ordering by printing-id registry, group-by-count varint registry ids, optional-field flags,
  brotli compression; the payload header carries the share-format version AND the printing-id
  registry version it was encoded against.
- **12.5** WHEN the encoded share fits ≤ 1 KB THE SYSTEM SHALL display a single static QR;
  otherwise THE SYSTEM SHALL display an animated fountain-coded BC-UR multi-part QR; both
  paths are one codepath via `@ngraveio/bc-ur`.
- **12.6** WHEN receiving, THE SYSTEM SHALL scan static or animated codes via the camera
  (progress indicator for multi-part), decode, and render the shared catalog read-only with
  the sender's catalog version/hash. IF the payload references registry ids newer than the
  receiver's installed registry THEN THE SYSTEM SHALL render the known entries and report "N
  cards from a newer set — update your knowledge pack", never a partial silent drop.
- **12.7** THE SYSTEM SHALL also export/import the same binary blob as a file via the OS share
  sheet (AirDrop etc.) as fallback for very large catalogs.
- **12.8** IF a share payload's format version is newer than the app supports THEN THE SYSTEM
  SHALL show an "update the app" message rather than a partial/garbled decode.
- **12.9** THE SYSTEM SHALL never transmit catalog data off-device except through these
  explicit user share actions (no analytics on collection contents).

## §13 Invariants

1. Every game-fact answer must derive from retrieved corpus chunks; emitted citations must be
   validated against the actually-retrieved set; when grounding is insufficient the app must
   abstain and point to the judge Discord #ask-a-judge channel — never emit a parametric guess.
2. Card legality (bans, Living Legend, restricted lists) must never be served from model
   weights or static indexes as current truth — fetch the live policy when online; when
   offline, label legality claims as potentially stale with the last-known date.
3. Every shipped artifact (model, embedder, detector, index, registry) must be versioned and
   pinned via manifests to a corpus snapshot and its compatible peers, with its license
   identifier recorded; the app must refuse mismatched artifact combinations; knowledge
   provenance ("knowledge up to") must always be user-visible.
4. Never mix content from any other card game into the corpus, datasets, models, indexes, or
   answers.
5. The app is offline-first with no accounts and no required server; core Q&A/scan/catalog
   work with no network; the user's collection never leaves the device except by an explicit
   user share action, and collection contents are never sent to analytics.
6. No official card images are redistributed inside shipped app binaries or downloadable
   artifacts; card images load at runtime from official/community CDNs and may be cached.
   Training-time use of downloaded images on the training host is permitted but images are
   never committed to git nor shipped.
7. The corpus→dataset→train→quantize→eval→release pipeline must be reproducible from committed
   manifests (corpus snapshot hash, dataset config, base model hash, hyperparameters, seeds,
   environment capture, eval scores); no model ships without its manifest.
8. No model or knowledge pack is released without passing the eval gate: trichotomy scoring
   with asymmetric penalties, near-zero incorrect on adjudication-critical categories, a
   per-suite minimum-correct coverage floor, OOD rejection suite green, the human-authored
   adjudication suite green, and (for major versions) a human-audited sample.
9. Every ML component shipped in app binaries or downloadable artifacts must carry a license
   clean for public App Store distribution (Apache 2.0/MIT preferred); no non-commercial,
   research-only, or copyleft (GPL/AGPL) weights or code ship. Corpus text ships only in the
   mode recorded by the redistribution assessment (§7.10).
10. All merge-gating tests must pass with the network disabled; live HTTP happens only behind
    explicit user actions or the artifact updater, never in the gate.

## §14 Non-functional

- **Device floors & tiers:** 1.7B tier floor = iPhone 13 Pro class (A15, 6 GB RAM); 0.6B tier
  floor = iPhone 12 / 13 base class (A14/A15, 4 GB RAM). Tier selection per §9.8. Both tiers
  ship with targets:
  | Metric | 1.7B tier (6 GB floor) | 0.6B tier (4 GB floor) |
  |---|---|---|
  | Stage 1 lexical render | < 100 ms | < 100 ms |
  | Query embedding | < 300 ms | < 300 ms |
  | Stage 2 TTFT (warm session) | < 3 s | < 2 s |
  | Stage 2 TTFT (cold) | < 8 s | < 5 s |
  | Decode speed | ≥ 10 tok/s | ≥ 18 tok/s |
  | Peak RAM (Q&A) | < 2.5 GB | < 1.4 GB |
  Targets hold at the **retrieval token budget: 1,024 tokens of retrieved context** (default,
  config-tunable) plus system prompt + conversation window (§10.6); §8.6 measures prefill at
  this budget before targets gate a release, with the §10.2 fallback ladder if unmet.
- **Scan latency:** single card < 1 s; 10-card field < 2 s (floor devices).
- **Footprint:** app binary < 150 MB; 1.7B pack ≈ 1.1–1.4 GB, 0.6B pack ≈ 450–600 MB;
  knowledge pack < 60 MB; delta packs typically < 5 MB.
- **Reliability:** artifact downloads resumable; delta application (including tombstones)
  atomic; model swap atomic; corrupted artifacts detected via checksums and re-downloaded;
  revoked versions disabled per §9.5.
- **Privacy:** no accounts, no server-side inference, no collection analytics; no crash
  reporting in v1 (§16 Q5); App Privacy label "data not collected" for core flows.
- **Licensing/compliance:** base models Apache 2.0; embedder MIT (bge) unless Gemma ToU
  explicitly accepted and recorded; detector Apache/MIT only (no AGPL — §5); corpus text per
  the §7.10 assessment; card images: runtime CDN loading + training-time use only, no
  redistribution (Invariant 6); third-party license notices screen in-app listing every
  shipped component and its license.
- **Observability (dev):** on-device diagnostics screen — active artifact versions, tier,
  retrieval scores for last query, tokens/sec; pipeline runs emit structured logs + manifests.

## §15 Testing strategy

- **Pipeline (merge-gating, network-off):** unit tests for chunk normalization, id stability,
  redistribution-mode enforcement, dataset splitting/stratification, manifest schema
  generation/validation (shared package fixtures), delta/tombstone application equivalence,
  share-format encode/decode round-trip, retrieval engine (fixture index: seeding, link
  expansion, ranking), citation validation, artifact compatibility + revocation checks.
- **Model quality (release-gating, not merge-gating):** the E2 eval harness (§8.3–8.5) runs
  per candidate release on the training host; results recorded in manifests. Merge gates
  never require GPU runs; the harness itself is gate-tested against a stub model with a
  mocked judge.
- **App (merge-gating):** TypeScript typecheck + lint + unit tests for stores, retrieval,
  encoding, versioning logic with llama.rn/tflite mocked; component tests for the
  answer/abstention/citation UI states and first-run download states.
- **Device (release-gating, manual/scripted via the §9.10 pipeline):** on-device smoke suite
  per release: model load, warm/cold latency + prefill at budget (both tiers), scan accuracy
  sample from the real-photo benchmark, memory-pressure background/foreground cycle, artifact
  update flow (delta with tombstones + full + revocation), QR share/receive between two
  devices.
- **Determinism:** retrieval and encoding fully deterministic given index + query; generation
  at temperature 0 with thinking disabled for eval reproducibility.

## §16 Open questions

| # | Question | Owner | Default if unanswered |
|---|---|---|---|
| 1 | Product/app display name & bundle id | user | working name `fab-app`; bundle id set in APP-036 (iOS distribution task) |
| 2 | Artifact hosting (public GitHub Releases vs private bucket) | user | public GitHub Releases on this repo |
| 3 | Include player-brain strategy notes in v1 corpus? | user | include, tagged `strategy`, UI frames them as play advice, never rulings |
| 4 | Android device floor | spec author (Android epic, post-v1) | 6 GB RAM, Android 13+, Snapdragon 8 Gen 1-class |
| 5 | Crash reporting SDK (privacy-clean) vs none in v1 | user | none in v1; revisit at public App Store release |
| 6 | Card-image CDN source for in-app display | spec author (derive in E3) | same sources the CLI uses (Fabrary CDN / official), cached, never bundled |
| 7 | Android bring-up epic timing | user | scheduled after v1 iOS TestFlight ships; new epic added to this spec then |
| 8 | Manifest cryptographic signing | user | not in v1 (NG11); revisit before public App Store release |
| 9 | Runtime LoRA delivery (vs merged GGUF) | spec author | merged GGUF per release until llama.rn adapter defects are fixed upstream |
| 10 | Repo/package licenses for public release (LICENSE.md is GPL-3.0, package.json says ISC — inconsistent today) | user | per-package licensing (APP-004, resolved 2026-08-01): `fab-cli` = GPL-3.0-only (LICENSE + package.json `license` field); `fab-app`/`pipeline` = MIT (LICENSE + package.json `license` field each); root LICENSE.md is a per-package pointer, no repo-wide GPL claim |
