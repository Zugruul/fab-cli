#!/usr/bin/env python3
"""Recognition embedder training entry point (APP-028, SPEC-APP.md
§8.7d). Mirrors train.py's shape for the detector: one config file in, a
checkpoint + summary + manifest out. Trains ArcFaceEmbedder with
ArcFaceHead's additive-angular-margin loss over per-card crops from an
APP-026 composites run, classes = printing unique_ids
(embed_dataset.build_class_index).

Usage:
    python3 -m train_vision.embed_train --config <path-to-config.json>

Known, documented simplifications (same "boring, not state of the art"
tier as the detector — see train.py's own doc comment):
  - Crop is an axis-aligned bounding box of the quad, not a rotation/
    perspective-corrected rectification (embed_crop.py's doc comment) —
    a rotated/skewed card's crop includes some background.
  - Synthetic-val retrieval accuracy at this smoke scale, with very few
    distinct printing ids and few crops per id, is expected to be noisy
    or even exactly zero (a dataset where every class has exactly one
    crop total guarantees a held-out val class is absent from the
    train-built gallery) — reported honestly, never inflated.
"""
import argparse
import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import torch
from torch.utils.data import DataLoader

from .arcface_loss import ArcFaceHead, arcface_loss
from .dataset import split_dataset
from .embed_config import validate_embed_config
from .embed_dataset import build_class_index, build_embed_dataset
from .embed_licenses import EMBEDDER_LICENSES
from .embed_manifest import EMBEDDER_VERSION, build_embed_run_manifest
from .embed_model import ArcFaceEmbedder
from .embed_torch_data import PrintingCropDataset, collate_embed_batch
from .manifest import config_hash, dataset_manifest_hash
from .retrieval import topk_accuracy

RETRIEVAL_K_VALUES = (1, 5)


def _epoch_loss(embedder: ArcFaceEmbedder, head: ArcFaceHead, loader: DataLoader, optimizer=None) -> float:
    training = optimizer is not None
    embedder.train(training)
    head.train(training)
    total = 0.0
    count = 0
    for batch in loader:
        embeddings = embedder(batch["image"])
        loss = arcface_loss(embeddings, head, batch["label"])
        if training:
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        total += loss.item()
        count += 1
    return total / max(count, 1)


def _embed_all(embedder: ArcFaceEmbedder, loader: DataLoader) -> List[Dict[str, Any]]:
    embedder.eval()
    out: List[Dict[str, Any]] = []
    with torch.no_grad():
        for batch in loader:
            embeddings = embedder(batch["image"])
            for i, printing_id in enumerate(batch["printing_id"]):
                out.append({"printing_id": printing_id, "embedding": embeddings[i].tolist()})
    return out


