"""Training config schema + validation (APP-027, SPEC-APP.md §8.7c).
Mirrors pipeline/src/composites/config.ts's validateGeneratorConfig style:
collects every violation rather than stopping at the first.

`architecture` is a closed enum on purpose (not a free-form string) — the
whole point of this task's licensing gate is that the architecture choice
is a recorded, deliberate decision (SPEC-APP.md §13 Invariant 9), not
something a config typo can silently swap out for an excluded one.
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Union

# The only architecture this package implements: a from-scratch (no
# pretrained weights) CenterNet-style single-class oriented-bounding-box
# head on a tiny hand-rolled Conv-BN-ReLU backbone (torch only — no
# torchvision import anywhere in this package). See model.py's doc comment
# and licenses.py's ARCHITECTURE_LICENSES for the full grounding.
KNOWN_ARCHITECTURES = {"obb-centernet-tiny"}

# Decode-time defaults for the OBB detector's score-threshold + NMS gate
# (issue #285). Defined HERE (not train.py) so validate_eval_config below
# can default/validate against the exact same constants train.py's decode
# path uses, with train.py importing them rather than redefining its own
# copy — a single source of truth, no risk of the two silently drifting
# apart.
#
# DECODE_SCORE_THRESHOLD: issue #285's measured sweep on the first full
# 25-epoch checkpoint found the model's real heatmap peaks sit at
# 0.167-0.290 — always BELOW the old hardcoded 0.3 default, which
# discarded ~all detections (2 dets / 96 GT boxes, mAP 0.0104 vs a
# measured-capable 0.185). mAP saturates by threshold 0.10 (0.1847), but
# 0.10 also emits 9,269 detections for 96 GT boxes — operationally absurd
# even before counting how much of that gain over 0.15 (0.1827) is noise
# NMS then has to clean up. 0.15 is chosen as the default: within 0.002
# mAP of the saturation point (0.1850 at 0.05) at a fraction of the raw
# candidate count (1,911 vs 25,548) BEFORE NMS even runs — the measured
# data, not the max-mAP value.
DECODE_SCORE_THRESHOLD = 0.15

# NMS_IOU_THRESHOLD: composites-generation.json deliberately places
# genuinely overlapping DISTINCT cards ~35% of the time
# (overlapProbability), offset by as little as 0.12 card-heights — real,
# separate ground-truth boxes can carry high mutual IoU. A low NMS
# threshold would merge those into one detection. 0.5 (the standard
# COCO-style choice) errs toward keeping genuinely separate overlapping
# cards distinct, accepting that some true duplicate detections around a
# single object survive uncollapsed — the safer failure mode of the two.
NMS_IOU_THRESHOLD = 0.5


def _validate_decode_threshold_keys(raw: Dict[str, Any], errors: List[str]) -> None:
    """Shared OPTIONAL-key validation for decodeScoreThreshold/
    nmsIouThreshold, used by both validate_config (train.py) and
    validate_eval_config (eval_obb.py) — collect-all-violations style,
    same as every other field in this module. Absence is never an error:
    an existing config that predates issue #285 keeps working unchanged.
    """
    if "decodeScoreThreshold" in raw:
        decode_threshold = raw["decodeScoreThreshold"]
        if (
            not isinstance(decode_threshold, (int, float))
            or isinstance(decode_threshold, bool)
            or not (0.0 <= decode_threshold <= 1.0)
        ):
            _err(errors, '"decodeScoreThreshold" must be a number in [0, 1] when provided')

    if "nmsIouThreshold" in raw:
        nms_iou_threshold = raw["nmsIouThreshold"]
        if (
            not isinstance(nms_iou_threshold, (int, float))
            or isinstance(nms_iou_threshold, bool)
            or not (0.0 <= nms_iou_threshold <= 1.0)
        ):
            _err(errors, '"nmsIouThreshold" must be a number in [0, 1] when provided')


@dataclass
class ConfigResult:
    valid: bool
    config: Dict[str, Any] = None
    errors: List[str] = None


def _err(errors: List[str], msg: str) -> None:
    errors.append(msg)


def validate_config(raw: Union[Dict[str, Any], Any]) -> ConfigResult:
    errors: List[str] = []
    if not isinstance(raw, dict):
        return ConfigResult(valid=False, errors=["config is not a JSON object"])

    architecture = raw.get("architecture")
    if architecture not in KNOWN_ARCHITECTURES:
        _err(errors, f'"architecture" must be one of {sorted(KNOWN_ARCHITECTURES)} (got {architecture!r})')

    seed = raw.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool):
        _err(errors, '"seed" must be an integer')

    dataset_dir = raw.get("datasetDir")
    if not isinstance(dataset_dir, str) or dataset_dir == "":
        _err(errors, '"datasetDir" must be a non-empty string')

    val_fraction = raw.get("valFraction")
    if not isinstance(val_fraction, (int, float)) or isinstance(val_fraction, bool) or not (0.0 <= val_fraction < 1.0):
        _err(errors, '"valFraction" must be a number in [0, 1)')

    stride = raw.get("stride")
    if not isinstance(stride, int) or isinstance(stride, bool) or stride <= 0:
        _err(errors, '"stride" must be a positive integer')

    train = raw.get("train")
    if not isinstance(train, dict):
        _err(errors, '"train" must be an object {epochs, batchSize, lr}')
    else:
        epochs = train.get("epochs")
        if not isinstance(epochs, int) or isinstance(epochs, bool) or epochs <= 0:
            _err(errors, '"train.epochs" must be a positive integer')
        batch_size = train.get("batchSize")
        if not isinstance(batch_size, int) or isinstance(batch_size, bool) or batch_size <= 0:
            _err(errors, '"train.batchSize" must be a positive integer')
        lr = train.get("lr")
        if not isinstance(lr, (int, float)) or isinstance(lr, bool) or lr <= 0:
            _err(errors, '"train.lr" must be a positive number')

    output_dir = raw.get("outputDir")
    if not isinstance(output_dir, str) or output_dir == "":
        _err(errors, '"outputDir" must be a non-empty string')

    _validate_decode_threshold_keys(raw, errors)

    if errors:
        return ConfigResult(valid=False, errors=errors)
    return ConfigResult(valid=True, config=raw)


def validate_export_config(raw: Union[Dict[str, Any], Any]) -> ConfigResult:
    """Config schema for export.py's torch -> tflite chain: an already-
    trained checkpoint, the architecture's stride (must match how the
    checkpoint was trained), a square canvas size for the traced sample
    input, and where to write the .tflite file."""
    errors: List[str] = []
    if not isinstance(raw, dict):
        return ConfigResult(valid=False, errors=["config is not a JSON object"])

    architecture = raw.get("architecture")
    if architecture not in KNOWN_ARCHITECTURES:
        _err(errors, f'"architecture" must be one of {sorted(KNOWN_ARCHITECTURES)} (got {architecture!r})')

    checkpoint_path = raw.get("checkpointPath")
    if not isinstance(checkpoint_path, str) or checkpoint_path == "":
        _err(errors, '"checkpointPath" must be a non-empty string')

    stride = raw.get("stride")
    if not isinstance(stride, int) or isinstance(stride, bool) or stride <= 0:
        _err(errors, '"stride" must be a positive integer')

    canvas_size = raw.get("canvasSize")
    if not isinstance(canvas_size, int) or isinstance(canvas_size, bool) or canvas_size <= 0:
        _err(errors, '"canvasSize" must be a positive integer')
    elif isinstance(stride, int) and stride > 0 and canvas_size % stride != 0:
        _err(errors, '"canvasSize" must be evenly divisible by "stride"')

    output_path = raw.get("outputPath")
    if not isinstance(output_path, str) or output_path == "":
        _err(errors, '"outputPath" must be a non-empty string')

    if errors:
        return ConfigResult(valid=False, errors=errors)
    return ConfigResult(valid=True, config=raw)


def validate_eval_config(raw: Union[Dict[str, Any], Any]) -> ConfigResult:
    """Config schema for eval_obb.py's checkpoint-evaluation entry point
    (issue #139 scope addition): an already-trained checkpoint, the
    held-out dataset dir to score it against IN FULL (no train/val split —
    see eval_obb.py's doc comment for why), the architecture's stride +
    a batchSize for the DataLoader, which IoU thresholds to compute mAP
    at, where to write eval-summary.json, and an optional device (default
    "cpu" — this repo has no device.py yet, see eval_obb.py's header)."""
    errors: List[str] = []
    if not isinstance(raw, dict):
        return ConfigResult(valid=False, errors=["config is not a JSON object"])

    architecture = raw.get("architecture")
    if architecture not in KNOWN_ARCHITECTURES:
        _err(errors, f'"architecture" must be one of {sorted(KNOWN_ARCHITECTURES)} (got {architecture!r})')

    checkpoint_path = raw.get("checkpointPath")
    if not isinstance(checkpoint_path, str) or checkpoint_path == "":
        _err(errors, '"checkpointPath" must be a non-empty string')

    dataset_dir = raw.get("datasetDir")
    if not isinstance(dataset_dir, str) or dataset_dir == "":
        _err(errors, '"datasetDir" must be a non-empty string')

    stride = raw.get("stride")
    if not isinstance(stride, int) or isinstance(stride, bool) or stride <= 0:
        _err(errors, '"stride" must be a positive integer')

    batch_size = raw.get("batchSize")
    if not isinstance(batch_size, int) or isinstance(batch_size, bool) or batch_size <= 0:
        _err(errors, '"batchSize" must be a positive integer')

    iou_thresholds = raw.get("iouThresholds")
    if (
        not isinstance(iou_thresholds, list)
        or len(iou_thresholds) == 0
        or not all(isinstance(t, (int, float)) and not isinstance(t, bool) for t in iou_thresholds)
    ):
        _err(errors, '"iouThresholds" must be a non-empty array of numbers')

    output_dir = raw.get("outputDir")
    if not isinstance(output_dir, str) or output_dir == "":
        _err(errors, '"outputDir" must be a non-empty string')

    device = raw.get("device", "cpu")
    if not isinstance(device, str) or device == "":
        _err(errors, '"device" must be a non-empty string when provided')

    decode_threshold = raw.get("decodeScoreThreshold", DECODE_SCORE_THRESHOLD)
    nms_iou_threshold = raw.get("nmsIouThreshold", NMS_IOU_THRESHOLD)
    _validate_decode_threshold_keys(raw, errors)

    if errors:
        return ConfigResult(valid=False, errors=errors)

    normalized = dict(raw)
    normalized["device"] = device
    normalized["decodeScoreThreshold"] = decode_threshold
    normalized["nmsIouThreshold"] = nms_iou_threshold
    return ConfigResult(valid=True, config=normalized)
