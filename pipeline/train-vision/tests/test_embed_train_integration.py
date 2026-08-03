"""End-to-end embed_train_from_config integration test (APP-028): real
torch training (CPU, tiny fixture, 1 epoch) through the exact code path
`python3 -m train_vision.embed_train --config ...` uses, verifying every
output artifact/manifest field this task's AC requires actually lands on
disk. Numeric loss values aren't pinned here (test_arcface_loss.py's
hand-computed tests cover the math) -- this test's job is proving the
pipeline produces a complete, honest manifest for a real (if tiny) run.
"""
import json
import os

from train_vision.embed_train import train_from_config

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")


def _config(output_dir, **overrides):
    cfg = {
        "architecture": "arcface-embedder-tiny",
        "seed": 7,
        "datasetDir": FIXTURE_DIR,
        "valFraction": 0.25,
        "cropSize": 16,
        "embeddingDim": 8,
        "arcface": {"margin": 0.3, "scale": 16.0},
        "train": {"epochs": 1, "batchSize": 2, "lr": 0.001},
        "outputDir": output_dir,
    }
    cfg.update(overrides)
    return cfg


def test_embed_train_from_config_writes_checkpoint_summary_and_manifest(tmp_path):
    output_dir = str(tmp_path / "run-1")
    manifest = train_from_config(_config(output_dir))

    assert os.path.exists(os.path.join(output_dir, "checkpoint.pt"))
    assert os.path.exists(os.path.join(output_dir, "embed-train-summary.json"))
    assert os.path.exists(os.path.join(output_dir, "manifest.json"))

    with open(os.path.join(output_dir, "manifest.json")) as f:
        on_disk_manifest = json.load(f)
    assert on_disk_manifest == manifest


def test_embed_train_summary_has_the_fields_a_ts_runner_needs(tmp_path):
    output_dir = str(tmp_path / "run-2")
    train_from_config(_config(output_dir))

    with open(os.path.join(output_dir, "embed-train-summary.json")) as f:
        summary = json.load(f)

    assert isinstance(summary["configHash"], str) and len(summary["configHash"]) == 64
    assert isinstance(summary["datasetManifestHash"], str) and len(summary["datasetManifestHash"]) == 64
    assert summary["licenses"]["trainingCode"] == "MIT"
    assert summary["embeddingDim"] == 8
    assert len(summary["trainLosses"]) == 1  # one epoch
    # 4 total card crops in the fixture (composite-000/001/002); with
    # valFraction=0.25 -> round(4*0.25)=1 val, 3 train.
    assert summary["sampleCounts"]["train"] == 3
    assert summary["sampleCounts"]["val"] == 1
    assert summary["sampleCounts"]["classes"] == 4  # every card in this fixture is a distinct printingId


def test_embed_train_manifest_records_embedding_dim_and_null_real_photo_benchmark(tmp_path):
    output_dir = str(tmp_path / "run-3")
    manifest = train_from_config(_config(output_dir))
    assert manifest["embeddingDim"] == 8
    assert manifest["metrics"]["realPhotoBenchmarkTop1"] is None
    assert "APP-025" in manifest["metrics"]["realPhotoBenchmarkReason"]


def test_embed_train_synthetic_val_retrieval_is_reported_honestly_at_this_tiny_fixture_scale(tmp_path):
    # Every one of the 4 fixture cards is a UNIQUE printingId (no repeats),
    # so whichever single card lands in the val split is a class the
    # train-built gallery has never seen -- a deterministic, honest 0%
    # top-1/top5 at this toy scale (never inflated), matching the
    # detector's own "expected near-zero mAP at smoke scale" precedent.
    output_dir = str(tmp_path / "run-4")
    manifest = train_from_config(_config(output_dir))
    retrieval = manifest["metrics"]["syntheticValRetrieval"]
    assert retrieval is not None
    assert retrieval["queryCount"] == 1
    assert retrieval["top1"] == 0.0


def test_embed_train_from_config_is_deterministic_for_the_same_seed(tmp_path):
    out_a = str(tmp_path / "run-a")
    out_b = str(tmp_path / "run-b")
    manifest_a = train_from_config(_config(out_a, seed=99))
    manifest_b = train_from_config(_config(out_b, seed=99))
    assert manifest_a["metrics"]["syntheticValRetrieval"] == manifest_b["metrics"]["syntheticValRetrieval"]


def test_embed_train_from_config_rejects_an_empty_dataset(tmp_path):
    import pytest

    empty_dir = tmp_path / "empty-composites-run"
    empty_dir.mkdir()
    (empty_dir / "manifest.json").write_text(json.dumps({"composites": []}))

    with pytest.raises(ValueError, match="zero card crops"):
        train_from_config(_config(str(tmp_path / "run-empty"), datasetDir=str(empty_dir)))
