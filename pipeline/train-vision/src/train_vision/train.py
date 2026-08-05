#!/usr/bin/env python3
"""OBB detector training entry point (APP-027, SPEC-APP.md §8.7c). Mirrors
development-skills' slm-training capability bundle's train.py convention
(development-skills/plugins/spec-workflow/scripts/remote-capabilities/
slm-training/train.py): ONE config file in, a summary JSON + manifest.json
out to `config["outputDir"]` — so this script is directly usable both as
a standalone local/CPU run (the APP-027 smoke) and, unmodified, as a
future remote-compute capability job's `cmd` (see pipeline/src/
train-vision/README.md for the TS dispatch side and why no such capability
job exists yet in development-skills).

Usage:
    python3 -m train_vision.train --config <path-to-config.json>

Config schema: see config.py's validate_config (architecture, seed,
datasetDir, valFraction, stride, train{epochs,batchSize,lr}, outputDir).

Known, documented simplifications (this is the "boring, not state of the
art" tier per the issue brief — real gaps for a follow-up, not silently
absorbed):
  - No Gaussian heatmap-peak splatting (losses.py's doc comment) — hard
    0/1 targets only. Issue #285 confirmed this is the root cause of the
    trained model's suppressed peak activations (0.167-0.290, never above
    the old hardcoded decode threshold of 0.3), but implementing it
    changes the loss and so requires a real retrain (~2.5h GPU) to
    evaluate honestly — deliberately left to a follow-up rather than
    shipped behind an unretrained, unverified config flag here.
  - All composites in one dataset dir must share one canvas size, evenly
    divisible by `stride` (validated below) — the composites generator
    always produces one fixed outputSize per run, so this is never a real
    constraint in practice, just an explicit fail-fast instead of a silent
    shape-mismatch crash mid-training.

Decode threshold + NMS (issue #285): DECODE_SCORE_THRESHOLD and
NMS_IOU_THRESHOLD below are re-exports of config.py's constants of the
same name (single source of truth — see config.py's doc comment for the
full measured justification of each default). Both are configurable via
train_from_config's `config` dict (`decodeScoreThreshold`,
`nmsIouThreshold`) and threaded through to `evaluate_map` /
`_decode_predictions`.
"""
import argparse
import json
import math
import os
import time
from typing import Any, Dict, List, Tuple

import torch
from torch.utils.data import DataLoader

from .config import DECODE_SCORE_THRESHOLD, NMS_IOU_THRESHOLD, validate_config
from .dataset import build_dataset, split_dataset
from .geometry import rotated_nms
from .licenses import ARCHITECTURE_LICENSES
from .losses import heatmap_focal_loss, masked_l1_loss
from .manifest import build_run_manifest, config_hash, dataset_manifest_hash
from .map_eval import compute_map
from .model import ObbCenterNet
from .torch_data import CompositeObbDataset, collate_obb_batch


def _validate_canvas_for_stride(samples: List[Dict[str, Any]], stride: int) -> Tuple[int, int]:
    if not samples:
        raise ValueError("train_vision.train: dataset has zero composites — nothing to train on")
    width, height = samples[0]["width"], samples[0]["height"]
    for s in samples:
        if s["width"] != width or s["height"] != height:
            raise ValueError(
                f"train_vision.train: composite \"{s['composite_id']}\" is {s['width']}x{s['height']}, "
                f"expected every composite in one dataset dir to share {width}x{height} "
                "(one generator run always uses one fixed outputSize — a mismatch means two runs got merged)."
            )
    if width % stride != 0 or height % stride != 0:
        raise ValueError(f"train_vision.train: canvas {width}x{height} is not evenly divisible by stride {stride}")
    return width, height


