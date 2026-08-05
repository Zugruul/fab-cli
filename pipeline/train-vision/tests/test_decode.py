"""Regression lock for train.py's `_decode_predictions` (APP-027, PR #239
review). Pins the exact encode/train -> tensor -> decode channel-order
contract (offset[0]=dx, offset[1]=dy; size[0]=log(w), size[1]=log(h);
angle[0]=sin(theta), angle[1]=cos(theta)) against a hand-built,
known-value model-output tensor and asserts the exact decoded
(cx, cy, w, h, theta) — mirroring APP-025's sha256-vector precedent: a
pinned value, not a shape check, so a future edit that silently swaps two
channels (e.g. offset x/y, or size/angle) fails loudly here even though
every other test (which round-trips through the SAME encode/decode
symmetrically) would stay green.
"""
import math

import pytest
import torch

from train_vision.train import DECODE_SCORE_THRESHOLD, NMS_IOU_THRESHOLD, _decode_predictions

STRIDE = 8


def _zero_output(grid_h: int, grid_w: int) -> dict:
    return {
        "heatmap": torch.zeros(1, 1, grid_h, grid_w),
        "offset": torch.zeros(1, 2, grid_h, grid_w),
        "size": torch.zeros(1, 2, grid_h, grid_w),
        "angle": torch.zeros(1, 2, grid_h, grid_w),
    }


def test_decode_predictions_exact_values_for_one_known_cell():
    grid_h, grid_w = 4, 5
    gy, gx = 2, 3
    out = _zero_output(grid_h, grid_w)

    out["heatmap"][0, 0, gy, gx] = 0.9  # above the module's default DECODE_SCORE_THRESHOLD
    out["offset"][0, 0, gy, gx] = 0.25  # dx
    out["offset"][0, 1, gy, gx] = 0.75  # dy
    out["size"][0, 0, gy, gx] = math.log(40.0)  # log(w)
    out["size"][0, 1, gy, gx] = math.log(20.0)  # log(h)
    theta = math.radians(30)
    out["angle"][0, 0, gy, gx] = math.sin(theta)
    out["angle"][0, 1, gy, gx] = math.cos(theta)

    decoded = _decode_predictions(out, stride=STRIDE)

    assert len(decoded) == 1  # one batch element
    dets = decoded[0]
    assert len(dets) == 1  # exactly the one cell above threshold
    cx, cy, w, h, decoded_theta = dets[0]["box"]

    # Exact, hand-computed expected values (not just shape/type checks):
    # cx = (gx + dx) * stride = (3 + 0.25) * 8 = 26.0
    # cy = (gy + dy) * stride = (2 + 0.75) * 8 = 22.0
    assert cx == pytest.approx(26.0)
    assert cy == pytest.approx(22.0)
    assert w == pytest.approx(40.0)
    assert h == pytest.approx(20.0)
    assert decoded_theta == pytest.approx(theta)
    assert dets[0]["score"] == pytest.approx(0.9)


def test_decode_predictions_below_threshold_cells_produce_no_detections():
    # threshold is passed explicitly (not the module default) so this test
    # pins the filtering behavior itself, independent of issue #285's
    # change to what that default actually is.
    grid_h, grid_w = 3, 3
    out = _zero_output(grid_h, grid_w)
    out["heatmap"][0, 0, 1, 1] = 0.29  # just under an explicit 0.3 threshold
    decoded = _decode_predictions(out, stride=STRIDE, threshold=0.3)
    assert decoded == [[]]


def test_decode_predictions_two_cells_decode_independently_with_correct_coordinates():
    grid_h, grid_w = 3, 3
    out = _zero_output(grid_h, grid_w)

    # Cell A: (gy=0, gx=0), zero offset/size/angle -> a "unit" box at the
    # cell's own top-left-aligned center.
    out["heatmap"][0, 0, 0, 0] = 1.0
    out["size"][0, 0, 0, 0] = math.log(10.0)
    out["size"][0, 1, 0, 0] = math.log(10.0)
    out["angle"][0, 1, 0, 0] = 1.0  # cos(0) = 1 -> theta = 0

    # Cell B: (gy=2, gx=2), distinct offset/size/angle.
    out["heatmap"][0, 0, 2, 2] = 0.8
    out["offset"][0, 0, 2, 2] = 0.5
    out["offset"][0, 1, 2, 2] = 0.5
    out["size"][0, 0, 2, 2] = math.log(16.0)
    out["size"][0, 1, 2, 2] = math.log(8.0)
    out["angle"][0, 0, 2, 2] = 1.0  # sin(90deg) = 1, cos(90deg) = 0 -> theta = 90deg

    decoded = sorted(_decode_predictions(out, stride=STRIDE)[0], key=lambda d: d["score"])
    assert len(decoded) == 2

    box_b, box_a = decoded[0]["box"], decoded[1]["box"]  # sorted by score ascending: B (0.8) then A (1.0)
    assert box_a == pytest.approx((0.0, 0.0, 10.0, 10.0, 0.0))
    assert box_b[0] == pytest.approx((2 + 0.5) * STRIDE)
    assert box_b[1] == pytest.approx((2 + 0.5) * STRIDE)
    assert box_b[2] == pytest.approx(16.0)
    assert box_b[3] == pytest.approx(8.0)
    assert box_b[4] == pytest.approx(math.radians(90))


