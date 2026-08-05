#!/usr/bin/env python3
"""OBB detector checkpoint-evaluation entry point (issue #139 scope
addition to APP-027, SPEC-APP.md §8.7c). APP-027's AC requires "mAP on
synthetic val + real-photo benchmark subset reported" — train.py already
produces the synthetic-val half as a side effect of training; this module
is the missing other half: given an ALREADY-TRAINED checkpoint and a
held-out dataset dir (e.g. realPhotoEvalSet.ts's export, issue #139),
compute and report its mAP. Config-file-driven, same convention as
train.py/export.py:

    python3 -m train_vision.eval_obb --config <path-to-config.json>

Config schema: see config.py's validate_eval_config (architecture,
checkpointPath, datasetDir, stride, batchSize, iouThresholds, outputDir,
optional device — default "cpu").

WHY THIS RUNS LOCALLY ON CPU: a real-photo benchmark set is small by
construction (currently 16 photos) — seconds of CPU work to score, not a
training run. No GPU and no remote dispatch are needed for this half.

NO device.py: this repo's train_vision copy does not have one — issue
#270's GPU-dispatch work (which introduces device.py, per the vision-
training capability bundle's own divergent copy) is sitting on an
unmerged branch (fab/270-vision-gpu-dispatch). Device selection here is
deliberately just the plain `torch.device(config.get("device", "cpu"))`
the caller's brief asked for, nothing more — do not import or reference
device.py from this module.

NEVER SPLITS THE DATASET: train.py's split_dataset partitions the
synthetic composites dataset into its own train/val subsets because it
needs both. A held-out real-photo benchmark set has no such need — it
exists entirely to be evaluated, so this module always scores dataset.py's
build_dataset() output in full. Splitting it here would silently shrink
the reported sample size below what was actually labeled.

REUSES train.py::evaluate_map AND map_eval.py::compute_map UNCHANGED: a
second implementation of the mAP maths that silently disagreed with the
training-time metric would make the synthetic-val and real-photo-
benchmark numbers incomparable, defeating the entire point of reporting
them side by side. Nothing about the maths is reimplemented or "improved"
here — this module only prepares a checkpoint + dataset + device for
evaluate_map to consume exactly as it already does.
"""
import argparse
import json
import os
import time
from typing import Any, Dict

import torch
from torch.utils.data import DataLoader

from .config import DECODE_SCORE_THRESHOLD, NMS_IOU_THRESHOLD, validate_eval_config
from .dataset import build_dataset
from .manifest import dataset_manifest_hash
from .model import ObbCenterNet
from .torch_data import CompositeObbDataset, collate_obb_batch
from .train import evaluate_map


def _collate_on_device(items, device: torch.device) -> Dict[str, Any]:
    """Wraps torch_data.collate_obb_batch (unchanged) so every tensor field
    already lands on `device` before evaluate_map's internal loop ever
    touches it — the only way to support a non-"cpu" device without
    modifying evaluate_map itself, which never takes a device argument in
    this repo's copy of train.py."""
    batch = collate_obb_batch(items)
    for key in ("image", "heatmap", "offset", "size", "angle", "mask"):
        batch[key] = batch[key].to(device)
    return batch


def eval_from_config(config: Dict[str, Any], now: float = None) -> Dict[str, Any]:
    """Runs a full eval pass of an already-trained checkpoint against
    config["datasetDir"] (scored in FULL — see this module's doc comment
    for why it never splits), writing eval-summary.json to
    config["outputDir"] and returning it. Accepts an already-validated
    config (validate_eval_config's normalized output) OR a hand-built dict
    missing "device" — defaults to "cpu" either way, mirroring
    train_from_config's own direct-callable convention."""
    started = now if now is not None else time.time()

    device = torch.device(config.get("device", "cpu"))
    stride = config["stride"]

    samples = build_dataset(config["datasetDir"], stride=stride)
    if not samples:
        raise ValueError("train_vision.eval_obb: dataset has zero items — nothing to evaluate")

    # AMODAL CONTRACT (map_eval.py's doc comment, restated here): raw_obbs
    # is the FULL, unclamped ground truth — including cards encode.py had
    # to exclude from obb_targets because their center fell off-canvas
    # (no heatmap cell to supervise). The reported ground-truth count must
    # come from raw_obbs, never obb_targets, or an off-canvas card would
    # silently vanish from the denominator.
    ground_truth_box_count = sum(len(s["targets"]["raw_obbs"]) for s in samples)

    loader = DataLoader(
        CompositeObbDataset(samples),
        batch_size=config["batchSize"],
        shuffle=False,
        collate_fn=lambda items: _collate_on_device(items, device),
    )

    model = ObbCenterNet(stride=stride)
    # map_location="cpu" ALWAYS, regardless of the target eval device: the
    # real motivating case is a checkpoint trained on a remote GPU (an
    # RTX 5090) that must load on a CPU-only eval machine — torch.load
    # would otherwise try to deserialize storages onto a CUDA device that
    # doesn't exist here and fail outright. The model is moved to `device`
    # (a no-op when device is "cpu", the common case) only AFTER the
    # state dict has safely landed on CPU.
    state_dict = torch.load(config["checkpointPath"], map_location="cpu")
    model.load_state_dict(state_dict)
    model.to(device)

    # issue #285: defensive .get() fallback (not a bare config[...]) so a
    # hand-built config that bypasses validate_eval_config's normalization
    # (see this module's device-default precedent above) still gets the
    # same measured defaults, not a KeyError.
    decode_threshold = config.get("decodeScoreThreshold", DECODE_SCORE_THRESHOLD)
    nms_iou_threshold = config.get("nmsIouThreshold", NMS_IOU_THRESHOLD)
    map_result = evaluate_map(
        model,
        loader,
        stride,
        config["iouThresholds"],
        decode_threshold=decode_threshold,
        nms_iou_threshold=nms_iou_threshold,
    )

    output_dir = config["outputDir"]
    os.makedirs(output_dir, exist_ok=True)
    summary = {
        "architecture": config["architecture"],
        "checkpointPath": config["checkpointPath"],
        "datasetDir": config["datasetDir"],
        "datasetManifestHash": dataset_manifest_hash(config["datasetDir"]),
        "device": str(device),
        # Same visibility requirement as train.py's summary — the reported
        # mAP is meaningless without knowing what decode gate produced it.
        "decodeScoreThreshold": decode_threshold,
        "nmsIouThreshold": nms_iou_threshold,
        # Real, exact counts — never rounded or bucketed. A real-photo
        # benchmark set is small by construction (16 photos as of issue
        # #139); this number must always be readable at face value, not
        # dressed up as if it came from a larger set.
        "imageCount": len(samples),
        "groundTruthBoxCount": ground_truth_box_count,
        "mAP": map_result["mAP"],
        "perThreshold": map_result["perThreshold"],
        "wallClockSec": time.time() - started,
    }
    with open(os.path.join(output_dir, "eval-summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate an already-trained OBB detector checkpoint's mAP against a held-out dataset dir.")
    parser.add_argument("--config", required=True, help="Path to a JSON config file (see config.py's validate_eval_config).")
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        raw_config = json.load(f)
    result = validate_eval_config(raw_config)
    if not result.valid:
        raise SystemExit("invalid config:\n" + "\n".join(f"  - {e}" for e in result.errors))

    summary = eval_from_config(result.config)
    print(json.dumps({"summary": summary}, indent=2))


if __name__ == "__main__":
    main()
