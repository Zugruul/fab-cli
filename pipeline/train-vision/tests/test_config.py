"""Training config schema validation (APP-027). Mirrors
pipeline/src/composites/config.ts's validateGeneratorConfig style: collect
every violation rather than stopping at the first, so a caller sees the
whole picture in one pass.
"""
import pytest

from train_vision.config import validate_config, validate_eval_config, validate_export_config

VALID = {
    "architecture": "obb-centernet-tiny",
    "seed": 1234,
    "datasetDir": "/tmp/composites-run",
    "valFraction": 0.1,
    "stride": 8,
    "train": {"epochs": 2, "batchSize": 4, "lr": 0.001},
    "outputDir": "/tmp/train-vision-out",
}


def test_accepts_a_fully_valid_config():
    result = validate_config(dict(VALID))
    assert result.valid is True
    assert result.config["seed"] == 1234


def test_rejects_missing_required_keys_reporting_every_violation():
    result = validate_config({})
    assert result.valid is False
    joined = " ".join(result.errors)
    for key in ["architecture", "seed", "datasetDir", "valFraction", "stride", "train", "outputDir"]:
        assert key in joined, f"expected an error mentioning {key!r}, got: {result.errors}"


def test_rejects_non_integer_seed():
    cfg = dict(VALID)
    cfg["seed"] = 1.5
    result = validate_config(cfg)
    assert result.valid is False
    assert any("seed" in e for e in result.errors)


def test_rejects_val_fraction_out_of_range():
    for bad in (-0.1, 1.0, 1.5):
        cfg = dict(VALID)
        cfg["valFraction"] = bad
        result = validate_config(cfg)
        assert result.valid is False
        assert any("valFraction" in e for e in result.errors)


def test_rejects_non_positive_stride():
    cfg = dict(VALID)
    cfg["stride"] = 0
    result = validate_config(cfg)
    assert result.valid is False
    assert any("stride" in e for e in result.errors)


def test_rejects_malformed_train_block_collecting_each_sub_violation():
    cfg = dict(VALID)
    cfg["train"] = {"epochs": 0, "batchSize": -1, "lr": 0}
    result = validate_config(cfg)
    assert result.valid is False
    joined = " ".join(result.errors)
    assert "train.epochs" in joined
    assert "train.batchSize" in joined
    assert "train.lr" in joined


def test_rejects_unknown_architecture_identifier():
    cfg = dict(VALID)
    cfg["architecture"] = "yolo11-obb"
    result = validate_config(cfg)
    assert result.valid is False
    assert any("architecture" in e for e in result.errors)


def test_config_is_not_a_dict():
    result = validate_config(["not", "a", "dict"])
    assert result.valid is False


# --- decode threshold + NMS (issue #285: hardcoded DECODE_SCORE_THRESHOLD
# sat above the trained model's real peak activation, plus no NMS) -------


def test_accepts_config_without_decode_threshold_or_nms_keys_unchanged():
    # Both keys are OPTIONAL -- an existing config that predates issue
    # #285 keeps working unchanged, with no error for their absence.
    result = validate_config(dict(VALID))
    assert result.valid is True


def test_accepts_a_valid_decode_score_threshold_and_nms_iou_threshold():
    cfg = dict(VALID)
    cfg["decodeScoreThreshold"] = 0.2
    cfg["nmsIouThreshold"] = 0.4
    result = validate_config(cfg)
    assert result.valid is True


def test_rejects_decode_score_threshold_out_of_range():
    for bad in (-0.1, 1.1):
        cfg = dict(VALID)
        cfg["decodeScoreThreshold"] = bad
        result = validate_config(cfg)
        assert result.valid is False
        assert any("decodeScoreThreshold" in e for e in result.errors)


def test_rejects_non_numeric_decode_score_threshold():
    cfg = dict(VALID)
    cfg["decodeScoreThreshold"] = "high"
    result = validate_config(cfg)
    assert result.valid is False
    assert any("decodeScoreThreshold" in e for e in result.errors)