def _epoch_loss(model: ObbCenterNet, loader: DataLoader, optimizer=None) -> float:
    training = optimizer is not None
    model.train(training)
    total = 0.0
    count = 0
    for batch in loader:
        out = model(batch["image"])
        hm_loss = heatmap_focal_loss(out["heatmap"], batch["heatmap"])
        mask = batch["mask"]
        off_loss = masked_l1_loss(out["offset"], batch["offset"], mask.expand_as(out["offset"]))
        size_loss = masked_l1_loss(out["size"], batch["size"], mask.expand_as(out["size"]))
        angle_loss = masked_l1_loss(out["angle"], batch["angle"], mask.expand_as(out["angle"]))
        loss = hm_loss + off_loss + size_loss + angle_loss

        if training:
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

        total += loss.item()
        count += 1
    return total / max(count, 1)


def _decode_predictions(
    out: Dict[str, torch.Tensor],
    stride: int,
    threshold: float = DECODE_SCORE_THRESHOLD,
    nms_iou_threshold: float = NMS_IOU_THRESHOLD,
) -> List[List[Dict[str, Any]]]:
    """Every cell scoring >= `threshold` becomes a candidate detection;
    `geometry.rotated_nms` then collapses duplicate candidates clustered
    around the same object (issue #285 — an undeduped decoder emitted
    9,269 dets for 96 GT boxes at a lowered threshold). Passing
    `nms_iou_threshold=1.0` effectively disables suppression (rotated_iou
    never exceeds 1.0, so "IoU > 1.0" never fires) — the documented way to
    turn NMS off without a separate flag."""
    heatmap, offset, size, angle = out["heatmap"], out["offset"], out["size"], out["angle"]
    batch_size, _, grid_h, grid_w = heatmap.shape
    results: List[List[Dict[str, Any]]] = []
    for b in range(batch_size):
        dets = []
        hm = heatmap[b, 0]
        for gy in range(grid_h):
            for gx in range(grid_w):
                score = hm[gy, gx].item()
                if score < threshold:
                    continue
                cx = (gx + offset[b, 0, gy, gx].item()) * stride
                cy = (gy + offset[b, 1, gy, gx].item()) * stride
                w = math.exp(size[b, 0, gy, gx].item())
                h = math.exp(size[b, 1, gy, gx].item())
                theta = math.atan2(angle[b, 0, gy, gx].item(), angle[b, 1, gy, gx].item())
                dets.append({"box": (cx, cy, w, h, theta), "score": score})
        results.append(rotated_nms(dets, nms_iou_threshold))
    return results


def evaluate_map(
    model: ObbCenterNet,
    loader: DataLoader,
    stride: int,
    iou_thresholds: List[float],
    decode_threshold: float = DECODE_SCORE_THRESHOLD,
    nms_iou_threshold: float = NMS_IOU_THRESHOLD,
) -> Dict[str, Any]:
    model.eval()
    preds: List[Dict[str, Any]] = []
    gts: Dict[str, List[Tuple[float, float, float, float, float]]] = {}
    with torch.no_grad():
        for batch in loader:
            out = model(batch["image"])
            decoded = _decode_predictions(out, stride, threshold=decode_threshold, nms_iou_threshold=nms_iou_threshold)
            for i, composite_id in enumerate(batch["composite_id"]):
                gts[composite_id] = list(batch["raw_obbs"][i])
                for det in decoded[i]:
                    preds.append({"image_id": composite_id, "box": det["box"], "score": det["score"]})
    return compute_map(preds, gts, iou_thresholds)


