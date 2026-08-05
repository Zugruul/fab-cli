# Backlog — FAB Companion App (SPEC-APP.md, prefix APP)

Epic `blockedBy` on the board is intentionally coarse (epic granularity); the **task-level
dependencies noted per task are the real constraints** — a task may start once ITS listed
dependencies are done even if its epic's blockedBy epic isn't fully Deployed. After E0, the
training lane (E1→E2) and app lane (E3) run in parallel; they share only the manifest schema
package (APP-016), which is why it lands first in E1. Points ≈ complexity 1–10 (no task ≥8
unsplit). Every task cites its spec §s.

## E0 — Monorepo restructure (APP-001…009) — blockedBy: —

- **APP-001** (5) Convert repo to pnpm-workspaces monorepo: root `pnpm-workspace.yaml` +
  private root package.json (pattern: `~/Development/monorepo` — root scripts fan out via
  `pnpm -r`, root `gate` delegates to package gates), `git mv` fab-cli into `fab-cli/`, stub
  `fab-app/` + `pipeline/` packages.
  AC: `pnpm install` clean at root; existing fab-cli gate green from root; the pre-existing
  global install (from the old repo-root `npm i -g .`) is uninstalled (`npm rm -g fab-cli`)
  and reinstalled via `npm i -g ./fab-cli --force`, then smoke-runs (`fab-cli fabrary
  formats`, `rules search`) — no stale bin symlink to the old package root survives;
  submodules resolve under `fab-cli/third_party/`; history preserved (`git log --follow` on a
  moved file). [§6.1, §6.2, §6.5]
- **APP-002** (4) Move FAB knowledge brains (judge, player, card-vault + kw-* corpus) to root
  `.claude/identities/`; keep dev-side brains per-subproject; repair keyword-corpus symlinks
  AND update path-dependent scripts (`keyword-sync.py`, `backfill-entities.py`, entity-index
  tooling) in the same change. Depends: APP-001 (new layout).
  AC: `keyword-sync.py check` green from its new location; `brain.sh recall` works against
  root paths; `backfill-entities.py --check` runs; guard hooks still block direct note reads.
  [§6.3, §6.6]
- **APP-003** (2) Update `.claude/project.yaml`: existing specs' `specPath`/`backlogPath` to
  `fab-cli/…`, keep single board; validate. Depends: APP-001.
  AC: `board.sh config` passes; a board round-trip (read one issue) succeeds. [§6.4]
- **APP-004** (2) Per-package licensing: resolve GPL-3.0-LICENSE.md vs ISC-package.json
  inconsistency; `fab-app` + `pipeline` get MIT (default per §16 Q10), each package's
  `license` field matches its LICENSE file. Depends: APP-001 (packages exist).
  AC: every workspace package has consistent LICENSE + license field; the root `LICENSE.md`
  (currently GPL-3.0 text) is replaced by a per-package licensing pointer so no repo-wide
  GPL claim survives; root README states the per-package licensing; user sign-off recorded on
  the fab-cli license choice. [§6.7]

## E1 — Corpus → dataset pipeline (APP-010…019) — blockedBy: E0

- **APP-010** (5) Corpus exporter in `pipeline/`: normalized chunks (stable `chunk_id`, text,
  title, source, typed links, tags) from brains + rules KB + lore, with snapshot manifest
  (content hash, CR/document versions, latest set, lore commit, date). Depends: APP-001/002.
  AC: two consecutive runs on unchanged corpus emit identical ids/hash; manifest fields
  populated from VERSIONS.txt; unit tests for normalization + id stability. [§7.1, §7.2]
- **APP-016** (3) Shared manifest/compatibility schema package (model pack, knowledge pack,
  delta pack incl. tombstones, corpus snapshot; per-artifact license ids; revoked-versions
  list) with validation helpers + fixtures, consumed by `pipeline/` AND `fab-app`. Depends:
  APP-001 only — deliberately early so both lanes build against it.
  AC: schema versioned; corpus-snapshot schema REQUIRES the per-source shipping-mode field
  (§7.10) and the knowledge-pack schema REQUIRES `retrievalFloor` (per embedder version) +
  OOD threshold fields (§9.7, §10.9); fixture manifests (valid, mismatched, revoked,
  tombstoned) published for consumer tests; both lanes' package.json import it. [§7.11]
