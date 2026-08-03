"""Crop-box geometry for the recognition embedder (APP-028, SPEC-APP.md
§8.7d). Every value here is hand-computed (dev brain lesson: assert values,
not just shape) and the amodal contract (never clamp) is pinned down
explicitly with an out-of-canvas case, mirroring geometry.py's/encode.py's
own out-of-canvas tests for the detector.
"""
import pytest

from train_vision.embed_crop import compute_crop_box


def test_axis_aligned_quad_yields_its_own_bounding_box():
    corners = [{"x": 10, "y": 10}, {"x": 40, "y": 10}, {"x": 40, "y": 40}, {"x": 10, "y": 40}]
    assert compute_crop_box(corners) == pytest.approx((10.0, 10.0, 40.0, 40.0))


def test_list_pair_corners_accepted_same_as_dict_corners():
    dict_corners = [{"x": 10, "y": 10}, {"x": 40, "y": 10}, {"x": 40, "y": 40}, {"x": 10, "y": 40}]
    list_corners = [[10, 10], [40, 10], [40, 40], [10, 40]]
    assert compute_crop_box(dict_corners) == compute_crop_box(list_corners)


def test_rotated_quad_yields_the_axis_aligned_bounding_box_not_a_tight_rotated_crop():
    # A 20x20 square rotated 45 degrees about its center (20, 20): corners at
    # distance 10*sqrt(2) ~= 14.142 from center along the axes.
    d = 14.142135623730951
    corners = [(20, 20 - d), (20 + d, 20), (20, 20 + d), (20 - d, 20)]
    x0, y0, x1, y1 = compute_crop_box(corners)
    assert x0 == pytest.approx(20 - d)
    assert y0 == pytest.approx(20 - d)
    assert x1 == pytest.approx(20 + d)
    assert y1 == pytest.approx(20 + d)
    # Documented simplification: the AABB is strictly larger than the
    # original 20x20 square's own area-equivalent box (400) -- some
    # background is included around a rotated card, on purpose (see this
    # module's doc comment).
    assert (x1 - x0) * (y1 - y0) > 20 * 20


def test_out_of_canvas_quad_is_not_clamped():
    # A card whose quad sits entirely to the left of a 100-wide canvas.
    corners = [{"x": -50, "y": -20}, {"x": -10, "y": -20}, {"x": -10, "y": 20}, {"x": -50, "y": 20}]
    assert compute_crop_box(corners) == pytest.approx((-50.0, -20.0, -10.0, 20.0))


def test_perspective_skewed_quad_uses_the_full_corner_extent():
    # A trapezoid (top edge narrower than bottom) -- the AABB must cover
    # every corner, not just the top/left edges (unlike quad_to_obb's
    # documented top/left-edge convention for the detector's OBB).
    corners = [(10, 0), (30, 0), (40, 20), (0, 20)]
    assert compute_crop_box(corners) == pytest.approx((0.0, 0.0, 40.0, 20.0))


def test_rejects_wrong_corner_count():
    with pytest.raises(ValueError, match="exactly 4 corners"):
        compute_crop_box([{"x": 0, "y": 0}, {"x": 1, "y": 1}])
