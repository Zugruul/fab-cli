"""Pure oriented-bounding-box (OBB) geometry (APP-027, SPEC-APP.md §8.7c).

No numpy/shapely dependency by design — this is a handful of closed-form
formulas and one Sutherland-Hodgman convex-polygon clip, small enough to
verify by hand (see tests/test_geometry.py's pinned values) and to keep the
license story trivial (this module has zero third-party dependencies at
all).

AMODAL CONTRACT (mirrors pipeline/src/composites/geometry.ts's doc comment
and pipeline/docs/benchmark-labeling.md's "amodal labeling" section):
none of these functions clamp coordinates to any canvas/frame bound. A
quad or OBB with negative coordinates, or coordinates beyond a canvas's
width/height, is not a bug — it is what a card cropped by the frame edge,
or occluded by another card, legitimately looks like as ground truth.
Clamping here would silently reintroduce the exact train/eval mismatch
APP-026 eliminated on the label side.

Coordinate convention: same as composites/geometry.ts's computeDestQuad —
y-down screen space, corners ordered [TL, TR, BR, BL] (clockwise starting
top-left), rotation measured as the angle (radians) of the TL->TR ("top")
edge vector from the positive x-axis via atan2(dy, dx).
"""
import math
from typing import Any, Dict, List, Tuple

Point = Tuple[float, float]
Quad = Tuple[Point, Point, Point, Point]
# (center_x, center_y, width, height, rotation_radians)
OBB = Tuple[float, float, float, float, float]


def quad_to_obb(corners: List[Tuple[float, float]]) -> OBB:
    """Converts 4 corners [TL, TR, BR, BL] to a (cx, cy, w, h, theta) OBB.

    Convention (documented, not just "whatever the source rect gives us"
    — a deliberate approximation for the perspective-skewed quads
    composites/geometry.ts's computeDestQuad can emit, which are trapezoids
    rather than true rectangles):
      - center = the plain centroid (average) of the 4 corners.
      - width  = the length of the TOP edge (TL -> TR).
      - height = the length of the LEFT edge (TL -> BL).
      - theta  = the angle of the TOP edge (TL -> TR) from the +x axis.

    For a true (non-skewed) rotated rectangle this is exact. For a
    perspective-skewed trapezoid it is a documented, one-edge-each
    approximation — training and mAP-eval both go through this SAME
    function, so any approximation error is applied identically on both
    sides, never a source of train/eval mismatch.
    """
    if len(corners) != 4:
        raise ValueError(f"quad_to_obb expects exactly 4 corners, got {len(corners)}")
    tl, tr, br, bl = corners
    cx = sum(p[0] for p in corners) / 4.0
    cy = sum(p[1] for p in corners) / 4.0
    w = math.hypot(tr[0] - tl[0], tr[1] - tl[1])
    h = math.hypot(bl[0] - tl[0], bl[1] - tl[1])
    theta = math.atan2(tr[1] - tl[1], tr[0] - tl[0])
    return (cx, cy, w, h, theta)


def obb_to_polygon(cx: float, cy: float, w: float, h: float, theta: float) -> Quad:
    """Inverse of quad_to_obb for a true (unskewed) rectangle: returns the 4
    corners [TL, TR, BR, BL] of the (cx, cy, w, h, theta) OBB, using the
    same rotation convention as composites/geometry.ts's computeDestQuad
    (rotate the axis-aligned local rect about the origin, then translate).
    """
    half_w, half_h = w / 2.0, h / 2.0
    local = [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    def transform(p: Tuple[float, float]) -> Point:
        x, y = p
        return (x * cos_t - y * sin_t + cx, x * sin_t + y * cos_t + cy)

    tl, tr, br, bl = (transform(p) for p in local)
    return (tl, tr, br, bl)


def polygon_area(poly: List[Tuple[float, float]]) -> float:
    """Shoelace formula. Works for any simple polygon regardless of winding
    order (the abs() makes it orientation-agnostic)."""
    n = len(poly)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _signed_area(poly: List[Tuple[float, float]]) -> float:
    n = len(poly)
    total = 0.0
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def _line_intersection(a: Point, b: Point, c: Point, d: Point) -> Point:
    """Intersection of infinite line AB with infinite line CD. Callers only
    ever invoke this when the two segments are known to actually cross
    (Sutherland-Hodgman only calls it when one endpoint is inside and the
    other outside a clip edge), so the denominator is never zero in
    practice for the convex-quad inputs this module handles."""
    x1, y1 = a
    x2, y2 = b
    x3, y3 = c
    x4, y4 = d
    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))


