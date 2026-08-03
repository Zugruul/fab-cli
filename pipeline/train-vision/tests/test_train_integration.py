"""End-to-end train_from_config integration test (APP-027): real torch
training (CPU, tiny fixture, 1 epoch) through the exact same code path
`python3 -m train_vision.train --config ...` uses, verifying every output
artifact and manifest field this task's AC requires actually lands on
disk with the right shape/types — the numeric loss/mAP VALUES aren't
pinned here (that's what test_losses.py/test_model.py's hand-computed
tests are for); this test's job is proving the pipeline produces a
complete, well-formed, honest manifest for a real (if tiny) run.
"""
import json
import os

import pytest

from train_vision.train import train_from_config

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run-64")


def _config(output_dir, **overrides):
    cfg = {
        "architecture": "obb-centernet-tiny",
        "seed": 7,
        "datasetDir": FIXTURE_DIR,
        "valFraction": 0.25,
        "stride": 8,
        "train": {"epochs": 1, "batchSize": 2, "lr": 0.001},
        "outputDir": output_dir,
    }
    cfg.update(overrides)
    return cfg


def test_train_from_config_writes_checkpoint_summary_and_manifest(tmp_path):
    output_dir = str(tmp_path / "run-1")
    manifest = train_from_config(_config(output_dir))

    assert os.path.exists(os.path.join(output_dir, "checkpoint.pt"))
    assert os.path.exists(os.path.join(output_dir, "train-summary.json"))
    assert os.path.exists(os.path.join(output_dir, "manifest.json"))

    with open(os.path.join(output_dir, "manifest.json")) as f:
        on_disk_manifest = json.load(f)
    assert on_disk_manifest == manifest


def test_train_summary_has_the_fields_a_ts_runner_needs_without_local_dataset_access(tmp_path):
    output_dir = str(tmp_path / "run-2")
    train_from_config(_config(output_dir))

    with open(os.path.join(output_dir, "train-summary.json")) as f:
        summary = json.load(f)

    # configHash/datasetManifestHash are computed HERE (this script has
    # real access to datasetDir) so a future TS orchestration layer never
    # has to re-derive them from a dataset dir that may only exist on the
    # remote machine that ran this job.
    assert isinstance(summary["configHash"], str) and len(summary["configHash"]) == 64
    assert isinstance(summary["datasetManifestHash"], str) and len(summary["datasetManifestHash"]) == 64
    assert summary["licenses"]["trainingCode"] == "MIT"
    assert len(summary["trainLosses"]) == 1  # one epoch
    assert summary["sampleCounts"]["train"] + summary["sampleCounts"]["val"] == 4
    assert summary["syntheticValMAP"]["perThreshold"].keys() == {"0.5", "0.75"}


def test_manifest_records_null_real_photo_benchmark_with_a_reason(tmp_path):
    output_dir = str(tmp_path / "run-3")
    manifest = train_from_config(_config(output_dir))
    assert manifest["metrics"]["realPhotoBenchmark"] is None
    assert "APP-025" in manifest["metrics"]["realPhotoBenchmarkReason"]


def test_train_from_config_is_deterministic_for_the_same_seed(tmp_path):
    out_a = str(tmp_path / "run-a")
    out_b = str(tmp_path / "run-b")
    manifest_a = train_from_config(_config(out_a, seed=99))
    manifest_b = train_from_config(_config(out_b, seed=99))
    assert manifest_a["metrics"]["syntheticVal"] == manifest_b["metrics"]["syntheticVal"]


def test_train_from_config_rejects_mismatched_canvas_sizes(tmp_path):
    # Build a second fixture dir referencing a composite with a DIFFERENT
    # canvas size than the rest, to exercise _validate_canvas_for_stride's
    # fail-fast guard (a merged/mismatched dataset dir must never silently
    # crash mid-training with an opaque tensor-shape error).
    import shutil

    bad_dir = str(tmp_path / "bad-dataset")
    shutil.copytree(FIXTURE_DIR, bad_dir)
    label_path = os.path.join(bad_dir, "composite-000.json")
    with open(label_path) as f:
        label = json.load(f)
    label["width"] = 96  # no longer matches the other 3 composites' 64x64
    with open(label_path, "w") as f:
        json.dump(label, f)

    with pytest.raises(ValueError, match="expected every composite"):
        train_from_config(_config(str(tmp_path / "run-bad"), datasetDir=bad_dir))
