"""Crop-box geometry for the recognition embedder (APP-028, SPEC-APP.md
§8.7d). Computes the axis-aligned crop box for one card's quad label.

BOUNDARY CONVENTION (a deliberate simplification, decided up front per the
detector's own precedent of documented "boring, not state of the art"
approximations — mirrors train_vision/geometry.py's quad_to_obb top/left-
edge convention for skewed quads): the crop box is the axis-aligned
bounding box (AABB) of the quad's 4 corners, NOT a rotation/perspective-
corrected rectification. A rotated or perspective-skewed card's crop box
therefore includes some background around the card rather than a tight,
unrotated card-only crop — a real, accepted accuracy cost (a follow-up
could rectify via a homography, mirroring composites/warp.ts's forward
warp inverted), not silently absorbed: recorded here and in README.md.

AMODAL CONTRACT (mirrors geometry.py's/encode.py's doc comments): the
returned box is NEVER clamped to the composite's canvas bounds. A card
whose quad extends past the canvas edge (or entirely outside it) yields a
box with negative coordinates or coordinates beyond (canvas_width,
canvas_height) — this is the ground truth, not a bug. Pixel-level padding
for the out-of-canvas portion is embed_pixels.py's job, not this module's.
"""
from typing import Any, List, Tuple

Box = Tuple[float, float, float, float]  # x0, y0, x1, y1


def _corner_to_tuple(point: Any) -> Tuple[float, float]:
    """Same dual dict-or-pair acceptance as encode.py's _corner_to_tuple —
    the real, on-disk label shape (pipeline/src/composites/types.ts's
    Quad) is `{"x": ..., "y": ...}` per corner; a plain [x, y] pair is
    also accepted so callers/tests can hand-build quads without the dict
    boilerplate."""
    if isinstance(point, dict):
        return (point["x"], point["y"])
    return (point[0], point[1])


def compute_crop_box(corners: List[Any]) -> Box:
    """`corners`: 4 corners in [TL, TR, BR, BL] order (dicts or pairs).
    Returns the unclamped (x0, y0, x1, y1) axis-aligned bounding box."""
    if len(corners) != 4:
        raise ValueError(f"compute_crop_box expects exactly 4 corners, got {len(corners)}")
    pts = [_corner_to_tuple(p) for p in corners]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))
