"""Run manifest builder for the recognition embedder (APP-028, SPEC-APP.md
§8.7d AC: "embedding dim/version in manifest"). Mirrors test_manifest.py's
style for the detector; reuses manifest.py's config_hash/
dataset_manifest_hash directly (generic hashing, no detector-specific
assumptions) so this file only tests what's genuinely different: the
embedder's OWN manifest shape (embeddingDim/embedderVersion).
"""
import os

import pytest

from train_vision.embed_manifest import EMBEDDER_VERSION, build_embed_run_manifest
from train_vision.manifest import config_hash, dataset_manifest_hash

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")


def _base_kwargs(**overrides):
    kwargs = dict(
        run_id="embed-run-001",
        architecture="arcface-embedder-tiny",
        config={"seed": 1, "architecture": "arcface-embedder-tiny"},
        dataset_dir=FIXTURE_DIR,
        seed=1,
        embedding_dim=256,
        metrics={
            "syntheticValRetrieval": {"top1": 0.5, "top5": 0.9, "queryCount": 10},
            "syntheticValRetrievalReason": None,
            "realPhotoBenchmarkTop1": None,
            "realPhotoBenchmarkReason": "not shot yet",
        },
        environment={"torch": "2.9.0", "cuda": None, "driver": None, "gpu": None},
        dispatch={"resource": "local", "jobId": "local-smoke", "capabilityJob": "local"},
        artifacts={"checkpointPath": None, "tfliteFiles": []},
        status="completed",
        timestamps={"dispatchedAt": "2026-08-03T00:00:00.000Z", "completedAt": "2026-08-03T00:01:00.000Z"},
    )
    kwargs.update(overrides)
    return kwargs


def test_build_embed_run_manifest_records_embedding_dim_and_embedder_version():
    manifest = build_embed_run_manifest(**_base_kwargs())
    assert manifest["embeddingDim"] == 256
    assert manifest["embedderVersion"] == EMBEDDER_VERSION
    assert isinstance(EMBEDDER_VERSION, str) and EMBEDDER_VERSION != ""


def test_build_embed_run_manifest_reuses_the_same_hashing_as_the_detector_manifest():
    manifest = build_embed_run_manifest(**_base_kwargs())
    assert manifest["configHash"] == config_hash(_base_kwargs()["config"])
    assert manifest["dataset"]["manifestHash"] == dataset_manifest_hash(FIXTURE_DIR)


def test_build_embed_run_manifest_includes_the_full_license_table():
    manifest = build_embed_run_manifest(**_base_kwargs())
    assert manifest["licenses"]["trainingCode"] == "MIT"
    assert manifest["licenses"]["aiEdgeQuantizer"] == "Apache-2.0"


def test_build_embed_run_manifest_refuses_when_a_license_field_is_forced_empty(monkeypatch):
    import train_vision.embed_manifest as embed_manifest_module

    monkeypatch.setattr(embed_manifest_module, "EMBEDDER_LICENSES", {"trainingCode": ""})
    with pytest.raises(ValueError, match="empty"):
        build_embed_run_manifest(**_base_kwargs())


def test_build_embed_run_manifest_records_metrics_verbatim_including_null_real_photo_benchmark():
    manifest = build_embed_run_manifest(**_base_kwargs())
    assert manifest["metrics"]["realPhotoBenchmarkTop1"] is None
    assert manifest["metrics"]["syntheticValRetrieval"]["top1"] == pytest.approx(0.5)


def test_build_embed_run_manifest_schema_version_present():
    manifest = build_embed_run_manifest(**_base_kwargs())
    assert isinstance(manifest["schemaVersion"], str) and manifest["schemaVersion"] != ""
