"""Run manifest builder (APP-027, SPEC-APP.md §8.7c AC: "license of
architecture + training code recorded in manifest; mAP on synthetic val +
real-photo benchmark subset reported"). Mirrors pipeline/src/composites/
manifest.ts and pipeline/src/export/types.ts's discipline: a small,
committed JSON tying config hash + dataset hash + seed + licenses +
metrics together for one run, built once a run reaches a terminal state.
"""
import hashlib
import json
import os
from typing import Any, Dict, Optional

from .licenses import ARCHITECTURE_LICENSES, validate_licenses

SCHEMA_VERSION = "0.1.0"


def config_hash(config: Dict[str, Any]) -> str:
    """sha256 of the config's canonical (key-sorted) JSON serialization —
    key order must never change the hash, mirroring pipeline/src/qa/
    manifest.ts's configHash's "hash the meaning, not the bytes" stance."""
    canonical = json.dumps(config, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def dataset_manifest_hash(dataset_dir: str) -> str:
    """sha256 of the composites-generator run's manifest.json bytes exactly
    as written (pipeline/src/composites/write.ts) — a content-addressed
    pointer to the exact dataset a run trained against."""
    manifest_path = os.path.join(dataset_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"dataset_manifest_hash: no manifest.json found at {manifest_path}")
    with open(manifest_path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def build_run_manifest(
    *,
    run_id: str,
    architecture: str,
    config: Dict[str, Any],
    dataset_dir: str,
    seed: int,
    metrics: Dict[str, Optional[Dict[str, Any]]],
    environment: Dict[str, Any],
    dispatch: Dict[str, Any],
    artifacts: Dict[str, Any],
    status: str,
    timestamps: Dict[str, Any],
) -> Dict[str, Any]:
    """Builds the committed per-run manifest. Refuses to return anything
    (raises ValueError, via licenses.validate_licenses) if the recorded
    license table contains an empty, unrecognized, or copyleft identifier —
    SPEC-APP.md §13 Invariant 9 made mechanical, not just documented."""
    validate_licenses(ARCHITECTURE_LICENSES)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "runId": run_id,
        "architecture": architecture,
        "configHash": config_hash(config),
        "dataset": {"dir": dataset_dir, "manifestHash": dataset_manifest_hash(dataset_dir)},
        "seed": seed,
        "metrics": metrics,
        "licenses": dict(ARCHITECTURE_LICENSES),
        "environment": environment,
        "dispatch": dispatch,
        "artifacts": artifacts,
        "timestamps": timestamps,
        "status": status,
    }
