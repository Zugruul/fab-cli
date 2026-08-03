"""Per-card dataset adapter for the recognition embedder (APP-028). Reads
the SAME APP-026 composites-generator run directory train_vision/
dataset.py reads (manifest.json + <id>.png + <id>.json), but unlike
dataset.py (one sample per COMPOSITE, for the detector), this produces one
sample per CARD across every composite — the embedder classifies/embeds
individual card crops, not whole composites. Train/val partitioning reuses
dataset.py's split_dataset directly (it's generic over any list of dicts,
with no detector-specific assumptions) rather than reimplementing it here.
"""
import json
import os
from typing import Any, Dict, List


def build_embed_dataset(run_dir: str) -> List[Dict[str, Any]]:
    """Raises FileNotFoundError (not a silent empty list) when the
    manifest itself is missing — same fail-loud stance as dataset.py's
    build_dataset."""
    manifest_path = os.path.join(run_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"build_embed_dataset: no manifest.json found at {manifest_path} — run composites:generate first (APP-026)")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    samples: List[Dict[str, Any]] = []
    for entry in manifest["composites"]:
        composite_id = entry["compositeId"]
        label_path = os.path.join(run_dir, f"{composite_id}.json")
        with open(label_path, "r", encoding="utf-8") as f:
            label = json.load(f)

        image_path = os.path.join(run_dir, label["fileName"])
        for card_index, card in enumerate(label["cards"]):
            samples.append(
                {
                    "composite_id": composite_id,
                    "card_index": card_index,
                    "image_path": image_path,
                    "printing_id": card["printingId"],
                    "corners": card["corners"],
                    "width": label["width"],
                    "height": label["height"],
                    "tags": card.get("tags", []),
                }
            )
    return samples


def build_class_index(samples: List[Dict[str, Any]]) -> Dict[str, int]:
    """Deterministic printing_id -> class-index mapping, sorted so the
    SAME dataset always yields the SAME mapping regardless of manifest
    iteration order — needed for a reproducible ArcFace classification
    head across repeated runs against the same dataset."""
    unique_ids = sorted({s["printing_id"] for s in samples})
    return {printing_id: idx for idx, printing_id in enumerate(unique_ids)}
