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

from train_vision.train import _decode_predictions

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

    out["heatmap"][0, 0, gy, gx] = 0.9  # above DECODE_SCORE_THRESHOLD (0.3)
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
    grid_h, grid_w = 3, 3
    out = _zero_output(grid_h, grid_w)
    out["heatmap"][0, 0, 1, 1] = 0.29  # just under the 0.3 default threshold
    decoded = _decode_predictions(out, stride=STRIDE)
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
