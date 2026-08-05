"""OBB detector checkpoint-evaluation entry point (issue #139 scope
addition): real (if tiny) CPU integration coverage for eval_obb.py's
eval_from_config, mirroring test_train_integration.py's philosophy — this
proves the pipeline produces a complete, well-formed, honest eval-summary
for a real run; it does NOT pin exact mAP values (that's map_eval.py's own
hand-computed tests' job).
"""
import json
import os
from unittest.mock import patch

import pytest
import torch
from PIL import Image

from train_vision.eval_obb import eval_from_config
from train_vision.model import ObbCenterNet

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run-64")


def _config(checkpoint_path, dataset_dir, output_dir, **overrides):
    cfg = {
        "architecture": "obb-centernet-tiny",
        "checkpointPath": checkpoint_path,
        "datasetDir": dataset_dir,
        "stride": 8,
        "batchSize": 2,
        "iouThresholds": [0.5, 0.75],
        "outputDir": output_dir,
    }
    cfg.update(overrides)
    return cfg


def _save_checkpoint(tmp_path, stride=8) -> str:
    checkpoint_path = str(tmp_path / "checkpoint.pt")
    model = ObbCenterNet(stride=stride)
    torch.save(model.state_dict(), checkpoint_path)
    return checkpoint_path


def test_eval_from_config_writes_a_complete_eval_summary(tmp_path):
    checkpoint_path = _save_checkpoint(tmp_path)
    output_dir = str(tmp_path / "eval-out")

    summary = eval_from_config(_config(checkpoint_path, FIXTURE_DIR, output_dir))

    summary_path = os.path.join(output_dir, "eval-summary.json")
    assert os.path.exists(summary_path)
    with open(summary_path) as f:
        on_disk = json.load(f)
    assert on_disk == summary

    assert isinstance(summary["mAP"], float)
    assert summary["perThreshold"].keys() == {"0.5", "0.75"}
    assert summary["checkpointPath"] == checkpoint_path
    assert isinstance(summary["datasetManifestHash"], str) and len(summary["datasetManifestHash"]) == 64
    assert summary["device"] == "cpu"


def test_eval_from_config_evaluates_the_full_dataset_never_splitting_it(tmp_path):
    # The fixture has 4 composites. A held-out real-photo eval set must be
    # scored in FULL — splitting it into its own train/val subsets (the
    # way the synthetic composites dataset does) would be a category
    # error: there is nothing to "train" on here, and it would silently
    # shrink the reported sample size.
    checkpoint_path = _save_checkpoint(tmp_path)
    output_dir = str(tmp_path / "eval-out")

    summary = eval_from_config(_config(checkpoint_path, FIXTURE_DIR, output_dir))

    assert summary["imageCount"] == 4


def test_eval_from_config_reports_the_thin_sample_size_honestly_without_rounding(tmp_path):
    # 16 real photos (or, here, 4 fixture composites) is a thin instrument
    # — imageCount must be the exact integer, never rounded/bucketed in a
    # way that could read as if it came from a larger set.
    checkpoint_path = _save_checkpoint(tmp_path)
    output_dir = str(tmp_path / "eval-out")

    summary = eval_from_config(_config(checkpoint_path, FIXTURE_DIR, output_dir))

    assert summary["imageCount"] == 4
    assert isinstance(summary["imageCount"], int)


def test_eval_from_config_loads_the_checkpoint_with_map_location_cpu(tmp_path):
    # The real, motivating case: a checkpoint trained on a remote GPU
    # (RTX 5090) must load on a CPU-only eval machine. There's no GPU in
    # this environment to prove the cross-device load end-to-end, so this
    # locks the actual torch.load call site instead — the one thing that
    # makes that scenario work at all.
    checkpoint_path = _save_checkpoint(tmp_path)
    output_dir = str(tmp_path / "eval-out")

    real_load = torch.load
    with patch("train_vision.eval_obb.torch.load", wraps=real_load) as mock_load:
        eval_from_config(_config(checkpoint_path, FIXTURE_DIR, output_dir))

    mock_load.assert_called_once()
    _, kwargs = mock_load.call_args
    assert kwargs.get("map_location") == "cpu"


