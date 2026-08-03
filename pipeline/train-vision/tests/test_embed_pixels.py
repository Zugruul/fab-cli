"""Pixel-level crop-with-neutral-padding (APP-028): the counterpart to
test_embed_crop.py's pure box geometry. Every case below asserts EXACT
per-pixel arrays (not just shape), including the out-of-canvas amodal
cases -- the specific rigor the issue brief calls for ("crop-from-quad
incl. out-of-canvas cases with exact expected pixels").
"""
import numpy as np
import pytest

from train_vision.embed_pixels import NEUTRAL_FILL_VALUE, crop_with_neutral_padding


def _image(h, w, c=3, fill=0):
    """A small deterministic RGB image: pixel (y, x) = (y*w + x, ..., ...)
    for the first channel, so a crop's exact contents can be hand-verified."""
    img = np.full((h, w, c), fill, dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            img[y, x, 0] = (y * w + x) % 256
    return img


def test_box_fully_inside_image_is_an_exact_slice():
    img = _image(6, 6)
    out = crop_with_neutral_padding(img, (1.0, 2.0, 4.0, 5.0))
    assert out.shape == (3, 3, 3)
    assert np.array_equal(out, img[2:5, 1:4])


def test_box_fully_outside_image_is_entirely_neutral_fill():
    img = _image(4, 4)
    out = crop_with_neutral_padding(img, (100.0, 100.0, 104.0, 103.0))
    assert out.shape == (3, 4, 3)
    assert np.all(out == NEUTRAL_FILL_VALUE)


def test_box_straddling_the_left_edge_is_partially_neutral_partially_real():
    # 4x4 image, box from x=-2..2, y=0..4: left 2 columns are off-canvas
    # (neutral), right 2 columns are the image's own columns 0..2.
    img = _image(4, 4)
    out = crop_with_neutral_padding(img, (-2.0, 0.0, 2.0, 4.0))
    assert out.shape == (4, 4, 3)
    assert np.all(out[:, :2] == NEUTRAL_FILL_VALUE)
    assert np.array_equal(out[:, 2:4], img[0:4, 0:2])


def test_box_straddling_the_bottom_right_corner():
    img = _image(4, 4)
    out = crop_with_neutral_padding(img, (2.0, 2.0, 6.0, 6.0))
    assert out.shape == (4, 4, 3)
    # Top-left 2x2 of the output is real image content (rows/cols 2..4).
    assert np.array_equal(out[0:2, 0:2], img[2:4, 2:4])
    # Every pixel touching the off-canvas bottom/right is neutral fill.
    assert np.all(out[2:, :] == NEUTRAL_FILL_VALUE)
    assert np.all(out[:, 2:] == NEUTRAL_FILL_VALUE)


def test_non_integer_box_coordinates_are_floored_and_ceiled():
    img = _image(6, 6)
    out = crop_with_neutral_padding(img, (1.2, 1.8, 3.4, 3.1))
    # floor(1.2)=1, floor(1.8)=1, ceil(3.4)=4, ceil(3.1)=4 -> box is 3 wide, 3 tall
    assert out.shape == (3, 3, 3)
    assert np.array_equal(out, img[1:4, 1:4])


def test_custom_neutral_value_is_honored():
    img = _image(4, 4)
    out = crop_with_neutral_padding(img, (100.0, 100.0, 102.0, 102.0), neutral_value=7)
    assert np.all(out == 7)


def test_rejects_non_hwc_array():
    with pytest.raises(ValueError, match="H, W, C"):
        crop_with_neutral_padding(np.zeros((4, 4)), (0.0, 0.0, 2.0, 2.0))
