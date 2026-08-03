"""OBB target encoding (APP-027, SPEC-APP.md §8.7c): converts one
composite's label quads into CenterNet-style training targets — a single-
class object-presence heatmap on a `stride`-downsampled grid, plus per-
positive-cell offset/size/angle regression targets.

AMODAL CONTRACT (dev brain lesson from APP-026's review: labels are
amodal, out-of-canvas coords are legitimate ground truth — never clamp).
A card's true center can legitimately fall outside the canvas (a card
mostly cropped by the frame edge). The center-point detection paradigm
genuinely cannot place a heatmap supervision peak for such a card — there
is no grid cell for it — so it is excluded from `heatmap`/`obb_targets`.
That is a real, documented limitation of this paradigm, NOT a clamping
hack: the card's full, unclamped (cx, cy, w, h, theta) is still recorded
in `raw_obbs`, which is what map_eval.py's ground truth comes from. Train-
time supervision and eval-time ground truth are allowed to disagree about
what's *supervisable*; they must never disagree about what a card's true
extent *is*.
"""
import math
from typing import Any, Dict, List

from .geometry import quad_to_obb


def _corner_to_tuple(point: Any) -> tuple:
    """Normalizes one corner into an (x, y) tuple. The REAL, on-disk label
    shape (pipeline/src/composites/types.ts's Quad, and the identical
    real-photo-benchmark shape in pipeline/docs/benchmark-labeling.md) is
    `{"x": ..., "y": ...}` per corner — a plain [x, y] pair is also
    accepted so callers can hand-build quads without the dict boilerplate
    (test fixtures do both)."""
    if isinstance(point, dict):
        return (point["x"], point["y"])
    return (point[0], point[1])


def encode_targets(quads: List[Dict[str, Any]], canvas_width: int, canvas_height: int, stride: int) -> Dict[str, Any]:
    """`quads`: composites/benchmark label shape — each a dict with at least
    `corners`: 4 corners (either `{"x", "y"}` dicts, the real on-disk shape,
    or `[x, y]` pairs) in [TL, TR, BR, BL] order. Grid dimensions use floor
    division (`canvas // stride`); any remainder pixels at the canvas's
    right/bottom edge simply aren't covered by a full cell, matching how a
    real strided conv feature map would behave.
    """
    if stride <= 0:
        raise ValueError(f"stride must be positive, got {stride}")
    grid_w = canvas_width // stride
    grid_h = canvas_height // stride
    heatmap = [[0.0 for _ in range(grid_w)] for _ in range(grid_h)]
    obb_targets: List[Dict[str, Any]] = []
    raw_obbs: List[tuple] = []

    for quad in quads:
        corners = [_corner_to_tuple(p) for p in quad["corners"]]
        cx, cy, w, h, theta = quad_to_obb(corners)
        raw_obbs.append((cx, cy, w, h, theta))

        gx = math.floor(cx / stride)
        gy = math.floor(cy / stride)
        if not (0 <= gx < grid_w and 0 <= gy < grid_h):
            # Off-canvas (or off-grid) center: no cell to supervise. Ground
            # truth already recorded above in raw_obbs, unclamped.
            continue

        heatmap[gy][gx] = 1.0
        obb_targets.append(
            {
                "gx": gx,
                "gy": gy,
                "offset_x": cx / stride - gx,
                "offset_y": cy / stride - gy,
                "w": w,
                "h": h,
                "sin": math.sin(theta),
                "cos": math.cos(theta),
            }
        )

    return {"grid_w": grid_w, "grid_h": grid_h, "heatmap": heatmap, "obb_targets": obb_targets, "raw_obbs": raw_obbs}
