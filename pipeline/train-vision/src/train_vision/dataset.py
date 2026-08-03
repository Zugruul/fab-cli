"""Dataset adapter (APP-027, SPEC-APP.md §8.7c): reads a synthetic-
composite generation run's committed output (APP-026, pipeline/src/
composites/write.ts's layout — manifest.json + <compositeId>.png +
<compositeId>.json per composite) and turns it into per-sample OBB
training targets via encode.py.

This module never decodes image bytes itself (no PIL/torch dependency
here) — it only resolves paths and reads the small JSON manifest/label
files, so it stays trivially unit-testable. Actual image loading happens
in the torch Dataset wrapper (model.py/train.py), which is the only layer
that needs a real image decoder.
"""
import json
import os
import random
from typing import Any, Dict, List, Tuple

from .encode import encode_targets


def build_dataset(run_dir: str, stride: int) -> List[Dict[str, Any]]:
    """Reads `run_dir`'s manifest.json + one label JSON per composite,
    returning one sample dict per composite:
    {composite_id, image_path, width, height, targets: encode_targets(...)}.
    Raises FileNotFoundError (not a silent empty list) when the manifest
    itself is missing — an empty/misconfigured dataset dir should fail
    loudly, not train on nothing.
    """
    manifest_path = os.path.join(run_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"build_dataset: no manifest.json found at {manifest_path} — run composites:generate first (APP-026)")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    samples: List[Dict[str, Any]] = []
    for entry in manifest["composites"]:
        composite_id = entry["compositeId"]
        label_path = os.path.join(run_dir, f"{composite_id}.json")
        with open(label_path, "r", encoding="utf-8") as f:
            label = json.load(f)

        targets = encode_targets(label["cards"], canvas_width=label["width"], canvas_height=label["height"], stride=stride)
        samples.append(
            {
                "composite_id": composite_id,
                "image_path": os.path.join(run_dir, label["fileName"]),
                "width": label["width"],
                "height": label["height"],
                "targets": targets,
            }
        )
    return samples


def split_dataset(samples: List[Any], val_fraction: float, seed: int) -> Tuple[List[Any], List[Any]]:
    """Deterministic (seed-pinned) train/val split. A shuffled COPY of
    `samples` is partitioned so the split's order never mutates or aliases
    the caller's list; the same seed always reproduces the same partition
    (SPEC-APP.md §8.7c's mAP-on-synthetic-val requires a stable val set
    across runs sharing a seed, not a fresh random split every call).
    """
    if not (0.0 <= val_fraction < 1.0):
        raise ValueError(f"val_fraction must be in [0, 1), got {val_fraction}")
    shuffled = list(samples)
    random.Random(seed).shuffle(shuffled)
    val_count = round(len(shuffled) * val_fraction)
    val = shuffled[:val_count]
    train = shuffled[val_count:]
    return train, val
