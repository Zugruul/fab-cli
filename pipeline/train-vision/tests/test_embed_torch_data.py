"""torch Dataset wrapper for per-card embedder crops (APP-028): real image
decoding through PIL, exercised against the same fixture composites-run/
test_dataset.py/test_embed_dataset.py use. The pure exact-pixel rigor
lives in test_embed_pixels.py; this file proves the full real-PNG path
(compute_crop_box -> crop_with_neutral_padding -> PIL resize -> tensor)
agrees with that math -- in particular for a quad entirely outside the
canvas, where the expected output is a provably CONSTANT array (a
neutral-fill crop resized is still that same constant, exactly), so an
exact assertion survives the resize step.
"""
import os

import torch

from train_vision.embed_dataset import build_class_index, build_embed_dataset
from train_vision.embed_pixels import NEUTRAL_FILL_VALUE
from train_vision.embed_torch_data import PrintingCropDataset, collate_embed_batch, crop_card_to_tensor
from PIL import Image

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "composites-run")
OUTPUT_SIZE = 16


def _open_composite(composite_id: str) -> Image.Image:
    return Image.open(os.path.join(FIXTURE_DIR, f"{composite_id}.png"))


def test_crop_card_to_tensor_in_canvas_card_has_expected_shape_dtype_and_range():
    image = _open_composite("composite-000")
    corners = [{"x": 80, "y": 50}, {"x": 120, "y": 50}, {"x": 120, "y": 70}, {"x": 80, "y": 70}]
    tensor = crop_card_to_tensor(image, corners, OUTPUT_SIZE)
    assert tensor.shape == (3, OUTPUT_SIZE, OUTPUT_SIZE)
    assert tensor.dtype == torch.float32
    assert tensor.min() >= 0.0 and tensor.max() <= 1.0


def test_crop_card_to_tensor_fully_out_of_canvas_quad_is_exactly_neutral_fill_even_after_resize():
    image = _open_composite("composite-000")  # 200x100 canvas
    # Quad entirely beyond the canvas -- guaranteed zero overlap.
    corners = [{"x": 300, "y": 300}, {"x": 340, "y": 300}, {"x": 340, "y": 340}, {"x": 300, "y": 340}]
    tensor = crop_card_to_tensor(image, corners, OUTPUT_SIZE)
    expected = NEUTRAL_FILL_VALUE / 255.0
    assert torch.allclose(tensor, torch.full_like(tensor, expected), atol=1e-3)


def test_printing_crop_dataset_labels_match_the_class_index():
    samples = build_embed_dataset(FIXTURE_DIR)
    class_index = build_class_index(samples)
    ds = PrintingCropDataset(samples, class_index, OUTPUT_SIZE)
    assert len(ds) == len(samples)
    for i in range(len(ds)):
        item = ds[i]
        assert item["label"] == class_index[item["printing_id"]]
        assert item["image"].shape == (3, OUTPUT_SIZE, OUTPUT_SIZE)


def test_collate_embed_batch_stacks_tensors_and_keeps_ids_as_lists():
    samples = build_embed_dataset(FIXTURE_DIR)
    class_index = build_class_index(samples)
    ds = PrintingCropDataset(samples, class_index, OUTPUT_SIZE)
    batch = collate_embed_batch([ds[0], ds[1]])
    assert batch["image"].shape == (2, 3, OUTPUT_SIZE, OUTPUT_SIZE)
    assert batch["label"].shape == (2,)
    assert batch["label"].dtype == torch.long
    assert isinstance(batch["printing_id"], list) and len(batch["printing_id"]) == 2
    assert isinstance(batch["composite_id"], list) and len(batch["composite_id"]) == 2