def polygon_intersection_area(subject: List[Tuple[float, float]], clip: List[Tuple[float, float]]) -> float:
    """Sutherland-Hodgman clip of `subject` (any simple polygon) against the
    convex polygon `clip`, returning the resulting intersection's area.
    Both OBB rectangles this module deals with are always convex, so
    `clip`'s convexity requirement is always satisfied by construction
    (obb_to_polygon's output). Orientation-agnostic: the clip polygon's own
    winding is measured once (_signed_area) and used to pick the correct
    "inside" sign, so it works whether callers hand it CW or CCW corners.
    """
    output = list(subject)
    if len(output) == 0:
        return 0.0

    clip_n = len(clip)
    # Positive signed area => CCW in standard (y-up) math convention; the
    # sign flips the "inside" test below so the algorithm is correct
    # regardless of the winding order callers pass (this module's own
    # corners are y-down/clockwise, per this file's doc comment).
    orientation = 1.0 if _signed_area(clip) >= 0 else -1.0

    for i in range(clip_n):
        if not output:
            break
        a = clip[i]
        b = clip[(i + 1) % clip_n]

        def inside(p: Point) -> bool:
            cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
            return cross * orientation >= 0

        input_list = output
        output = []
        n = len(input_list)
        for j in range(n):
            current = input_list[j]
            previous = input_list[j - 1]
            current_inside = inside(current)
            previous_inside = inside(previous)
            if current_inside:
                if not previous_inside:
                    output.append(_line_intersection(previous, current, a, b))
                output.append(current)
            elif previous_inside:
                output.append(_line_intersection(previous, current, a, b))

    return polygon_area(output) if len(output) >= 3 else 0.0


def rotated_iou(a: OBB, b: OBB) -> float:
    """Rotated-box IoU via polygon clipping. Never clamps its inputs to any
    canvas bound (see this module's amodal doc comment) — it is pure
    geometry over whatever (cx, cy, w, h, theta) values it's given."""
    poly_a = obb_to_polygon(*a)
    poly_b = obb_to_polygon(*b)
    inter = polygon_intersection_area(list(poly_a), list(poly_b))
    if inter <= 0.0:
        return 0.0
    area_a = a[2] * a[3]
    area_b = b[2] * b[3]
    union = area_a + area_b - inter
    if union <= 0.0:
        return 0.0
    return inter / union


def rotated_nms(dets: List[Dict[str, Any]], iou_threshold: float) -> List[Dict[str, Any]]:
    """Greedy non-max suppression over a single image's candidate OBB
    detections (issue #285: an undedduped decoder emitted 9,269 dets for
    96 GT boxes — every duplicate around a true positive counts as an
    extra false positive). Reuses `rotated_iou` as the only overlap
    measure in this module — no second IoU implementation.

    `dets`: a list of {"box": OBB, "score": float}, already
    score-thresholded by the caller. Standard highest-score-first sweep:
    take the highest-scoring not-yet-suppressed detection, keep it, and
    suppress every remaining detection whose rotated IoU against it is
    STRICTLY GREATER than `iou_threshold` (a pair sitting exactly on the
    boundary is a deliberate keep, not an off-by-one). `dets` is sorted
    once up front — Python's sort is stable, so among exactly-equal
    scores the sweep still resolves deterministically — rather than
    re-scanned for a running max each iteration: every candidate is
    compared against every higher-or-equal-scoring survivor exactly once,
    so a mutually-overlapping, equal-score cluster always collapses to
    exactly one survivor regardless of the caller's input order, even
    though which specific box that is may depend on the tie-break.
    """
    order = sorted(range(len(dets)), key=lambda i: -dets[i]["score"])
    suppressed = [False] * len(dets)
    keep: List[int] = []
    for pos, i in enumerate(order):
        if suppressed[i]:
            continue
        keep.append(i)
        for j in order[pos + 1 :]:
            if suppressed[j]:
                continue
            if rotated_iou(dets[i]["box"], dets[j]["box"]) > iou_threshold:
                suppressed[j] = True
    return [dets[i] for i in keep]