- **APP-017** (3) Redistribution-rights assessment: per-source policy review (LSS rules docs,
  Card Vault text, own-authored notes, fablore prose) with shipping mode (verbatim /
  paraphrase / retrieval stub) recorded in the snapshot manifest; exporter enforces the mode.
  Depends: APP-010.
  AC: assessment doc committed with per-source outcome + rationale; lore defaults to stubs
  pending permission; exporter test proves a stub-mode source ships no verbatim text; user
  sign-off on the assessment. [§7.10, §13-I9]
- **APP-011** (5) Teacher Q&A generation: per-chunk grounded pairs via Claude API, diverse
  phrasings, cited answers; committed prompt/config; resumable batch runner with cost/rate
  controls. Depends: APP-010.
  AC: dry-run mode with fixture chunks tested offline; run manifest logs counts + teacher
  model id; sample output human-spot-checkable via a review file. [§7.3]
- **APP-012** (4) Rejection sampling: entailment-check every candidate answer against its
  source chunk; discard non-entailed; log acceptance rates. Depends: APP-011.
  AC: injected known-bad samples are rejected in tests; per-category acceptance in manifest.
  [§7.4]
- **APP-013** (5) Behavior dataset builders: distractor-retrieval examples, insufficient-
  context abstention examples, broad-phrasing OOD refusals; DPO preference pairs
  (cited/hedged ≻ confident-wrong). Depends: APP-011.
  AC: category counts meet configured minimums; abstention/OOD phrasing diversity metric
  reported; unit tests on builders with fixtures. [§7.5, §7.6]
- **APP-014** (3) Dataset versioning + eval split: stratified held-out split disjoint by
  source chunk; dataset manifest (snapshot pin, config hash, counts) committed; bulk files to
  artifact storage. Depends: APP-012/013.
  AC: split leakage test (no train/eval chunk overlap where category requires); manifest
  schema validated in gate via APP-016 package. [§7.7, §7.8]
- **APP-015** (2) Legality exclusion rule: legality/ban-list-sourced chunks excluded from fact
  SFT, only present as time-sensitive retrieval-robustness examples. Depends: APP-010.
  AC: build fails loudly if a legality chunk appears in fact-SFT output; test covers. [§7.9]

## E2 — Model training & eval (APP-020…029, overflow 080–089) — blockedBy: E1

- **APP-020** (5) Training runner: Unsloth QLoRA SFT then DPO for Qwen3 1.7B + 0.6B on local
  CUDA (MLX path documented), thinking mode disabled; training manifest (hyperparams, seeds,
  base hash, environment capture: lockfile hash + CUDA/driver versions) per run. Depends:
  APP-014.
  AC: end-to-end run on a tiny fixture dataset completes on the 5090; manifest complete incl.
  environment; resumable. [§8.1]
- **APP-021** (3) LLM export chain: merged GGUF per tier, quantize Q4_K_M + Q8_0, llama.cpp
  smoke test (load + one JSON-schema-constrained completion); LoRA adapter retained as
  pipeline artifact, not shipped. Depends: APP-020.
  AC: artifacts load in llama.cpp CLI; constrained output parses; checksums + licenses in
  manifest. [§8.2, §5]
- **APP-022** (6) Eval harness: trichotomy scoring (correct/incorrect/abstained, asymmetric
  penalties), rubric LLM-judge + exact-match; suites: adjudication-critical, interactions,
  lore, citation validity, abstention quality, OOD, distractor robustness, AND the
  **human-authored adjudication suite** (transcribed #ask-a-judge / Rules Reprise worked
  examples — not teacher-generated); calibration per embedder version of BOTH the abstention
  retrieval floor and the stricter OOD fast-path threshold (§10.9). Depends: APP-014.
  AC: harness runs against a stub model in gate (network-off, judge mocked); human-authored
  suite ≥100 items committed with source links; per-suite scores into release manifest;
  regression comparison implemented; calibration output recorded. [§8.3, §8.4, §9.7]
- **APP-023** (2) Release gate: threshold config incl. per-suite minimum-correct coverage
  floor; fail on adjudication-critical incorrect > near-zero threshold, coverage below floor,
  or any suite regression; major-version human-audit checklist. Depends: APP-022.
  AC: seeded-bad candidate blocked; **seeded always-abstain candidate blocked**; audit
  template exists. [§8.5]
