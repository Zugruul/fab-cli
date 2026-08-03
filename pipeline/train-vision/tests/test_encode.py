"""OBB target encoding (APP-027, SPEC-APP.md §8.7c). Converts a composite's
label quads into CenterNet-style training targets (heatmap peak + offset +
size + angle regression at one grid cell per card).

AMODAL CONTRACT (dev brain lesson: labels are amodal, never clamp):
a card whose true center falls outside the canvas cannot be placed in the
center-point heatmap (there is no cell for it) — that is a real, documented
limitation of the center-point detection paradigm, not something to hack
around. But encode_targets must NEVER drop or clamp that card's ground
truth from its `raw_obbs` output, since mAP evaluation (map_eval.py) needs
every card's true, full extent regardless of whether the detector could
ever have been supervised to find it. The tests below pin both halves of
that contract down explicitly.
"""
import math

import pytest

from train_vision.encode import encode_targets

pytest_approx = pytest.approx


def make_quad(printing_id, corners, tags=None):
    # {"x", "y"} dicts, matching the REAL on-disk label shape (pipeline/src/
    # composites/types.ts's Quad) — see test_accepts_the_real_on_disk_dict_shaped_corners.
    return {"printingId": printing_id, "corners": [{"x": c[0], "y": c[1]} for c in corners], "tags": tags or []}


def test_single_in_canvas_card_produces_one_heatmap_peak_and_matching_regression_target():
    # A 40x20 axis-aligned card centered at (100, 60) on a 200x100 canvas,
    # stride 8 -> grid is 25x12, center cell (12, 7) [gx, gy] since
    # 100/8=12.5 -> floor 12, 60/8=7.5 -> floor 7.
    quad = make_quad("card-1", [(80, 50), (120, 50), (120, 70), (80, 70)])
    result = encode_targets([quad], canvas_width=200, canvas_height=100, stride=8)

    assert result["grid_w"] == 25
    assert result["grid_h"] == 12
    peaks = [(gy, gx) for gy, row in enumerate(result["heatmap"]) for gx, v in enumerate(row) if v > 0]
    assert peaks == [(7, 12)]

    assert len(result["obb_targets"]) == 1
    target = result["obb_targets"][0]
    assert target["gx"] == 12
    assert target["gy"] == 7
    assert target["offset_x"] == pytest_approx(100 / 8 - 12)
    assert target["offset_y"] == pytest_approx(60 / 8 - 7)
    assert target["w"] == pytest_approx(40.0)
    assert target["h"] == pytest_approx(20.0)
    assert target["sin"] == pytest_approx(math.sin(0.0))
    assert target["cos"] == pytest_approx(math.cos(0.0))

    # And the raw (unclamped, canvas-agnostic) ground truth list still
    # carries this same card for mAP purposes.
    assert len(result["raw_obbs"]) == 1
    cx, cy, w, h, theta = result["raw_obbs"][0]
    assert (cx, cy, w, h) == (100.0, 60.0, 40.0, 20.0)


def test_out_of_canvas_card_center_excluded_from_heatmap_but_kept_in_raw_obbs():
    # Card mostly cropped by the left edge of a 200x100 canvas: its TRUE
    # (amodal) center sits at x = -10, well outside [0, 200).
    quad = make_quad("card-2", [(-30, 40), (10, 40), (10, 60), (-30, 60)])
    result = encode_targets([quad], canvas_width=200, canvas_height=100, stride=8)

    # No supervision peak anywhere — center-point paradigm genuinely can't
    # place one for an off-canvas center.
    assert all(v == 0 for row in result["heatmap"] for v in row)
    assert result["obb_targets"] == []

    # But the raw ground truth is NOT dropped and NOT clamped to x=0.
    assert len(result["raw_obbs"]) == 1
    cx, cy, w, h, theta = result["raw_obbs"][0]
    assert cx == pytest_approx(-10.0)
    assert cy == pytest_approx(50.0)
    assert w == pytest_approx(40.0)
    assert h == pytest_approx(20.0)


def test_mixed_in_and_out_of_canvas_cards_only_in_canvas_one_gets_a_peak():
    in_canvas = make_quad("card-in", [(80, 50), (120, 50), (120, 70), (80, 70)])
    out_of_canvas = make_quad("card-out", [(-30, 40), (10, 40), (10, 60), (-30, 60)])
    result = encode_targets([in_canvas, out_of_canvas], canvas_width=200, canvas_height=100, stride=8)

    peaks = [(gy, gx) for gy, row in enumerate(result["heatmap"]) for gx, v in enumerate(row) if v > 0]
    assert peaks == [(7, 12)]
    assert len(result["obb_targets"]) == 1
    # Both cards' full ground truth survive into raw_obbs regardless.
    assert len(result["raw_obbs"]) == 2


def test_card_with_negative_y_center_also_excluded_from_heatmap_only():
    quad = make_quad("card-top", [(80, -30), (120, -30), (120, -10), (80, -10)])
    result = encode_targets([quad], canvas_width=200, canvas_height=100, stride=8)
    assert all(v == 0 for row in result["heatmap"] for v in row)
    assert result["obb_targets"] == []
    assert len(result["raw_obbs"]) == 1
    assert result["raw_obbs"][0][1] == pytest_approx(-20.0)  # cy


def test_grid_dims_use_floor_division_of_canvas_by_stride():
    result = encode_targets([], canvas_width=203, canvas_height=101, stride=8)
    assert result["grid_w"] == 25  # 203 // 8
    assert result["grid_h"] == 12  # 101 // 8
    assert result["heatmap"] == [[0] * 25 for _ in range(12)]


def test_no_quads_produces_all_zero_heatmap_and_empty_targets():
    result = encode_targets([], canvas_width=64, canvas_height=64, stride=8)
    assert result["obb_targets"] == []
    assert result["raw_obbs"] == []
    assert all(v == 0 for row in result["heatmap"] for v in row)


def test_accepts_the_real_on_disk_dict_shaped_corners():
    # pipeline/src/composites/types.ts's Quad (and the identical real-photo
    # benchmark shape) stores each corner as {"x": ..., "y": ...}, not a
    # bare [x, y] pair — this is the ACTUAL shape composites:generate
    # writes to disk, so encode_targets must handle it directly.
    quad = {
        "printingId": "card-dict",
        "corners": [{"x": 80, "y": 50}, {"x": 120, "y": 50}, {"x": 120, "y": 70}, {"x": 80, "y": 70}],
        "tags": [],
    }
    result = encode_targets([quad], canvas_width=200, canvas_height=100, stride=8)
    peaks = [(gy, gx) for gy, row in enumerate(result["heatmap"]) for gx, v in enumerate(row) if v > 0]
    assert peaks == [(7, 12)]
    assert result["raw_obbs"][0][:4] == (100.0, 60.0, 40.0, 20.0)