def test_rejects_nms_iou_threshold_out_of_range():
    for bad in (-0.5, 1.5):
        cfg = dict(VALID)
        cfg["nmsIouThreshold"] = bad
        result = validate_config(cfg)
        assert result.valid is False
        assert any("nmsIouThreshold" in e for e in result.errors)


def test_rejects_non_numeric_nms_iou_threshold():
    cfg = dict(VALID)
    cfg["nmsIouThreshold"] = "high"
    result = validate_config(cfg)
    assert result.valid is False
    assert any("nmsIouThreshold" in e for e in result.errors)


# --- export config -----------------------------------------------------

VALID_EXPORT = {
    "architecture": "obb-centernet-tiny",
    "checkpointPath": "/tmp/checkpoint.pt",
    "stride": 8,
    "canvasSize": 128,
    "outputPath": "/tmp/model.tflite",
}


def test_export_config_accepts_a_fully_valid_config():
    result = validate_export_config(dict(VALID_EXPORT))
    assert result.valid is True


def test_export_config_rejects_canvas_size_not_divisible_by_stride():
    cfg = dict(VALID_EXPORT)
    cfg["canvasSize"] = 100  # not divisible by stride=8
    result = validate_export_config(cfg)
    assert result.valid is False
    assert any("canvasSize" in e for e in result.errors)


def test_export_config_rejects_missing_checkpoint_path():
    cfg = dict(VALID_EXPORT)
    del cfg["checkpointPath"]
    result = validate_export_config(cfg)
    assert result.valid is False
    assert any("checkpointPath" in e for e in result.errors)


def test_export_config_rejects_unknown_architecture():
    cfg = dict(VALID_EXPORT)
    cfg["architecture"] = "yolo11-obb"
    result = validate_export_config(cfg)
    assert result.valid is False


# --- eval config (issue #139 scope addition: checkpoint mAP evaluation) --

VALID_EVAL = {
    "architecture": "obb-centernet-tiny",
    "checkpointPath": "/tmp/checkpoint.pt",
    "datasetDir": "/tmp/real-photo-eval",
    "stride": 8,
    "batchSize": 4,
    "iouThresholds": [0.5, 0.75],
    "outputDir": "/tmp/eval-out",
}


def test_eval_config_accepts_a_fully_valid_config():
    result = validate_eval_config(dict(VALID_EVAL))
    assert result.valid is True
    assert result.config["stride"] == 8


def test_eval_config_defaults_device_to_cpu_when_omitted():
    result = validate_eval_config(dict(VALID_EVAL))
    assert result.valid is True
    assert result.config["device"] == "cpu"


def test_eval_config_accepts_an_explicit_device_override():
    cfg = dict(VALID_EVAL)
    cfg["device"] = "cuda:0"
    result = validate_eval_config(cfg)
    assert result.valid is True
    assert result.config["device"] == "cuda:0"


def test_eval_config_rejects_missing_required_keys_reporting_every_violation():
    result = validate_eval_config({})
    assert result.valid is False
    joined = " ".join(result.errors)
    for key in ["architecture", "checkpointPath", "datasetDir", "stride", "batchSize", "iouThresholds", "outputDir"]:
        assert key in joined, f"expected an error mentioning {key!r}, got: {result.errors}"


def test_eval_config_rejects_unknown_architecture():
    cfg = dict(VALID_EVAL)
    cfg["architecture"] = "yolo11-obb"
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("architecture" in e for e in result.errors)


def test_eval_config_rejects_empty_checkpoint_path():
    cfg = dict(VALID_EVAL)
    cfg["checkpointPath"] = ""
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("checkpointPath" in e for e in result.errors)


def test_eval_config_rejects_non_positive_stride():
    cfg = dict(VALID_EVAL)
    cfg["stride"] = 0
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("stride" in e for e in result.errors)


def test_eval_config_rejects_non_positive_batch_size():
    cfg = dict(VALID_EVAL)
    cfg["batchSize"] = -1
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("batchSize" in e for e in result.errors)


