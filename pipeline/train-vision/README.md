# OBB detector training + export (APP-027, SPEC-APP.md §8.7c, issue #139)

Trains and exports the card-scanning pipeline's oriented-bounding-box (OBB) detector: a
from-scratch, single-class ("card") CenterNet-style head, trained on APP-026's synthetic
composites, exported to a fast-tflite-loadable file. Two QA-gated legs are explicitly **out of
scope for this package** and stay open on issue #139: the real-photo-benchmark mAP subset
(APP-025's real-photo benchmark hasn't been shot yet) and the on-device fast-tflite (React
Native) load (TestFlight channel blocked on a human decision). Both are recorded as honest
`null`/pending in every manifest this package writes — never faked.

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
pyproject.toml              — package metadata + real deps (torch, litert-torch, numpy, pillow)
src/train_vision/
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
  licenses.py                  — the license table + validate_licenses hard gate
  manifest.py                  — run-manifest builder (config/dataset hashes, licenses, metrics)
  train.py                     — `python3 -m train_vision.train --config <path>` entry point
  export.py                    — `python3 -m train_vision.export --config <path>` entry point
tests/                        — pytest suite (pure logic + a CPU model/losses overfit test + a
                                real end-to-end train_from_config integration test)
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

## What's verified vs. what's a smoke (see the PR body for exact numbers)

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
