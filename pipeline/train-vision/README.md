# Vision model training + export (SPEC-APP.md §8.7c/§8.7d)

Trains and exports the two card-scanning pipeline vision models: the **OBB detector** (APP-027,
§8.7c, issue #139) and the **ArcFace recognition embedder** (APP-028, §8.7d, issue #140). Both
are from-scratch (no pretrained weights), trained on APP-026's synthetic composites, and export
to fast-tflite-loadable files with the same manifest discipline. Each has QA-gated legs
explicitly **out of scope for this package**, recorded as honest `null`/pending in every
manifest — never faked: the real-photo-benchmark accuracy subset (APP-025's real-photo benchmark
hasn't been shot yet) and the on-device fast-tflite (React Native) load (TestFlight channel
blocked on a human decision).

## OBB detector (APP-027, SPEC-APP.md §8.7c, issue #139)

A from-scratch, single-class ("card") CenterNet-style head, trained on APP-026's synthetic
composites, exported to a fast-tflite-loadable file.

## Architecture decision (SPEC-APP.md §5, §13 Invariant 9)

**Chosen: a from-scratch, single-class CenterNet-style head on a tiny hand-rolled Conv-BN-ReLU
backbone** (`src/train_vision/model.py`) — zero third-party model-definition dependencies beyond
`torch` itself.

Rejected candidates and why:
- **Ultralytics YOLO11** — excluded outright: AGPL-3.0 (SPEC-APP.md §13 Invariant 9, docs/
  BACKLOG-APP.md's own backlog row for this task).
- **MMRotate/MMDetection** — Apache-2.0 itself, but pulls in `mmcv`'s compiled-op ecosystem and
  a heavier install/export surface than this task needs. "Prefer boring and exportable over
  state-of-the-art" (issue brief).
- **A torchvision pretrained backbone** — torchvision's own LICENSE is BSD-3-Clause, but its
  hosted *pretrained weights'* license status is documented as unresolved in PyTorch's own forums
  (see `src/train_vision/licenses.py`'s doc comment). Training from scratch on APP-026's
  synthetic composites (plentiful, generated on demand) sidesteps that ambiguity entirely rather
  than accepting it — this package doesn't import `torchvision` at all.

Export chain: `torch` model → `litert_torch.convert(...).export(...)` → `.tflite`. One hop, no
intermediate ONNX/TensorFlow SavedModel step — `litert-torch` (the `ai-edge-torch` successor
package; the older name is deprecated but still importable) traces the model via `torch.export`
and lowers it directly to LiteRT's flatbuffer format. A shorter dependency chain is a shorter
license chain to verify.

### License table (recorded in every manifest, `src/train_vision/licenses.py` / `src/train_vision/manifest.py`)

| Component | License | Role |
|---|---|---|
| This package's training code | MIT | matches `pipeline/package.json` |
| `torch` | BSD-3-Clause | model + training loop |
| `torchvision` | BSD-3-Clause | **not imported** — recorded for completeness only, since SPEC-APP.md §13's own candidate list cites it; this package's actual code has zero torchvision dependency |
| `litert-torch` | Apache-2.0 | Google AI Edge / LiteRT — torch→tflite conversion |
| `ai-edge-litert` | Apache-2.0 | Google AI Edge / LiteRT — tflite runtime (local load verification) |
| `litert-converter` | Apache-2.0 | Google AI Edge / LiteRT — conversion backend |

`src/train_vision/licenses.py`'s `validate_licenses` (and its TS mirror, `pipeline/src/
train-vision/licenses.ts`) is a **hard gate**, not documentation: the manifest builder refuses to
run if any recorded license is empty, unrecognized, or matches the GPL family (`gpl` substring,
case-insensitive) — Invariant 9 made mechanical.

## Layout

```
pyproject.toml              — package metadata + real deps (torch, litert-torch, ai-edge-quantizer,
                                numpy, pillow) — shared by BOTH the detector and the embedder
src/train_vision/
  --- OBB detector (APP-027) ---
  geometry.py                — pure OBB geometry: quad<->OBB, polygon clip, rotated IoU
                                (zero third-party deps — see its own doc comment)
  encode.py                   — quad labels -> CenterNet-style training targets (amodal-safe)
  dataset.py                  — reads an APP-026 composites run dir (pure, no image decoding)
  torch_data.py                — torch Dataset wrapper (the only module that imports PIL for real
                                decoding) + batch collation
  model.py                    — ObbCenterNet (the architecture — see above)
  losses.py                   — heatmap focal loss + masked L1 regression losses
  map_eval.py                  — single-class mAP over rotated IoU (PASCAL-VOC-style AP)
  config.py                    — train/export config schema validation
  licenses.py                  — the license table + validate_licenses hard gate (also reused
                                by the embedder — see below)
  manifest.py                  — run-manifest builder (config/dataset hashes, licenses, metrics;
                                config_hash/dataset_manifest_hash also reused by the embedder)
  train.py                     — `python3 -m train_vision.train --config <path>` entry point
  export.py                    — `python3 -m train_vision.export --config <path>` entry point
  --- Recognition embedder (APP-028) ---
  embed_crop.py                — pure crop-box geometry from a quad (unclamped AABB, amodal)
  embed_pixels.py               — crop-with-neutral-padding (numpy, exact out-of-canvas pixels)
  embed_dataset.py               — reads the SAME composites run dir, one sample per CARD
  embed_torch_data.py             — torch Dataset wrapper for real-image card crops
  arcface_loss.py                — ArcFace additive angular margin loss + ArcFaceHead
  embed_model.py                  — ArcFaceEmbedder (the architecture — see above)
  retrieval.py                    — pure top-1/top-K cosine-KNN accuracy over a printing-id gallery
  embed_config.py                  — train/export config schema validation
  embed_licenses.py                 — the embedder's own license table
  embed_manifest.py                  — run-manifest builder (embeddingDim/embedderVersion)
  embed_train.py                     — `python3 -m train_vision.embed_train --config <path>`
  embed_export.py                     — `python3 -m train_vision.embed_export --config <path>`
tests/                        — pytest suite (pure logic + CPU overfit/gradient-sanity tests +
                                real end-to-end train_from_config/export_from_config integration
                                tests, for both the detector and the embedder)
```

## Setup (one-time, local venv — gitignored, mirrors `.venv-img`'s pattern)

```bash
cd pipeline/train-vision
python3 -m venv .venv
.venv/bin/pip install -e .[dev]
```

`pipeline/package.json`'s `test:py` script (folded into `gate`) invokes `.venv/bin/python`
directly at that fixed relative path — **this is the Python test wiring APP-027 added to
pipeline's gate** (there was none before this issue). Run it directly with:

```bash
cd pipeline
npm run test:py          # just the Python suite
npm run gate             # typecheck + vitest + pytest, same as always
```

If `.venv` doesn't exist yet, `test:py`/`gate` fail with a `.venv/bin/python: No such file or
directory` error — that's the actionable signal to run the one-time setup above, not a code bug.

## Usage

```bash
# 1. Generate a synthetic-composite training set (APP-026; needs cached printing images —
#    see pipeline/src/images/cli.ts / `npm run images:download` first).
cd pipeline
npm run composites:generate -- --config <composites-generation.json> --out out/composites-run

# 2. Train (writes checkpoint.pt + train-summary.json + manifest.json to outputDir).
train-vision/.venv/bin/python -m train_vision.train --config <train-config.json>

# 3. Export to tflite (writes <outputPath> + export-summary.json alongside it).
train-vision/.venv/bin/python -m train_vision.export --config <export-config.json>
```

Config schemas: `src/train_vision/config.py`'s `validate_config` (train) / `validate_export_config`
(export) — every required key, with clear per-field error messages on an invalid config.

## TS dispatch integration (`pipeline/src/train-vision/`)

Mirrors `pipeline/src/training/` and `pipeline/src/export/`'s conventions exactly: `types.ts`
(spec/config/manifest/state shapes), `configBuilder.ts` (pure `VisionRunSpec` → the exact JSON
`train_vision/config.py` expects), `licenses.ts` (TS mirror of `licenses.py`'s table + gate),
`runner.ts` (dispatch → poll → pull → manifest, resumable via `state.json`), `cli.ts` (`run`/
`resume`/`status` subcommands). Run dirs live at `pipeline/vision-runs/<runId>/` — `config.json`/
`state.json`/`manifest.json` are committed (same discipline as `training-runs/`/`export-runs/`),
`output/` (the pulled checkpoint + tflite) is gitignored.

### A decision this issue's brief didn't cover: which remote-compute mechanism

The brief named "the capability" as `slm-training` — but that bundle
(`development-skills/plugins/spec-workflow/scripts/remote-capabilities/slm-training/`) only
declares `gpu-check`/`sft`/`export-gguf`/`eval` jobs, all Unsloth/LLM-specific (`train.py`'s own
config surface has no room for vision hyperparams). Grounding this against
`realDispatcher.ts`/`export/realDispatcher.ts`'s own doc comments: **`RealDispatcher` and
`buildRunArgv`/`buildStatusArgv`/`buildPullArgv` are already 100% capability-agnostic** — they
take `{resource, capabilityJob}` as plain strings and know nothing about what job they're
targeting (proven by `export/realDispatcher.ts` already reusing them unchanged for a *different*
job, `export-gguf`, within the same bundle).

So: **zero new TS dispatch code was needed to make vision training capability-agnostic** —
`pipeline/src/train-vision/realDispatcher.ts` just re-exports `training/realDispatcher.ts`'s
builders verbatim (same pattern as `export/realDispatcher.ts`), targeting a placeholder
`vision-training:obb-train` capability job name. What's missing for a REAL remote GPU dispatch is
a **capability-bundle payload** (`train_vision`'s scripts + a `capability.yaml` declaring the
`obb-train`/`obb-export` jobs) installed under `development-skills/plugins/spec-workflow/scripts/
remote-capabilities/vision-training/` — that's a change to a **separate repository**
(`development-skills`), out of this PR's scope by construction (this branch only touches
`fab-cli`). `runner.ts`/`cli.ts` are fully built, tested (via a fake dispatcher — see
`pipeline/test/trainVision.test.ts`), and ready the moment that bundle exists; today a real `run`
invocation would fail at the `remote-compute.py run` layer with "capability not installed", not
silently succeed.

An alternative considered and rejected: `remote-compute.py`'s generic `dispatch`/`job-status`/
`job-pull` verbs (no capability declaration needed at all — just `--cmd "python3 -m
train_vision.train --config ..."` under the already-verified `training` env on `storm590x`).
This would work today with zero additional setup, but diverges from `training/types.ts`'s own
documented stance ("real training runs go through the generic remote-compute capability
bundle... never ad-hoc ssh") and from `export/`'s established precedent of extending the
capability-job pattern rather than falling back to raw dispatch. Kept as the pragmatic fallback
if the `vision-training` capability bundle addition stalls, not the primary path.

## What's verified vs. what's a smoke — OBB detector (see the PR body for exact numbers)

- **Unit-tested** (pytest, no GPU, gated in `npm run gate`): OBB geometry + rotated IoU (incl.
  out-of-canvas/amodal cases), target encoding (incl. the amodal contract: an off-canvas card's
  center never gets a heatmap peak but its full ground truth is never dropped or clamped), the
  dataset adapter against a real fixture composites run, mAP computation (hand-computed pinned
  values), config/manifest/license validation, the loss functions (hand-computed values), and a
  CPU model+losses overfit sanity check (proves the whole differentiable path actually learns).
- **Smoke-verified, not gated** (real CPU run, numbers in the PR body, never fabricated): a tiny
  end-to-end run — generate synthetic composites → train a few epochs on CPU → export to tflite
  → load the exported file in the local LiteRT/TF-Lite Python interpreter and run a forward pass.
  This is explicitly a smoke, not the AC's full training run — the synthetic-val mAP at this
  scale is expected to be small/near-zero, and is reported as such.

## Recognition embedder (APP-028, SPEC-APP.md §8.7d, issue #140)

An ArcFace metric-learning embedder: a from-scratch, zero-pretrained-weight Conv-GroupNorm-ReLU
backbone trained with additive angular margin loss over per-card crops from APP-026 composites
(classes = printing unique_ids), producing a 256-d embedding, exported as an int8-quantized
tflite. Two QA-gated legs stay open on issue #140, same posture as the detector above: top-1
≥95% on the real-photo benchmark (G3's actual gate) and the on-device fast-tflite load.

### Package placement — extending this package, not a new one

This is the same `pipeline/train-vision/` package, not a new top-level package: the embedder is
a second training/export job sharing the detector's venv, pyproject.toml, manifest/license
discipline, and `pipeline/vision-runs/` runs directory (as a sibling run id, distinguished by its
own `config.json`). Every embedder module lives directly alongside the detector's own files (no
nested subpackage) — `train_vision/` was already a flat, single-package layout with zero
subpackages, so an `embed_*.py` naming prefix (mirroring this file's own section split) keeps
that convention rather than introducing a new nesting pattern for one job.

**A deliberate isolation trade-off, not full sharing**: `embed_model.py`'s `ArcFaceEmbedder` is a
separate, independently-defined backbone from `model.py`'s `ObbCenterNet` — NOT a refactor of the
detector into a shared base class — so this task's changes never touch the already-shipped,
reviewed APP-027 code. Likewise `embed_config.py`/`embed_licenses.py`/`embed_manifest.py` are
separate modules reusing `config.py`'s `ConfigResult` shape and `licenses.py`'s generic
`validate_licenses` gate directly, rather than extending the detector's own `KNOWN_ARCHITECTURES`
enum or `ARCHITECTURE_LICENSES` table (the two jobs' config/license shapes share nothing beyond
that reusable, job-agnostic plumbing). A small amount of structural duplication (both are plain
Conv-Norm-ReLU stacks) is the accepted cost of that isolation.

### Architecture decision (SPEC-APP.md §5, §13 Invariant 9)

**Chosen: a from-scratch Conv-GroupNorm-ReLU downsampling stack → global average pool → Linear
projection to a 256-d, L2-normalized embedding** (`src/train_vision/embed_model.py`) — zero
third-party model-definition dependencies beyond `torch`, same Invariant-9 reasoning as the
detector (no pretrained backbone, so no unresolved pretrained-weight license question to accept).

**GroupNorm, not BatchNorm2d** (a real difference from the detector's `ObbCenterNet`): this
package's own tiny smoke/synthetic-val training loops routinely produce a final batch of size 1
(small fixture dataset, small `batchSize`), which `BatchNorm2d` cannot process in training mode
at all — it needs more than one sample to estimate a batch statistic, and raises `ValueError:
Expected more than 1 value per channel when training` otherwise (hit for real while building this
task, not a hypothetical). GroupNorm normalizes per-sample and has no such floor, at zero
additional license/dependency cost (still plain `torch.nn`).

### ArcFace loss (`src/train_vision/arcface_loss.py`)

The additive angular margin loss from Deng et al. 2019 — a **loss function**, not a pretrained
model, so Invariant 9's license constraint doesn't apply to it at all. `ArcFaceHead` owns the
per-class weight matrix and is **training-only**: `embed_export.py` never ships it, matching
standard face-recognition-model deployment practice (only the embedding trunk ships).

**Boundary guard (PR #240 review finding)**: a naive `cos(theta + margin)` is only monotonically
decreasing while `theta + margin <= pi`. Past that boundary (deep-negative cosine, reachable with
a small `embedding_dim`/few classes — weak concentration of measure, exactly this task's smoke
scale) it wraps around and comes back UP, making the true-class logit **easier** to satisfy —
backwards from ArcFace's whole purpose. Verified numerically during review: cosine=-0.99,
margin=0.5 produced target≈-0.9364 (higher/easier) instead of harder. Fixed with the standard
InsightFace "easy margin" guard: past `cosine <= cos(pi - margin)`, falls back to the linear
approximation `cosine - sin(pi - margin) * margin`, which stays monotonically ≤ the plain cosine
everywhere — pinned in `test_arcface_loss.py`'s boundary test.

### Crop-from-quad convention (`src/train_vision/embed_crop.py` + `embed_pixels.py`)

**Boundary convention, decided up front**: the crop box is the **axis-aligned bounding box** of
the quad's 4 corners, not a rotation/perspective-corrected rectification. A rotated or
perspective-skewed card's crop therefore includes some background around the card — a real,
accepted accuracy cost (a follow-up could rectify via a homography, mirroring
`composites/warp.ts`'s forward warp inverted), the same "boring, not state of the art" tier as
the detector's own documented simplifications (no NMS, hard 0/1 heatmap targets).

**Amodal contract, pixel version**: `embed_pixels.py`'s `crop_with_neutral_padding` never clamps
the crop box to the canvas — the out-of-canvas portion of a crop is filled with a neutral
mid-gray value (`NEUTRAL_FILL_VALUE = 128`) rather than clamping the box first and stretching a
partial card to fill the whole crop, which would silently lie about how much of the card was
actually visible. This is `encode.py`'s amodal stance (never clamp geometry) applied to real
pixels instead of heatmap supervision targets.

### Real-composites verification (dev brain lesson: read real producer output before writing fixtures)

Before writing any embedder fixture, `pipeline/src/benchmark/types.ts`'s `Quad` type (which
`pipeline/src/composites/types.ts` re-exports verbatim for APP-026's label shape) was read
directly: corners are `{x, y}` dict pairs, not `[x, y]` arrays, and `printingId` is a real
per-card field already present in every composites-run label. The existing
`tests/fixtures/composites-run/` fixture (checked in for APP-027, already corrected post-review
to this exact real shape) already contains 4 distinct `printingId` values across its 3
composites, so no new fixture was needed for the embedder's per-card, multi-class tests.

### int8 export (`src/train_vision/embed_export.py`) — a decision this issue's brief didn't cover

**The "obvious" path is broken in this repo's pinned toolchain.** The brief's natural reading —
mirror the detector's `export.py` chain, just add a PT2E `quant_config` to
`litert_torch.convert()` — was prototyped first: `torch.export.export → prepare_pt2e → calibrate
→ convert_pt2e → litert_torch.convert(quantized_model, sample, quant_config=...)`. It fails
deterministically at the MLIR converter-passes stage:

```
ValueError: Failed to run converter passes: ... error: 'stablehlo.uniform_dequantize' op
operand #0 must be ranked tensor of per-tensor integer quantized or per-axis integer
quantized values, but got 'tensor<8x3x3x3xi8>'
```

This was reproduced independently on a **bare `nn.Linear` model** (not this package's
architecture, not per-channel-vs-per-tensor config, not BatchNorm) — a real version-skew
incompatibility between this repo's currently pinned `litert-torch`/`torchao`/`torch` versions,
not a bug in this package's model code or a workaround-able config choice.

**The path actually shipped, verified end-to-end in this repo's real venv**: a **decoupled**
workflow using `ai_edge_quantizer` (Google AI Edge, Apache-2.0) instead:
1. Export the trained `ArcFaceEmbedder` to a **plain float32** tflite via
   `litert_torch.convert(model, sample)` — the exact same one-hop chain `export.py` already uses
   for the detector, no quantization involved at this step.
2. Run `ai_edge_quantizer.Quantizer(float_path, recipe.static_wi8_ai8())`, calibrated against real
   APP-026 composite crops (the same crop path training uses), then `.quantize()` +
   `.export_model()`.

This was prototyped and confirmed working (float export → calibrate → quantize → int8 tflite
loads, correct `int8` in/out dtype) before being adopted — `test_embed_export.py` exercises the
full real chain (train a tiny checkpoint → export → load) with no mocking.

**Why the exported model's output is the PRE-normalization embedding**: L2-normalize is a
division/sqrt op that this int8 PTQ toolchain doesn't cleanly carry through a quantized graph.
Rather than force it through (or silently ship a broken/always-degenerate int8 model),
`embed_model.py`'s `EmbedderForExport` wrapper ships the raw, pre-normalization 256-d feature
vector — application code dequantizes (using the tflite output tensor's own scale/zero-point) and
L2-normalizes before cosine-similarity KNN. This matches how most on-device embedding models are
actually deployed (quantized raw features; normalization happens app-side).

### License table (`src/train_vision/embed_licenses.py`)

| Component | License | Role |
|---|---|---|
| This package's training code | MIT | matches `pipeline/package.json` |
| `torch` | BSD-3-Clause | model + training loop |
| `litert-torch` | Apache-2.0 | Google AI Edge / LiteRT — the plain float torch→tflite export step |
| `ai-edge-litert` | Apache-2.0 | Google AI Edge / LiteRT — tflite runtime (local load verification) |
| `litert-converter` | Apache-2.0 | Google AI Edge / LiteRT — conversion backend |
| `ai-edge-quantizer` | Apache-2.0 | Google AI Edge — the decoupled int8 post-training-quantization step (new vs. the detector's table) |

### Usage

```bash
# 1. Generate a synthetic-composite training set (APP-026) — same as the detector.
cd pipeline
npm run composites:generate -- --config <composites-generation.json> --out out/composites-run

# 2. Train (writes checkpoint.pt + embed-train-summary.json + manifest.json to outputDir).
train-vision/.venv/bin/python -m train_vision.embed_train --config <embed-train-config.json>

# 3. Export to int8 tflite (writes <outputPath> + embed-export-summary.json alongside it).
train-vision/.venv/bin/python -m train_vision.embed_export --config <embed-export-config.json>
```

Config schemas: `src/train_vision/embed_config.py`'s `validate_embed_config` (train) /
`validate_embed_export_config` (export).

### TS dispatch integration (`pipeline/src/train-vision/embed*.ts`) — another decision the brief didn't cover

The brief allowed "extend the TS layer, or show it's already generic" — the honest assessment is
**it's not fully generic**: `runner.ts`'s `buildManifest` is hardcoded to read the detector's
`train-summary.json` shape and build a `VisionRunManifest` with no `embeddingDim`/
`embedderVersion` fields. Generalizing that safely (a shared runner parametrized over two
different manifest shapes) would be a bigger, riskier refactor of the already-shipped APP-027
runner than this task's scope — so `embedTypes.ts`/`embedConfigBuilder.ts`/`embedLicenses.ts`/
`embedRunner.ts`/`embedCli.ts` are a **parallel set of files**, mirroring `types.ts`/
`configBuilder.ts`/`licenses.ts`/`runner.ts`/`cli.ts`'s structure closely, reading
`embed-train-summary.json` and building an `EmbedRunManifest` instead. This is the same isolation
trade-off as the Python side's `embed_*.py`-vs-`*.py` split, applied consistently.

What genuinely IS already generic and reused verbatim (zero new code): `realDispatcher.ts`'s
`RealDispatcher`/`buildRunArgv`/`buildStatusArgv`/`buildPullArgv` — proven job-agnostic already by
`export/realDispatcher.ts` reusing them for a third job unchanged. `embedRunner.ts`/
`embedCli.ts` import them directly. No `arcface-embed-train` remote-compute capability exists yet
on any resource (same gap as the detector's `vision-training:obb-train` placeholder) —
`--capability-job` defaults to `vision-training:arcface-embed-train` so the CLI is ready the
moment one is installed; a real `run` invocation today fails at the `remote-compute.py` layer
with "not installed", not silently succeeding.

Embedder runs live in the SAME `pipeline/vision-runs/<runId>/` directory as detector runs (no new
`embed-runs/` directory) — sibling run ids distinguished by their own `config.json`'s
`architecture` field, same commit discipline (`config.json`/`state.json`/`manifest.json`
committed, `output/` gitignored).

### What's verified vs. what's a smoke — recognition embedder (see the PR body for exact numbers)

- **Unit-tested** (pytest, no GPU, gated in `npm run gate`): crop-box geometry incl. out-of-canvas
  cases (exact box values), pixel-level neutral-padding crop incl. out-of-canvas cases (exact
  per-pixel arrays, not just shapes), the per-card dataset adapter against the real fixture
  composites run, ArcFace loss margin/scale math (hand-pinned values, including the
  pi-margin-boundary guard — PR #240 review item 1), the degenerate single-class-is-always-
  zero-loss case, a gradient-sanity overfit test through the whole embedder+head+loss
  differentiable path, embedding shape/L2-norm contract, config/manifest/license validation, and
  pure dataset-agnostic top-1/top-K retrieval accuracy (hand-computed).
- **Also gated, not just smoked** (a deliberate step beyond the detector's own precedent, since
  the toolchain path was verified working): the full int8 export chain — train a tiny checkpoint
  → export → quantize → load the exported file in the local LiteRT/TF-Lite Python interpreter and
  assert the output is genuinely `int8`-typed with the configured embedding shape. This is real,
  not mocked, every single `npm run gate` run. Additionally (PR #240 review item 2): the SAME
  real fixture crops run through both the float and int8 tflite models, dequantized +
  L2-normalized identically, assert leave-one-out cosine-KNN **ranking** is preserved between
  float and int8 — the early signal between "float synthetic-val looks fine" and an on-device
  measurement, catching a quantization-induced accuracy collapse before it ever reaches a device.
- **Toy-scale, honestly labeled, never inflated**: the synthetic-val retrieval accuracy at this
  package's own fixture scale (4 total card crops, each a distinct class) is a deterministic 0%
  — every held-out validation crop's class is, by construction, absent from the train-built
  gallery at this tiny scale. This is reported and asserted exactly as such, not hidden or
  rounded away.