def test_eval_from_config_records_the_device_actually_used(tmp_path):
    checkpoint_path = _save_checkpoint(tmp_path)
    output_dir = str(tmp_path / "eval-out")

    summary = eval_from_config(_config(checkpoint_path, FIXTURE_DIR, output_dir, device="cpu"))
    assert summary["device"] == "cpu"


def test_eval_from_config_defaults_device_to_cpu_when_the_config_omits_it(tmp_path):
    checkpoint_path = _save_checkpoint(tmp_path)
    output_dir = str(tmp_path / "eval-out")

    # _config() never sets "device" — eval_from_config is called directly
    # here (bypassing validate_eval_config's own normalize-to-"cpu"
    # default), so this locks that the function itself is defensive about
    # a missing key, the same way train_from_config's callers rely on it.
    cfg = _config(checkpoint_path, FIXTURE_DIR, output_dir)
    assert "device" not in cfg

    summary = eval_from_config(cfg)
    assert summary["device"] == "cpu"


# --- amodal ground-truth counting ---------------------------------------


def _write_tiny_dataset_dir(base_dir: str, corners) -> str:
    """A minimal, hand-built dataset dir (manifest.json + one <id>.png +
    one <id>.json) with exactly one card whose corners the caller controls
    — used to pin the off-canvas ground-truth-counting contract without
    disturbing the shared composites-run-64 fixture (whose one card per
    composite is always fully on-canvas)."""
    os.makedirs(base_dir, exist_ok=True)
    Image.new("RGB", (16, 16), color=(10, 20, 30)).save(os.path.join(base_dir, "item-0.png"))
    label = {
        "compositeId": "item-0",
        "fileName": "item-0.png",
        "width": 16,
        "height": 16,
        "backgroundType": "solid",
        "cards": [{"printingId": "printing-0", "corners": corners, "tags": []}],
    }
    with open(os.path.join(base_dir, "item-0.json"), "w") as f:
        json.dump(label, f)
    manifest = {
        "schemaVersion": "0.1.0",
        "buildDate": "2026-08-05T00:00:00.000Z",
        "seed": 1,
        "generatorConfigHash": "fixture-hash",
        "compositeCount": 1,
        "composites": [{"compositeId": "item-0", "fileName": "item-0.png", "cardCount": 1, "labelFileHash": "fixture"}],
    }
    with open(os.path.join(base_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)
    return base_dir


def test_eval_from_config_counts_an_off_canvas_card_as_ground_truth_amodally(tmp_path):
    # AMODAL CONTRACT (map_eval.py's own doc comment): a card whose true
    # center falls off-canvas has NO supervisable heatmap cell (encode.py
    # excludes it from obb_targets) but IS still real ground truth
    # (raw_obbs). groundTruthBoxCount must come from the amodal source
    # (raw_obbs), never the supervisable-only one (obb_targets) — an
    # off-canvas card must still count.
    dataset_dir = _write_tiny_dataset_dir(
        str(tmp_path / "off-canvas-dataset"),
        corners=[{"x": -500, "y": -500}, {"x": -400, "y": -500}, {"x": -400, "y": -400}, {"x": -500, "y": -400}],
    )
    checkpoint_path = _save_checkpoint(tmp_path, stride=8)
    output_dir = str(tmp_path / "eval-out")

    summary = eval_from_config(_config(checkpoint_path, dataset_dir, output_dir, stride=8, batchSize=1))

    assert summary["imageCount"] == 1
    assert summary["groundTruthBoxCount"] == 1


def test_eval_from_config_raises_on_an_empty_dataset_dir_rather_than_silently_reporting_zero(tmp_path):
    empty_dir = str(tmp_path / "empty-dataset")
    os.makedirs(empty_dir, exist_ok=True)
    manifest = {"schemaVersion": "0.1.0", "compositeCount": 0, "composites": []}
    with open(os.path.join(empty_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)

    checkpoint_path = _save_checkpoint(tmp_path)
    with pytest.raises(ValueError, match="nothing to evaluate"):
        eval_from_config(_config(checkpoint_path, empty_dir, str(tmp_path / "eval-out")))
