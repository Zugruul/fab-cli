"""Training/export config schema validation for the recognition embedder
(APP-028). Mirrors test_config.py's style for the detector: collect every
violation in one pass rather than stopping at the first.
"""
import pytest

from train_vision.embed_config import validate_embed_config, validate_embed_export_config

VALID = {
    "architecture": "arcface-embedder-tiny",
    "seed": 1234,
    "datasetDir": "/tmp/composites-run",
    "valFraction": 0.1,
    "cropSize": 64,
    "embeddingDim": 256,
    "arcface": {"margin": 0.5, "scale": 64.0},
    "train": {"epochs": 2, "batchSize": 4, "lr": 0.001},
    "outputDir": "/tmp/embed-train-out",
}


def test_accepts_a_fully_valid_config():
    result = validate_embed_config(dict(VALID))
    assert result.valid is True
    assert result.config["embeddingDim"] == 256


def test_rejects_missing_required_keys_reporting_every_violation():
    result = validate_embed_config({})
    assert result.valid is False
    joined = " ".join(result.errors)
    for key in ["architecture", "seed", "datasetDir", "valFraction", "cropSize", "embeddingDim", "arcface", "train", "outputDir"]:
        assert key in joined, f"expected an error mentioning {key!r}, got: {result.errors}"


def test_rejects_unknown_architecture_identifier():
    cfg = dict(VALID)
    cfg["architecture"] = "resnet50-imagenet"
    result = validate_embed_config(cfg)
    assert result.valid is False
    assert any("architecture" in e for e in result.errors)


def test_rejects_non_positive_crop_size():
    cfg = dict(VALID)
    cfg["cropSize"] = 0
    result = validate_embed_config(cfg)
    assert result.valid is False
    assert any("cropSize" in e for e in result.errors)


def test_rejects_non_positive_embedding_dim():
    cfg = dict(VALID)
    cfg["embeddingDim"] = -1
    result = validate_embed_config(cfg)
    assert result.valid is False
    assert any("embeddingDim" in e for e in result.errors)


def test_rejects_malformed_arcface_block_collecting_each_sub_violation():
    cfg = dict(VALID)
    cfg["arcface"] = {"margin": -0.1, "scale": 0}
    result = validate_embed_config(cfg)
    assert result.valid is False
    joined = " ".join(result.errors)
    assert "arcface.margin" in joined
    assert "arcface.scale" in joined


def test_rejects_malformed_train_block():
    cfg = dict(VALID)
    cfg["train"] = {"epochs": 0, "batchSize": -1, "lr": 0}
    result = validate_embed_config(cfg)
    assert result.valid is False
    joined = " ".join(result.errors)
    assert "train.epochs" in joined
    assert "train.batchSize" in joined
    assert "train.lr" in joined


def test_rejects_val_fraction_out_of_range():
    for bad in (-0.1, 1.0, 1.5):
        cfg = dict(VALID)
        cfg["valFraction"] = bad
        result = validate_embed_config(cfg)
        assert result.valid is False
        assert any("valFraction" in e for e in result.errors)


def test_config_is_not_a_dict():
    result = validate_embed_config(["not", "a", "dict"])
    assert result.valid is False


# --- export config -----------------------------------------------------

VALID_EXPORT = {
    "architecture": "arcface-embedder-tiny",
    "checkpointPath": "/tmp/checkpoint.pt",
    "cropSize": 64,
    "embeddingDim": 256,
    "representativeDatasetDir": "/tmp/composites-run",
    "numRepresentativeSamples": 32,
    "outputPath": "/tmp/embedder.tflite",
}


def test_export_config_accepts_a_fully_valid_config():
    result = validate_embed_export_config(dict(VALID_EXPORT))
    assert result.valid is True


def test_export_config_rejects_missing_checkpoint_path():
    cfg = dict(VALID_EXPORT)
    del cfg["checkpointPath"]
    result = validate_embed_export_config(cfg)
    assert result.valid is False
    assert any("checkpointPath" in e for e in result.errors)


def test_export_config_rejects_non_positive_num_representative_samples():
    cfg = dict(VALID_EXPORT)
    cfg["numRepresentativeSamples"] = 0
    result = validate_embed_export_config(cfg)
    assert result.valid is False
    assert any("numRepresentativeSamples" in e for e in result.errors)


def test_export_config_rejects_unknown_architecture():
    cfg = dict(VALID_EXPORT)
    cfg["architecture"] = "yolo11-obb"
    result = validate_embed_export_config(cfg)
    assert result.valid is False