- **APP-024** (3) On-device benchmark protocol for BOTH tiers on their floor devices: decode
  tok/s, prefill tok/s at the 1,024-token retrieval budget, TTFT warm/cold, query-embedding
  latency, retrieval p95 (cited by APP-033; that leg of the protocol runs once APP-033
  lands), RAM peak; fallback-ladder decision recorded if targets unmet. Depends: APP-021 +
  APP-030 (app-lane device harness) + APP-036 (device provisioning).
  AC: scripted protocol + result schema; one full recorded run per tier; results in release
  manifest; E4 latency ACs cite these numbers. [§8.6, §14]
- **APP-025** (3) Printing-image dataset builder + real-photo benchmark: rate-limited cached
  downloader for catalog images (training host only, never committed); labeled real-photo
  benchmark set (hundreds of photos: sleeves, foils, glare, both orientations, field + binder
  scenes) — photos shot from the user's physical collection, labeled per card quad by stable
  printing identifier (mapped to registry ids at eval time, so no APP-085 dependency), stored
  in artifact storage (like bulk datasets, §7.7), never git-committed.
  Depends: APP-010 (card catalog data).
  AC: downloader respects rate limits + cache, no-commit guard tested (covers benchmark
  photos too); benchmark set versioned with labels in artifact storage; labeling protocol
  documented; G3 measurement runs against it. [§8.7a, §8.7e]
- **APP-026** (4) Synthetic-composite generator: catalog images pasted onto varied
  backgrounds with rotation/overlap/perspective/lighting/glare/sleeve augmentation; dataset
  manifest. Depends: APP-025.
  AC: generator config committed; sample sheet renderable for human inspection; deterministic
  given seed. [§8.7b]
- **APP-027** (5) Detector train + export: Apache/MIT-licensed OBB architecture chosen and
  recorded (AGPL/Ultralytics excluded); trained on APP-026 composites; export to
  fast-tflite-loadable format with Core ML delegate validation. Depends: APP-026.
  AC: license of architecture + training code recorded in manifest; mAP on synthetic val +
  real-photo benchmark subset reported; tflite loads via fast-tflite on device. [§8.7c, §5,
  §13-I9]
- **APP-028** (5) Recognition embedder train + export: ArcFace metric fine-tune with the
  augmentation envelope; 256-d int8 vectors; export to fast-tflite; accuracy measured on the
  real-photo benchmark. Depends: APP-025/026.
  AC: top-1 ≥95% on real-photo benchmark crops (G3 gate); embedding dim/version in manifest;
  tflite loads on device. [§8.7d, G3]
- **APP-029** (4) Pack assembly + publish: assemble model packs (per tier: merged GGUF, text
  embedder GGUF, detector + vision embedder tflite, manifest) and knowledge packs (full +
  delta with tombstones + printing-id registry); repeatable publish script to GitHub Releases
  under documented versioned layout. Depends: APP-016/017/021/027/028 + knowledge-pack builder
  (APP-085 below) — APP-017's assessment is a publish precondition (§7.10) enforced by the
  required shipping-mode schema field.
  AC: publish dry-run produces complete bundles validating against APP-016 schema (fails
  without shipping-mode field); published URLs consumed by APP-031's device test;
  delta-over-previous == full-build equivalence **including a deletion fixture**;
  version change of EITHER embedder forces full pack (delta refused — both tested).
  [§8.8, §8.9]
- **APP-085** (4) Knowledge-pack builder (E2 overflow range): text-chunk embeddings
  (embedder-pinned), printing-image embeddings, printing-id registry (append-only, versioned),
  sqlite-vec index files, delta computation with tombstones; writes the calibrated
  `retrievalFloor` + OOD threshold (from APP-022) into the pack manifest. Depends:
  APP-010/016; image embeddings arrive with APP-028; floor values from APP-022.
  AC: full + delta build tested incl. tombstones; delta refused on EITHER embedder's version
  change (both cases tested); registry append-only property tested (existing ids never
  remapped); manifests pin embedder versions and carry retrievalFloor/OOD threshold. [§8.8,
  §4, §9.7]