def train_from_config(config: Dict[str, Any], now: float = None) -> Dict[str, Any]:
    """Runs the full train -> synthetic-val mAP -> checkpoint -> manifest
    pipeline for an already-validated config dict. Returns the written
    manifest. Split out from main() so a caller (or a future test with a
    tiny real dataset dir) can invoke it without going through argv/CLI."""
    started = now if now is not None else time.time()
    torch.manual_seed(config["seed"])

    stride = config["stride"]
    samples = build_dataset(config["datasetDir"], stride=stride)
    _validate_canvas_for_stride(samples, stride)
    train_samples, val_samples = split_dataset(samples, config["valFraction"], config["seed"])

    train_loader = DataLoader(
        CompositeObbDataset(train_samples), batch_size=config["train"]["batchSize"], shuffle=True, collate_fn=collate_obb_batch
    )
    val_loader = DataLoader(
        CompositeObbDataset(val_samples if val_samples else train_samples),
        batch_size=config["train"]["batchSize"],
        shuffle=False,
        collate_fn=collate_obb_batch,
    )

    model = ObbCenterNet(stride=stride)
    optimizer = torch.optim.Adam(model.parameters(), lr=config["train"]["lr"])

    train_losses = []
    for _epoch in range(config["train"]["epochs"]):
        train_losses.append(_epoch_loss(model, train_loader, optimizer))

    decode_threshold = config.get("decodeScoreThreshold", DECODE_SCORE_THRESHOLD)
    nms_iou_threshold = config.get("nmsIouThreshold", NMS_IOU_THRESHOLD)
    synthetic_val_map = evaluate_map(
        model,
        val_loader,
        stride,
        iou_thresholds=[0.5, 0.75],
        decode_threshold=decode_threshold,
        nms_iou_threshold=nms_iou_threshold,
    )

    output_dir = config["outputDir"]
    os.makedirs(output_dir, exist_ok=True)
    checkpoint_path = os.path.join(output_dir, "checkpoint.pt")
    torch.save(model.state_dict(), checkpoint_path)

    # configHash/datasetManifestHash are computed HERE (not by a future TS
    # runner) because datasetDir may be a path that only exists on the
    # machine actually running this script (e.g. a remote GPU box) — a TS
    # orchestration layer reading this summary back after job-pull must
    # never have to re-derive them from a dataset dir it can't see. Mirrors
    # export_gguf.py's export-summary.json convention: the script that has
    # real local access to an artifact is what hashes it.
    summary = {
        "architecture": config["architecture"],
        "configHash": config_hash(config),
        "datasetManifestHash": dataset_manifest_hash(config["datasetDir"]),
        "trainLosses": train_losses,
        "syntheticValMAP": synthetic_val_map,
        # issue #285: the reported mAP above is meaningless without knowing
        # what decode gate produced the predictions it was computed from.
        "decodeScoreThreshold": decode_threshold,
        "nmsIouThreshold": nms_iou_threshold,
        "sampleCounts": {"train": len(train_samples), "val": len(val_samples)},
        "licenses": dict(ARCHITECTURE_LICENSES),
        "wallClockSec": time.time() - started,
    }
    with open(os.path.join(output_dir, "train-summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")

    manifest = build_run_manifest(
        run_id=os.path.basename(os.path.normpath(output_dir)),
        architecture=config["architecture"],
        config=config,
        dataset_dir=config["datasetDir"],
        seed=config["seed"],
        metrics={
            "syntheticVal": synthetic_val_map,
            # Real-photo-benchmark mAP is QA-gated per the issue's scope
            # note (the user hasn't shot APP-025's real-photo benchmark
            # photos yet) — recorded honestly as null with a reason, never
            # fabricated or silently omitted.
            "realPhotoBenchmark": None,
            "realPhotoBenchmarkReason": "QA-gated: APP-025's real-photo benchmark photo set has not been shot yet (issue #139 scope note).",
        },
        environment={"torch": torch.__version__, "cuda": None, "driver": None, "gpu": None},
        dispatch={"resource": "local", "jobId": os.path.basename(os.path.normpath(output_dir)), "capabilityJob": "local-cpu-smoke"},
        artifacts={"checkpointPath": checkpoint_path, "tfliteFiles": []},
        status="completed",
        timestamps={"dispatchedAt": None, "completedAt": None},
    )
    with open(os.path.join(output_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the APP-027 OBB detector from a config file.")
    parser.add_argument("--config", required=True, help="Path to a JSON config file (see config.py's validate_config).")
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        raw_config = json.load(f)
    result = validate_config(raw_config)
    if not result.valid:
        raise SystemExit("invalid config:\n" + "\n".join(f"  - {e}" for e in result.errors))

    manifest = train_from_config(result.config)
    print(json.dumps({"manifest": manifest}, indent=2))


if __name__ == "__main__":
    main()
