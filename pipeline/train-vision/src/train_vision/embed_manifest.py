"""Run manifest builder for the recognition embedder (APP-028, SPEC-APP.md
§8.7d AC: "embedding dim/version in manifest"). Mirrors manifest.py's role
for the detector, reusing its generic config_hash/dataset_manifest_hash
utilities (pure hashing, no detector-specific assumptions) — only the
manifest's OWN shape differs (embeddingDim/embedderVersion fields the
detector's manifest has no use for).
"""
from typing import Any, Dict, Optional

from .embed_licenses import EMBEDDER_LICENSES
from .licenses import validate_licenses
from .manifest import SCHEMA_VERSION, config_hash, dataset_manifest_hash

# Bumped whenever a change to the embedder's architecture, training
# recipe, or crop/normalization convention would invalidate previously
# computed embedding vectors — APP-085's knowledge-pack builder refuses a
# delta pack across an embedder-version change (SPEC-APP.md §8.8), so
# this constant is a real compatibility boundary, not just documentation.
EMBEDDER_VERSION = "0.1.0"


def build_embed_run_manifest(
    *,
    run_id: str,
    architecture: str,
    config: Dict[str, Any],
    dataset_dir: str,
    seed: int,
    embedding_dim: int,
    metrics: Dict[str, Optional[Any]],
    environment: Dict[str, Any],
    dispatch: Dict[str, Any],
    artifacts: Dict[str, Any],
    status: str,
    timestamps: Dict[str, Any],
) -> Dict[str, Any]:
    """Refuses to return anything (raises ValueError, via
    licenses.validate_licenses) if the recorded license table contains an
    empty, unrecognized, or copyleft identifier — SPEC-APP.md §13
    Invariant 9 made mechanical, same as the detector's manifest.py."""
    validate_licenses(EMBEDDER_LICENSES)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "runId": run_id,
        "architecture": architecture,
        "embedderVersion": EMBEDDER_VERSION,
        "embeddingDim": embedding_dim,
        "configHash": config_hash(config),
        "dataset": {"dir": dataset_dir, "manifestHash": dataset_manifest_hash(dataset_dir)},
        "seed": seed,
        "metrics": metrics,
        "licenses": dict(EMBEDDER_LICENSES),
        "environment": environment,
        "dispatch": dispatch,
        "artifacts": artifacts,
        "timestamps": timestamps,
        "status": status,
    }