## E3 — App foundation & artifact versioning (APP-030…039) — blockedBy: E0

- **APP-030** (5) RN scaffold `fab-app`: TypeScript, iOS-first; integrate llama.rn, op-sqlite
  (+sqlite-vec), vision-camera, fast-tflite; device smoke screen proving each native module
  (loads a stock GGUF + a stock tflite — no fine-tuned artifacts needed). Depends: APP-001.
  AC: runs on both floor devices; CI typecheck/lint/unit green in root gate. [§9.1]
- **APP-036** (3) iOS distribution pipeline: Apple Developer app record + bundle id, signing/
  provisioning, automated build+upload to TestFlight, documented device-test provisioning
  flow. Depends: APP-030. Deliberately early — every on-device AC in E2/E4/E5/E6 runs through
  this channel.
  AC: a TestFlight build installs on both floor devices from a one-command script; doc covers
  adding a new test device. [§9.10]
- **APP-031** (5) Artifact manager: resumable SHA-256-checksummed downloads (model +
  knowledge packs) from configured host, background download, atomic install/swap incl.
  tombstone deltas, revoked-version handling, no bundled weights. Depends: APP-016 (schema);
  device test depends: APP-029 (published artifacts).
  AC: unit tests with mock host (resume, corrupt-checksum re-download, atomic swap, delta
  incl. deletion, revocation triggers disable+redownload); manual device test of a full
  download from the real channel. [§9.2, §9.5]
- **APP-032** (3) Manifest compatibility enforcement + provenance UI: refuse mismatched
  combos (APP-016 fixtures) with remediation message; "knowledge up to" screen from active
  manifests. Depends: APP-016.
  AC: mismatch + revoked fixtures rejected in tests; provenance renders set/CR/legality date.
  [§9.3, §9.4]
- **APP-033** (5) Retrieval engine: hybrid seeding (lexical ∪ sqlite-vec KNN) → bounded-hop
  link expansion → activation ranking within the 1,024-token budget; calibrated abstention
  floor loaded from knowledge-pack manifest. Depends: APP-016; fixture index local.
  AC: unit tests on fixture index cover seeding union, hop bounds, ranking determinism,
  budget clipping, floor-from-manifest; p95 retrieval < 50 ms on-device measured under
  APP-024's protocol. [§9.7]
- **APP-034** (3) Memory lifecycle: release contexts on background/memory-pressure, persist
  sessions (saveSession), lazy reload + restore on foreground; RAM-based tier selection
  (<6 GB → 0.6B). Depends: APP-030.
  AC: instrumented device test survives background/foreground cycle without Jetsam kill on
  BOTH floor devices; 4 GB device selects 0.6B automatically. [§9.6, §9.8]
- **APP-035** (4) First-run/onboarding UX: download consent with sizes, Wi-Fi-preferred
  gating, progress with pause/resume/retry, degraded-mode navigation (catalog CRUD works
  model-free; Q&A/scan show not-ready states). Depends: APP-031.
  AC: component tests for all download states; device test: fresh install → consent →
  download → ready without dead-ends; airplane-mode fresh install can still open catalog.
  [§9.9]

## E4 — Q&A experience (APP-040…049) — blockedBy: E3 (task-level: APP-021 artifacts + APP-030/031/033; NOT vision tasks)

- **APP-040** (5) Two-stage answer UI: progressive Stage 1 (lexical < 100 ms, semantic merged
  on embed completion), streamed Stage 2 grammar-constrained answer; source-card detail view
  (incl. stub fetch-on-demand per §7.10). Depends: APP-021/030/031/033.
  AC: component tests for both stages + loading/error/merge states; device timing meets the
  APP-024-measured targets per tier (cited by number in the test doc). [§10.1, §10.2, §10.7]
- **APP-041** (4) Grounding enforcement: citation_id validation against retrieved set;
  invalid → discard + abstention outcome; calibrated-floor + low-confidence abstention with
  judge-Discord escalation pointer. Depends: APP-033/040.
  AC: unit tests: fabricated citation discarded; low-floor query renders escalation; **no
  code path renders an answer without ≥1 validated citation** (asserted via exhaustive state
  test of the answer reducer). [§10.3, §10.4]
