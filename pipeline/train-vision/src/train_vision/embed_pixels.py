"""Pixel-level crop-with-neutral-padding (APP-028). The counterpart to
embed_crop.py's pure box geometry: given a real image array and an
UNCLAMPED crop box (which may extend beyond, or lie entirely outside, the
source image), returns a box_h x box_w x C array where the portion that
overlaps the source image is copied verbatim and every other pixel is
filled with a neutral mid-gray value.

Deliberately NOT "clamp box to canvas then resize": clamping first would
silently rescale a partially-off-canvas card to fill the whole crop,
lying about how much of the card was actually visible — the exact
clamp-and-distort failure mode encode.py's own amodal doc comment warns
against for heatmap targets, applied here to pixels instead.
"""
import math
from typing import Tuple

import numpy as np

NEUTRAL_FILL_VALUE = 128  # uint8 mid-gray


def crop_with_neutral_padding(image: np.ndarray, box: Tuple[float, float, float, float], neutral_value: int = NEUTRAL_FILL_VALUE) -> np.ndarray:
    """`image`: an (H, W, C) array. `box`: (x0, y0, x1, y1), unclamped —
    may be partially or entirely outside [0, W) x [0, H). Non-integer
    coordinates are floored/ceiled outward so the returned box always
    fully covers the requested (possibly fractional) extent."""
    if image.ndim != 3:
        raise ValueError(f"crop_with_neutral_padding expects an (H, W, C) array, got shape {image.shape}")

    x0, y0, x1, y1 = box
    x0i, y0i = math.floor(x0), math.floor(y0)
    x1i, y1i = math.ceil(x1), math.ceil(y1)
    box_w, box_h = max(x1i - x0i, 0), max(y1i - y0i, 0)
    channels = image.shape[2]
    out = np.full((box_h, box_w, channels), neutral_value, dtype=image.dtype)

    img_h, img_w = image.shape[:2]
    src_x0, src_y0 = max(x0i, 0), max(y0i, 0)
    src_x1, src_y1 = min(x1i, img_w), min(y1i, img_h)
    if src_x1 > src_x0 and src_y1 > src_y0:
        dst_x0, dst_y0 = src_x0 - x0i, src_y0 - y0i
        dst_x1, dst_y1 = dst_x0 + (src_x1 - src_x0), dst_y0 + (src_y1 - src_y0)
        out[dst_y0:dst_y1, dst_x0:dst_x1] = image[src_y0:src_y1, src_x0:src_x1]
    return out
