"""Pure geometry tests (APP-027, SPEC-APP.md §8.7c): quad -> oriented
bounding box (OBB) encoding, polygon-clip intersection area, and rotated
IoU. Every value here is hand-computed, not just shape-checked (dev brain
lesson test-rigor-assert-values-not-shape) — a buggy IoU that always
returns e.g. 1.0 or 0.0 must fail these.

Amodal contract (dev brain lesson: labels are amodal, out-of-canvas coords
are legitimate ground truth): quad_to_obb and rotated_iou must never clamp
their inputs or outputs to any canvas bound — they are pure geometry over
whatever coordinates they're given, in or out of frame alike. Dedicated
out-of-canvas cases below pin that down.
"""
import math

import pytest

from train_vision.geometry import (
    obb_to_polygon,
    polygon_area,
    polygon_intersection_area,
    quad_to_obb,
    rotated_iou,
)


def test_quad_to_obb_axis_aligned_rectangle():
    # TL, TR, BR, BL — a plain 40x20 axis-aligned rect centered at (100, 50).
    corners = [(80, 40), (120, 40), (120, 60), (80, 60)]
    cx, cy, w, h, theta = quad_to_obb(corners)
    assert cx == pytest.approx(100.0)
    assert cy == pytest.approx(50.0)
    assert w == pytest.approx(40.0)
    assert h == pytest.approx(20.0)
    assert theta == pytest.approx(0.0, abs=1e-9)


def test_quad_to_obb_rotated_45_degrees():
    # A 10x10 square rotated 45 degrees about its own center (0, 0), scaled
    # so half-diagonal = sqrt(2)*5 ≈ 7.0710678, matching computeDestQuad's
    # rotation convention (clockwise-positive, y-down screen space).
    d = 5 * math.sqrt(2)
    corners = [(0, -d), (d, 0), (0, d), (-d, 0)]  # TL, TR, BR, BL after rotation
    cx, cy, w, h, theta = quad_to_obb(corners)
    assert cx == pytest.approx(0.0, abs=1e-9)
    assert cy == pytest.approx(0.0, abs=1e-9)
    assert w == pytest.approx(10.0, abs=1e-6)
    assert h == pytest.approx(10.0, abs=1e-6)
    assert theta == pytest.approx(math.radians(45), abs=1e-6)


def test_quad_to_obb_out_of_canvas_is_not_clamped():
    # Card whose top-left corner sits well outside a 100x100 canvas
    # (negative x) — quad_to_obb must report its true, unclamped extent.
    corners = [(-30, -20), (50, -20), (50, 60), (-30, 60)]
    cx, cy, w, h, theta = quad_to_obb(corners)
    assert cx == pytest.approx(10.0)
    assert cy == pytest.approx(20.0)
    assert w == pytest.approx(80.0)
    assert h == pytest.approx(80.0)
    assert theta == pytest.approx(0.0, abs=1e-9)


def test_quad_to_obb_perspective_skewed_quad_uses_top_and_left_edges():
    # A trapezoid (top edge narrower than bottom, per geometry.ts's
    # perspective convention) is not a true rectangle — quad_to_obb's
    # documented convention treats the top edge as width and the left edge
    # as height, matching the composites generator's own quad shape.
    corners = [(10, 0), (30, 0), (40, 20), (0, 20)]
    cx, cy, w, h, theta = quad_to_obb(corners)
    assert w == pytest.approx(20.0)  # top edge length: (30,0)-(10,0)
    assert h == pytest.approx(math.hypot(10, 20))  # left edge: (10,0)-(0,20)
    assert cx == pytest.approx(20.0)
    assert cy == pytest.approx(10.0)


def test_obb_to_polygon_round_trips_axis_aligned():
    corners = obb_to_polygon(100.0, 50.0, 40.0, 20.0, 0.0)
    assert corners[0] == pytest.approx((80.0, 40.0))
    assert corners[1] == pytest.approx((120.0, 40.0))
    assert corners[2] == pytest.approx((120.0, 60.0))
    assert corners[3] == pytest.approx((80.0, 60.0))