- **APP-042** (3) Legality liveness: live policy fetch when online with "as of" labeling;
  offline → potentially-stale marking with last-known date. Depends: APP-040.
  AC: tests for online/offline branches; no legality claim renders unlabeled. [§10.5]
- **APP-043** (3) Multi-turn sessions: KV persistence across launches, per-turn retrieval,
  bounded context (last-N verbatim + eviction summary, window-size proof), conversation
  management UI. Depends: APP-040.
  AC: session restores after kill/relaunch; context-bound property test (any turn count stays
  under window); per-turn retrieval verified. [§10.6]
- **APP-044** (3) Card-name resolution + pinning (exact/fuzzy) and OOD fast-refusal (no
  card-name match AND below the separate calibrated OOD threshold — well below the abstention
  floor — AND near-zero FAB-vocabulary lexical/tag overlap → template refusal, no SLM call;
  near-floor non-card queries take the §10.4 escalation path instead). Depends: APP-033.
  AC: fuzzy match tests (apostrophes, partials); OOD fixtures refused < 500 ms; borderline
  fixture proceeds to generation. [§10.8, §10.9]

## E5 — Card scanning (APP-050…059) — blockedBy: E3 (task-level: APP-027/028 models via APP-029 pack + APP-030/031; NOT text-eval tasks)

- **APP-050** (5) Scan pipeline core: frame → detector (fast-tflite) → quad rectification
  (both orientations) → embedder → sqlite-vec KNN over registry-id vectors → margin gate;
  models loaded from model pack. Depends: APP-027/028/029/030/031.
  AC: unit tests with fixture images through mocked runtimes; **end-to-end (detector →
  rectify → embed → gate) top-1 ≥ 95% on the real-photo benchmark's single-card photos (G3
  release gate)**, with field/binder scenes reported per-card (identified / unidentified /
  wrong — wrong is the gated-to-near-zero bucket). [§11.1, §11.3, §11.5, §11.7, G3]
- **APP-051** (4) Single-card scan UX: capture, top-1 + confidence + top-3 alternates,
  one-tap correction, card actions (details / ask SLM / add to catalog). Depends: APP-050.
  AC: end-to-end < 1 s on floor devices; correction flow tested. [§11.1, §11.4]
- **APP-052** (5) Field/binder multi-card scan: multi-quad detection, per-card overlay
  results, unidentified-card retake affordance. Depends: APP-050.
  AC: 10-card scene < 2 s on floor devices; overlay maps results to positions; occluded-card
  fixture yields "unidentified", never a wrong id. [§11.2, §11.3]
- **APP-053** (3) OCR tiebreaker: Apple Vision title-bar recognition + fuzzy name match wired
  into the ambiguity gate. Depends: APP-050.
  AC: ambiguous fixture pairs resolved; foil-glare fixture falls back to unidentified rather
  than wrong. [§11.3]
- **APP-054** (2) New-set index verification: install image-index delta (vectors + registry
  ids appended), identify new printings with unchanged models. Depends: APP-050 + APP-085.
  AC: scripted test with a held-out "new set" slice proves zero-retrain recognition. [§11.6]

## E6 — Catalog & QR share (APP-060…069) — blockedBy: E5 (task-level: APP-060/062 need only APP-085 registry + APP-030; intake needs APP-052)

- **APP-060** (4) Catalog store: (registry id, finish, qty, optional condition/notes) in
  op-sqlite; monotonic version + content hash; CRUD UI with search/filter. Depends: APP-085
  (registry) + APP-030.
  AC: unit tests for versioning/hash on every mutation; UI lists/filters by set/finish.
  [§12.1, §12.2]
- **APP-061** (3) Scan-to-catalog bulk intake: confirm/adjust sheet (qty, finish, duplicate
  merge) from single/field/binder scans. Depends: APP-052/060.
  AC: binder-page fixture adds 9 entries in one flow; duplicate merge tested. [§12.3]
- **APP-062** (4) Share encoding: versioned compact binary (registry-canonical ordering,
  group-by-count varints, optional-field flags, brotli); header carries format version +
  registry version. Depends: APP-060.
  AC: round-trip property tests incl. optional fields; ≤1 KB for a 500-entry fixture drawn
  randomly across ≥10 sets (not set-clustered); newer-format-version decode shows upgrade
  message; **cross-registry-version fixture: unknown ids reported as "N cards from a newer
  set", known ids rendered**. [§12.4, §12.6, §12.8]