def test_eval_config_rejects_empty_iou_thresholds():
    cfg = dict(VALID_EVAL)
    cfg["iouThresholds"] = []
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("iouThresholds" in e for e in result.errors)


def test_eval_config_rejects_non_numeric_iou_thresholds():
    cfg = dict(VALID_EVAL)
    cfg["iouThresholds"] = [0.5, "high"]
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("iouThresholds" in e for e in result.errors)


def test_eval_config_rejects_iou_thresholds_that_is_not_a_list():
    cfg = dict(VALID_EVAL)
    cfg["iouThresholds"] = 0.5
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("iouThresholds" in e for e in result.errors)


def test_eval_config_rejects_empty_output_dir():
    cfg = dict(VALID_EVAL)
    cfg["outputDir"] = ""
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("outputDir" in e for e in result.errors)


def test_eval_config_rejects_empty_device_string():
    cfg = dict(VALID_EVAL)
    cfg["device"] = ""
    result = validate_eval_config(cfg)
    assert result.valid is False
    assert any("device" in e for e in result.errors)


def test_eval_config_rejects_multiple_missing_fields_at_once_not_just_the_first():
    # Same collect-all-violations discipline as validate_config/
    # validate_export_config — a caller must see every problem in one pass.
    cfg = {"architecture": "obb-centernet-tiny"}
    result = validate_eval_config(cfg)
    assert result.valid is False
    joined = " ".join(result.errors)
    for key in ["checkpointPath", "datasetDir", "stride", "batchSize", "iouThresholds", "outputDir"]:
        assert key in joined, f"expected an error mentioning {key!r}, got: {result.errors}"


def test_eval_config_is_not_a_dict():
    result = validate_eval_config(["not", "a", "dict"])
    assert result.valid is False


# --- decode threshold + NMS (issue #285) --------------------------------
# validate_eval_config normalizes these into the returned config (same
# established convention as its "device" default), so eval_from_config's
# caller always sees a concrete value even when the raw config omitted it.


def test_eval_config_accepts_omitted_decode_and_nms_keys_unchanged():
    result = validate_eval_config(dict(VALID_EVAL))
    assert result.valid is True


def test_eval_config_defaults_decode_score_threshold_when_omitted():
    result = validate_eval_config(dict(VALID_EVAL))
    assert result.valid is True
    assert result.config["decodeScoreThreshold"] == pytest.approx(0.15)


def test_eval_config_defaults_nms_iou_threshold_when_omitted():
    result = validate_eval_config(dict(VALID_EVAL))
    assert result.valid is True
    assert result.config["nmsIouThreshold"] == pytest.approx(0.5)


def test_eval_config_accepts_an_explicit_decode_score_threshold_override():
    cfg = dict(VALID_EVAL)
    cfg["decodeScoreThreshold"] = 0.1
    result = validate_eval_config(cfg)
    assert result.valid is True
    assert result.config["decodeScoreThreshold"] == pytest.approx(0.1)


def test_eval_config_accepts_an_explicit_nms_iou_threshold_override():
    cfg = dict(VALID_EVAL)
    cfg["nmsIouThreshold"] = 0.7
    result = validate_eval_config(cfg)
    assert result.valid is True
    assert result.config["nmsIouThreshold"] == pytest.approx(0.7)


def test_eval_config_rejects_decode_score_threshold_out_of_range():
    for bad in (-0.1, 1.1):
        cfg = dict(VALID_EVAL)
        cfg["decodeScoreThreshold"] = bad
        result = validate_eval_config(cfg)
        assert result.valid is False
        assert any("decodeScoreThreshold" in e for e in result.errors)


def test_eval_config_rejects_nms_iou_threshold_out_of_range():
    for bad in (-0.1, 1.1):
        cfg = dict(VALID_EVAL)
        cfg["nmsIouThreshold"] = bad
        result = validate_eval_config(cfg)
        assert result.valid is False
        assert any("nmsIouThreshold" in e for e in result.errors)