def test_polygon_area_shoelace_known_square():
    square = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert polygon_area(square) == pytest.approx(100.0)


def test_polygon_intersection_area_identical_squares():
    square = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert polygon_intersection_area(square, square) == pytest.approx(100.0)


def test_polygon_intersection_area_half_overlap():
    a = [(0, 0), (10, 0), (10, 10), (0, 10)]
    b = [(5, 0), (15, 0), (15, 10), (5, 10)]
    assert polygon_intersection_area(a, b) == pytest.approx(50.0)


def test_polygon_intersection_area_disjoint_is_zero():
    a = [(0, 0), (10, 0), (10, 10), (0, 10)]
    b = [(100, 100), (110, 100), (110, 110), (100, 110)]
    assert polygon_intersection_area(a, b) == pytest.approx(0.0)


def test_rotated_iou_identical_axis_aligned_boxes_is_one():
    box = (100.0, 100.0, 40.0, 20.0, 0.0)
    assert rotated_iou(box, box) == pytest.approx(1.0)


def test_rotated_iou_half_overlap_axis_aligned_hand_computed():
    # Two 10x10 axis-aligned boxes, second shifted by 5 in x: intersection
    # area = 50, union = 100+100-50 = 150 -> IoU = 1/3.
    a = (5.0, 5.0, 10.0, 10.0, 0.0)
    b = (10.0, 5.0, 10.0, 10.0, 0.0)
    assert rotated_iou(a, b) == pytest.approx(1.0 / 3.0)


def test_rotated_iou_disjoint_boxes_is_zero():
    a = (0.0, 0.0, 10.0, 10.0, 0.0)
    b = (1000.0, 1000.0, 10.0, 10.0, 0.0)
    assert rotated_iou(a, b) == pytest.approx(0.0)


def test_rotated_iou_rotation_reduces_overlap_hand_computed():
    # A 10x10 axis-aligned box and the SAME box rotated 45 degrees about its
    # own center: the intersection is a regular octagon. For a square of
    # side s rotated 45deg about its own center against itself unrotated,
    # the overlap area is a standard closed form: 2*(sqrt(2)-1)*s^2 (each
    # of the square's 4 corners is cut off by the rotated square's edges,
    # leaving a regular octagon). Plugging that into IoU = inter/(2*s^2 -
    # inter) simplifies to exactly 1/sqrt(2) — two independently-derived
    # closed forms cross-checked against each other, not just against the
    # implementation under test.
    s = 10.0
    a = (0.0, 0.0, s, s, 0.0)
    b = (0.0, 0.0, s, s, math.radians(45))
    expected_intersection = 2 * (math.sqrt(2) - 1) * s * s
    expected_union = s * s + s * s - expected_intersection
    expected_iou = expected_intersection / expected_union
    assert expected_iou == pytest.approx(1.0 / math.sqrt(2), rel=1e-9)
    assert rotated_iou(a, b) == pytest.approx(expected_iou, rel=1e-6)
    # And it must be strictly less than the identical-box case — rotating
    # one box must actually reduce overlap, not silently no-op.
    assert rotated_iou(a, b) < rotated_iou(a, a)


def test_rotated_iou_out_of_canvas_boxes_computed_without_clamping():
    # Both boxes have negative coordinates (as if placed near/beyond a
    # canvas's top-left edge) — rotated_iou must treat this exactly like
    # any other pair of coordinates; a canvas-clamping bug would corrupt
    # this silently (dev brain lesson: never clamp amodal geometry).
    a = (-50.0, -50.0, 20.0, 20.0, 0.0)
    b = (-45.0, -50.0, 20.0, 20.0, 0.0)
    # Same shape as the hand-computed axis-aligned half-shift case above,
    # just translated into negative coordinate space: intersection area =
    # 15*20 = 300, union = 400+400-300 = 500 -> IoU = 0.6.
    assert rotated_iou(a, b) == pytest.approx(0.6)