def _build_gallery_and_queries(train_entries: List[Dict[str, Any]], val_entries: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """One gallery entry per class (the first TRAIN crop seen for that
    printing_id) — val crops are the queries. A val printing_id absent
    from the gallery (never seen in train, e.g. at this task's toy scale)
    is an honest, reportable miss via retrieval.topk_accuracy, not a
    crash."""
    gallery_by_id: Dict[str, Dict[str, Any]] = {}
    for entry in train_entries:
        gallery_by_id.setdefault(entry["printing_id"], entry)
    return list(gallery_by_id.values()), val_entries


def train_from_config(config: Dict[str, Any], now: Optional[float] = None) -> Dict[str, Any]:
    """Runs the full train -> synthetic-val retrieval -> checkpoint ->
    manifest pipeline for an already-validated config dict. Returns the
    written manifest."""
    started = now if now is not None else time.time()
    torch.manual_seed(config["seed"])

    samples = build_embed_dataset(config["datasetDir"])
    if not samples:
        raise ValueError("train_vision.embed_train: dataset has zero card crops — nothing to train on")
    class_index = build_class_index(samples)

    train_samples, val_samples = split_dataset(samples, config["valFraction"], config["seed"])
    if not train_samples:
        raise ValueError("train_vision.embed_train: empty train split — increase the dataset or lower valFraction")

    crop_size = config["cropSize"]
    train_loader = DataLoader(
        PrintingCropDataset(train_samples, class_index, crop_size), batch_size=config["train"]["batchSize"], shuffle=True, collate_fn=collate_embed_batch
    )
    eval_train_loader = DataLoader(
        PrintingCropDataset(train_samples, class_index, crop_size), batch_size=config["train"]["batchSize"], shuffle=False, collate_fn=collate_embed_batch
    )
    val_loader = DataLoader(
        PrintingCropDataset(val_samples, class_index, crop_size), batch_size=config["train"]["batchSize"], shuffle=False, collate_fn=collate_embed_batch
    ) if val_samples else None

    embedding_dim = config["embeddingDim"]
    embedder = ArcFaceEmbedder(embedding_dim=embedding_dim)
    head = ArcFaceHead(embedding_dim, len(class_index), margin=config["arcface"]["margin"], scale=config["arcface"]["scale"])
    optimizer = torch.optim.Adam(list(embedder.parameters()) + list(head.parameters()), lr=config["train"]["lr"])

    train_losses = []
    for _epoch in range(config["train"]["epochs"]):
        train_losses.append(_epoch_loss(embedder, head, train_loader, optimizer))

    gallery_entries: List[Dict[str, Any]] = []
    query_entries: List[Dict[str, Any]] = []
    if val_loader is not None:
        gallery_entries, query_entries = _build_gallery_and_queries(_embed_all(embedder, eval_train_loader), _embed_all(embedder, val_loader))

    if gallery_entries and query_entries:
        synthetic_val_retrieval = topk_accuracy(gallery_entries, query_entries, RETRIEVAL_K_VALUES)
        synthetic_val_retrieval_reason = None
    else:
        synthetic_val_retrieval = None
        synthetic_val_retrieval_reason = "no held-out val crops at this dataset size (valFraction too small or dataset too tiny) — synthetic-val retrieval needs at least 1 query"

    output_dir = config["outputDir"]
    os.makedirs(output_dir, exist_ok=True)
    checkpoint_path = os.path.join(output_dir, "checkpoint.pt")
    torch.save({"embedder": embedder.state_dict(), "head": head.state_dict(), "classIndex": class_index}, checkpoint_path)

    summary = {
        "architecture": config["architecture"],
        "embedderVersion": EMBEDDER_VERSION,
        "embeddingDim": embedding_dim,
        "configHash": config_hash(config),
        "datasetManifestHash": dataset_manifest_hash(config["datasetDir"]),
        "trainLosses": train_losses,
        "syntheticValRetrieval": synthetic_val_retrieval,
        "syntheticValRetrievalReason": synthetic_val_retrieval_reason,
        "sampleCounts": {"train": len(train_samples), "val": len(val_samples), "classes": len(class_index)},
        "licenses": dict(EMBEDDER_LICENSES),
        "wallClockSec": time.time() - started,
    }
    with open(os.path.join(output_dir, "embed-train-summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")

    manifest = build_embed_run_manifest(
        run_id=os.path.basename(os.path.normpath(output_dir)),
        architecture=config["architecture"],
        config=config,
        dataset_dir=config["datasetDir"],
        seed=config["seed"],
        embedding_dim=embedding_dim,
        metrics={
            "syntheticValRetrieval": synthetic_val_retrieval,
            "syntheticValRetrievalReason": synthetic_val_retrieval_reason,
            # Real-photo-benchmark top-1 is QA-gated per this issue's scope
            # note (the user hasn't shot APP-025's real-photo benchmark
            # photos yet) — recorded honestly as null with a reason, never
            # fabricated or silently omitted. This is the actual G3 metric.
            "realPhotoBenchmarkTop1": None,
            "realPhotoBenchmarkReason": "QA-gated: APP-025's real-photo benchmark photo set has not been shot yet (issue #140 scope note).",
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
    parser = argparse.ArgumentParser(description="Train the APP-028 ArcFace recognition embedder from a config file.")
    parser.add_argument("--config", required=True, help="Path to a JSON config file (see embed_config.py's validate_embed_config).")
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        raw_config = json.load(f)
    result = validate_embed_config(raw_config)
    if not result.valid:
        raise SystemExit("invalid config:\n" + "\n".join(f"  - {e}" for e in result.errors))

    manifest = train_from_config(result.config)
    print(json.dumps({"manifest": manifest}, indent=2))


if __name__ == "__main__":
    main()