# --- configurable threshold + NMS on decode (issue #285: the hardcoded
# 0.3 threshold sat ABOVE the trained model's 0.167-0.290 peak heatmap
# activation, discarding ~all detections; the no-NMS decoder separately
# emitted 9,269 dets for 96 GT boxes at a lowered threshold) -------------


def test_module_default_decode_threshold_is_the_measured_choice_of_point_one_five():
    # 0.15 was chosen from issue #285's measured sweep: within 0.002 mAP of
    # the saturation point (0.1827 vs 0.1850 at 0.05) at a small fraction
    # of the raw candidate count (1,911 vs 25,548) BEFORE NMS even runs --
    # not the max-mAP value (0.05/0.10), which is operationally absurd.
    assert DECODE_SCORE_THRESHOLD == pytest.approx(0.15)


def test_module_default_nms_iou_threshold_is_point_five():
    # Composites deliberately overlap distinct cards ~35% of the time
    # (overlapProbability in composites-generation.json); 0.5 is the
    # standard COCO-style choice, picked here to err toward keeping
    # genuinely separate overlapping cards distinct rather than merging
    # them.
    assert NMS_IOU_THRESHOLD == pytest.approx(0.5)


def test_decode_predictions_threshold_is_configurable_independent_of_the_module_default():
    grid_h, grid_w = 3, 3
    out = _zero_output(grid_h, grid_w)
    out["heatmap"][0, 0, 1, 1] = 0.2  # below the OLD 0.3 default, above a lowered 0.1 threshold
    decoded_at_default_era_threshold = _decode_predictions(out, stride=STRIDE, threshold=0.3)
    decoded_at_lowered_threshold = _decode_predictions(out, stride=STRIDE, threshold=0.1)
    assert decoded_at_default_era_threshold == [[]]
    assert len(decoded_at_lowered_threshold[0]) == 1


def test_decode_predictions_uses_the_module_default_threshold_when_not_passed():
    grid_h, grid_w = 3, 3
    out = _zero_output(grid_h, grid_w)
    out["heatmap"][0, 0, 1, 1] = 0.20  # above the new 0.15 default, below the old 0.3 one
    decoded = _decode_predictions(out, stride=STRIDE)
    assert len(decoded[0]) == 1


def _duplicate_detection_output() -> dict:
    """Two adjacent cells that decode to the EXACT SAME box (0, 0, 20, 20,
    0) at different scores -- a hand-built version of issue #285's "9,269
    dets for 96 GT boxes" failure mode: every duplicate around one true
    object counts as an extra false positive unless NMS collapses it."""
    grid_h, grid_w = 2, 2
    out = _zero_output(grid_h, grid_w)

    out["heatmap"][0, 0, 0, 0] = 0.9
    out["size"][0, 0, 0, 0] = math.log(20.0)
    out["size"][0, 1, 0, 0] = math.log(20.0)
    out["angle"][0, 1, 0, 0] = 1.0  # cos(0) = 1 -> theta = 0

    out["heatmap"][0, 0, 0, 1] = 0.5
    out["offset"][0, 0, 0, 1] = -1.0  # (gx=1 + dx=-1) * stride = 0 == cell A's cx
    out["size"][0, 0, 0, 1] = math.log(20.0)
    out["size"][0, 1, 0, 1] = math.log(20.0)
    out["angle"][0, 1, 0, 1] = 1.0
    return out


def test_decode_predictions_applies_nms_to_collapse_a_duplicate_detection():
    out = _duplicate_detection_output()
    decoded = _decode_predictions(out, stride=STRIDE, threshold=0.3, nms_iou_threshold=0.5)
    dets = decoded[0]
    assert len(dets) == 1  # the duplicate is suppressed, not just down-weighted
    assert dets[0]["score"] == pytest.approx(0.9)  # the higher-scoring detection survives


def test_decode_predictions_nms_iou_threshold_of_one_effectively_disables_suppression():
    # rotated_iou never exceeds 1.0, so a threshold of exactly 1.0 means
    # "IoU > 1.0" never fires -- the documented way to turn NMS off
    # without a separate boolean flag.
    out = _duplicate_detection_output()
    decoded = _decode_predictions(out, stride=STRIDE, threshold=0.3, nms_iou_threshold=1.0)
    assert len(decoded[0]) == 2