- **APP-063** (5) QR share/receive: single static QR ≤1 KB else animated BC-UR fountain
  codes; camera receive with progress; read-only shared-catalog view; share-sheet file
  fallback. Depends: APP-062.
  AC: two-device manual test both modes; dropped-frame tolerance verified (cover part of the
  animation mid-scan); no network involved. [§12.5, §12.6, §12.7]
- **APP-064** (1) Privacy guard: no catalog data in any telemetry path; explicit-share-only
  egress audit. Depends: APP-060.
  AC: static check/test that no network call includes catalog tables' data. [§12.9]

## E7 — Freshness & update pipeline (APP-070…079) — blockedBy: E2 (task-level: APP-085 registry/deltas + APP-022/023 eval gate + APP-029/031 publish path)

Keeping a shipped model current as rules change and new sets release. The system ages on **two
unrelated clocks**: the knowledge tier ages with *rules changes* (pack rebuild, hours), the vision
tier ages with *new printings* (gallery append, minutes). Conflating them is the failure this epic
exists to prevent.

Load-bearing fact, verified in code rather than assumed: recognition inference is embedding →
L2-normalise → cosine KNN over a `{printing_id, embedding}` gallery (`train_vision/retrieval.py`);
the ArcFace classification head is training-only (`EmbedderForExport` fixes `normalize=False`), and
the detector is single-class "card" (`model.py`). **A new set therefore requires no retraining of
anything** — only new gallery entries.

- **APP-070** (3) Source-change watcher: scheduled detection across CR/TRP/PPG + VERSIONS.txt, the
  live card-legality page, the-fab-cube submodule, Card Vault `rulings_errata` + true-text drift,
  and the Rules Reprise feed. Detect-and-report only — publishes nothing. Depends: —.
  AC: per-source `changed | unchanged | fetch-failed` (three distinct states, a failed fetch is
  never reported as "unchanged"); per-source failure isolated; records what it compared against.
- **APP-071** (2) Update-tier classifier: routes each detected delta to Tier 0 live / Tier 1 pack
  delta / Tier 2 LLM retrain / Tier 3 vision retrain, with a recorded rationale. Depends: APP-070.
  AC: legality always routes Tier 0 and can never be packaged (locked by test); never auto-escalates
  to Tier 2/3 — it may recommend, a human decides; unrecognised change types route to "needs human
  classification", never silently to the cheapest tier.
- **APP-072** (5) Rules knowledge-pack delta: incremental rebuild of changed chunks + embeddings,
  tombstones for superseded content, gated through the existing eval harness before republish.
  Depends: APP-071, APP-085, APP-022/023, APP-029/031.
  AC: unchanged chunks keep existing embeddings (proven by hash); superseded chunks tombstoned AND
  absent from the rebuilt index; republish blocked on eval-gate failure, never bypassed. [§8, §10]
- **APP-073** (4) Printing-index delta: new printings embedded with the EXISTING embedder into
  gallery/registry deltas — no training step in this path. Depends: APP-071, APP-085. Pairs with
  APP-054 (install side).
  AC: three-population report `embedded | imageUnobtainable | alreadyPresent` whose sum equals
  total new printings, asserted in the artifact (33 printings already 403 from LSS S3 — an
  unfetchable printing is unrecognisable and must never be silently dropped); idempotent.
- **APP-074** (2) Cross-artifact version compatibility: hard-refuse mismatched pack/model pairings;
  force full index regeneration on any embedder-version change. Depends: APP-072, APP-073.
  Extends APP-032.
  AC: mismatched pairing refused (not degraded/warned); incremental delta across an
  embedder-version boundary rejected, with kill-first evidence; `embeddingDim` mismatch caught
  independently of version mismatch. Rationale: vectors from two embedder versions occupy different
  spaces, so cosine similarity between them is meaningless while still returning a plausible number
  — and the metric it corrupts is the same one the G3 ≥95% gate reads.

## EI — Infra reserve (APP-090…099) — blockedBy: —

Reserved for discovered infra work (CI for pipeline manifests, device-farm scripts, release
automation hardening). Publish/release scripting has a real home (APP-029/036); this range is
overflow only.
