"""Run manifest builder (APP-027, SPEC-APP.md §8.7c AC: "license of
architecture + training code recorded in manifest; mAP on synthetic val +
real-photo benchmark subset reported"). The manifest is the single
committed record tying together config hash, dataset hash, seed, licenses,
and metrics for one training run.
"""
import hashlib
import json
import os

import pytest

from train_vision.manifest import build_run_manifest, config_hash, dataset_manifest_hash

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")


def test_config_hash_is_stable_sha256_of_canonical_json():
    config = {"b": 2, "a": 1}
    reordered = {"a": 1, "b": 2}
    # Key order must not matter — a config re-serialized with different key
    # order is still the same config.
    assert config_hash(config) == config_hash(reordered)
    assert config_hash(config) == hashlib.sha256(json.dumps({"a": 1, "b": 2}, sort_keys=True).encode("utf-8")).hexdigest()


def test_config_hash_changes_when_config_changes():
    assert config_hash({"a": 1}) != config_hash({"a": 2})


def test_dataset_manifest_hash_matches_real_manifest_json_bytes():
    manifest_path = os.path.join(FIXTURE_DIR, "manifest.json")
    expected = hashlib.sha256(open(manifest_path, "rb").read()).hexdigest()
    assert dataset_manifest_hash(FIXTURE_DIR) == expected


def test_dataset_manifest_hash_raises_when_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        dataset_manifest_hash(str(tmp_path))


def _base_kwargs(**overrides):
    kwargs = dict(
        run_id="run-001",
        architecture="obb-centernet-mnv3s",
        config={"seed": 1, "architecture": "obb-centernet-mnv3s"},
        dataset_dir=FIXTURE_DIR,
        seed=1,
        metrics={"syntheticVal": {"mAP": 0.5, "perThreshold": {"0.5": 0.5}}, "realPhotoBenchmark": None},
        environment={"torch": "2.9.0", "cuda": None, "driver": None, "gpu": None},
        dispatch={"resource": "local", "jobId": "local-smoke", "capabilityJob": "local"},
        artifacts={"checkpointDir": None, "tfliteFiles": []},
        status="completed",
        timestamps={"dispatchedAt": "2026-08-03T00:00:00.000Z", "completedAt": "2026-08-03T00:01:00.000Z"},
    )
    kwargs.update(overrides)
    return kwargs


def test_build_run_manifest_includes_config_and_dataset_hashes():
    manifest = build_run_manifest(**_base_kwargs())
    assert manifest["configHash"] == config_hash(_base_kwargs()["config"])
    assert manifest["dataset"]["manifestHash"] == dataset_manifest_hash(FIXTURE_DIR)
    assert manifest["runId"] == "run-001"
    assert manifest["seed"] == 1
    assert manifest["status"] == "completed"


def test_build_run_manifest_includes_the_full_license_table():
    manifest = build_run_manifest(**_base_kwargs())
    assert manifest["licenses"]["trainingCode"] == "MIT"
    assert manifest["licenses"]["torch"] == "BSD-3-Clause"
    assert manifest["licenses"]["litertTorch"] == "Apache-2.0"


def test_build_run_manifest_refuses_when_a_license_field_is_forced_empty(monkeypatch):
    import train_vision.manifest as manifest_module

    monkeypatch.setattr(manifest_module, "ARCHITECTURE_LICENSES", {"trainingCode": ""})
    with pytest.raises(ValueError, match="empty"):
        build_run_manifest(**_base_kwargs())


def test_build_run_manifest_refuses_an_unknown_license_identifier(monkeypatch):
    import train_vision.manifest as manifest_module

    monkeypatch.setattr(manifest_module, "ARCHITECTURE_LICENSES", {"trainingCode": "AGPL-3.0"})
    with pytest.raises(ValueError, match="copyleft"):
        build_run_manifest(**_base_kwargs())


def test_build_run_manifest_records_metrics_verbatim_including_null_real_photo_benchmark():
    # Real-photo-benchmark mAP is QA-gated (the user hasn't shot photos
    # yet, per the issue's scope note) — recorded honestly as null with a
    # reason, never fabricated as 0 or omitted.
    manifest = build_run_manifest(**_base_kwargs())
    assert manifest["metrics"]["realPhotoBenchmark"] is None
    assert manifest["metrics"]["syntheticVal"]["mAP"] == pytest.approx(0.5)


def test_build_run_manifest_schema_version_present():
    manifest = build_run_manifest(**_base_kwargs())
    assert isinstance(manifest["schemaVersion"], str) and manifest["schemaVersion"] != ""
